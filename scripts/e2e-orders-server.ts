/**
 * Phase 5 orders E2E server harness (fourth Playwright webServer entry).
 *
 * The first webServer entry (`npm run build && npm run start`) owns the build
 * and serves the honest, entirely unpriced preview fixtures on port 3000, and
 * the cart harness (3002) has no database at all — so neither can place an
 * order: one has nothing orderable, the other cannot read configuration,
 * persist an order, or run an admin session.
 *
 * This harness reuses the SAME `.next` build (one build per run) and stands
 * up the complete Phase 5 stack on port 3003:
 *
 *   1. Waits until the storefront server responds (no build race).
 *   2. Boots a disposable in-memory MongoDB (mongodb-memory-server).
 *   3. Seeds the real catalogue through `scripts/seed.ts` with
 *      `E2E_PURCHASABLE_FIXTURES=1`, which also inserts the four clearly
 *      labelled synthetic orderable products and builds every index the
 *      order flow depends on (unique reference, idempotency key, rate-limit
 *      TTL, notification outbox).
 *   4. Creates the disposable owner account through `scripts/admin-bootstrap.ts`.
 *   5. Writes the store configuration singleton with an EXPLICITLY LABELLED
 *      test policy (see below), because checkout is blocked until the owner
 *      states how fulfilment and tax work — and nothing may be invented.
 *   6. Starts `next start` on port 3003 with MONGODB_URI pointing at that
 *      database, so checkout pricing, order placement, the guest
 *      confirmation read and the whole admin order area hit real records.
 *   7. Tears everything down on SIGINT/SIGTERM/exit; Playwright also kills
 *      the whole process tree (Windows: taskkill /T) when the run ends.
 *
 * `E2E_PURCHASABLE_FIXTURES` is set ONLY for the seed child process, never
 * for `next start`: the server reads the catalogue from the database
 * (`resolveCatalogueSource` gives the URI precedence), so the flag only has
 * to exist at the moment the synthetic records are written.
 *
 * Everything here is test-only: no cloud services, no real credentials, no
 * production data. The test policy is labelled in its own strings so it can
 * never be mistaken for a real business decision.
 */
import { spawn, spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import { StoreConfigModel } from "../src/models/store-config";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const STOREFRONT_URL = process.env.E2E_STOREFRONT_URL ?? "http://localhost:3000";
const ORDERS_PORT = 3003;

let mongod: MongoMemoryServer | null = null;
let ordersServer: ReturnType<typeof spawn> | null = null;
let shuttingDown = false;

function log(message: string): void {
  console.log(`[e2e-orders] ${message}`);
}

/** Poll until the URL answers any HTTP status (5xx means "still settling"). */
async function waitForHttp(url: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      const response = await fetch(url, {
        signal: AbortSignal.timeout(4_000),
        redirect: "manual",
      });
      if (response.status < 500) {
        log(`ready: ${url} (${response.status})`);
        return;
      }
    } catch {
      // Not listening yet (build still running, port not bound).
    }
    if (Date.now() >= deadline) {
      throw new Error(`Timed out after ${Math.round(timeoutMs / 1000)}s waiting for ${url}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
}

/** Run a one-shot command and reject unless it exits cleanly. */
function runToCompletion(command: string, env: NodeJS.ProcessEnv, label: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, { cwd: ROOT, env, shell: true, stdio: "inherit" });
    child.once("error", (error) => reject(new Error(`${label} failed to start: ${error.message}`)));
    child.once("exit", (code, signal) => {
      if (code === 0) resolve();
      else reject(new Error(`${label} exited with code ${code ?? "null"} (signal ${signal ?? "none"})`));
    });
  });
}

function killOrdersServerTree(): void {
  if (!ordersServer?.pid) return;
  if (process.platform === "win32") {
    try {
      spawnSync("taskkill", ["/pid", String(ordersServer.pid), "/T", "/F"], { stdio: "ignore" });
    } catch {
      // Already gone.
    }
  } else if (!ordersServer.killed) {
    ordersServer.kill("SIGTERM");
  }
}

async function shutdown(code: number): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  killOrdersServerTree();
  try {
    await mongoose.disconnect();
  } catch {
    // Best effort.
  }
  if (mongod) {
    try {
      await mongod.stop();
    } catch {
      // Best effort; Playwright's tree kill is the backstop.
    }
    mongod = null;
  }
  process.exit(code);
}

/**
 * The labelled test policy checkout needs before it will accept an order.
 *
 * Every value here is synthetic and says so in its own text: a test service
 * area, a test pickup point, a test tax label. None of it is a business
 * decision — the real values are entered by the owner through
 * `/admin/settings` (see docs/BUSINESS_CONFIGURATION.md), and the manual
 * configuration checklist that goes with it.
 */
async function writeTestStoreConfig(): Promise<void> {
  await StoreConfigModel.updateOne(
    { _id: "checkout" },
    {
      $set: {
        orderIntakeEnabled: true,
        delivery: {
          enabled: true,
          serviceAreas: [
            {
              label: "E2E Test Metro",
              provinces: ["ON"],
              postalPrefixes: ["M5H"],
              feeCents: 700,
            },
          ],
        },
        pickup: {
          enabled: true,
          instructions:
            "Labelled E2E test pickup point. Not a real address: the test suite arranges collection with itself.",
        },
        tax: {
          mode: "rate",
          rateBps: 1300,
          base: "merchandise",
          label: "E2E test HST",
        },
        customerNote: null,
      },
    },
    { upsert: true },
  );
}

async function main(): Promise<void> {
  const email = process.env.E2E_ADMIN_EMAIL?.trim();
  const password = process.env.E2E_ADMIN_PASSWORD;
  if (!email || !password) {
    throw new Error("E2E_ADMIN_EMAIL and E2E_ADMIN_PASSWORD must be set (see playwright.config.ts).");
  }

  log(`waiting for the storefront server (build + fixtures) at ${STOREFRONT_URL} …`);
  await waitForHttp(STOREFRONT_URL, 300_000);

  log("starting the disposable in-memory MongoDB …");
  mongod = await MongoMemoryServer.create();
  const mongoUri = mongod.getUri("pearl_signature_e2e_orders");
  log(`in-memory database ready (${new URL(mongoUri).hostname})`);

  // Seed and bootstrap run as short-lived scripts against this URI. The
  // fixture flag lives ONLY here: it is what inserts the synthetic
  // orderable products, and the running server must not see it (its
  // catalogue comes from the database anyway).
  const dbEnv: NodeJS.ProcessEnv = {
    ...process.env,
    MONGODB_URI: mongoUri,
    NODE_ENV: "development",
    E2E_PURCHASABLE_FIXTURES: "1",
  };

  log("seeding the catalogue plus labelled orderable fixtures (scripts/seed.ts) …");
  await runToCompletion("npx tsx scripts/seed.ts --yes", dbEnv, "catalogue seed");

  log("creating the disposable owner account (scripts/admin-bootstrap.ts) …");
  await runToCompletion(
    "npx tsx scripts/admin-bootstrap.ts --yes --non-interactive",
    { ...dbEnv, ADMIN_EMAIL: email, ADMIN_PASSWORD: password },
    "owner bootstrap",
  );

  log("writing the labelled test store configuration …");
  await mongoose.connect(mongoUri, {
    serverSelectionTimeoutMS: 10_000,
    connectTimeoutMS: 10_000,
    autoIndex: false,
  });
  await writeTestStoreConfig();
  await StoreConfigModel.createIndexes();
  await mongoose.disconnect();

  const serverEnv: NodeJS.ProcessEnv = {
    ...process.env,
    MONGODB_URI: mongoUri,
    NODE_ENV: "production",
    NEXT_TELEMETRY_DISABLED: "1",
  };
  // The database wins in source resolution; never allow a fixtures override
  // to leak into the orders server from a developer shell.
  delete serverEnv.CATALOGUE_SOURCE;
  // Real credentials may exist in the operator's `.env.local`, which `next
  // start` loads automatically. The disposable stack must never see them.
  // Empty strings are never overridden by `.env.local` loading, and every
  // reader treats "" as unconfigured.
  serverEnv.CLOUDINARY_CLOUD_NAME = "";
  serverEnv.CLOUDINARY_API_KEY = "";
  serverEnv.CLOUDINARY_API_SECRET = "";
  serverEnv.NEXT_PUBLIC_CLOUDINARY_ENABLED = "";
  // The synthetic fixture flag is a seed-time input only (see above).
  delete serverEnv.E2E_PURCHASABLE_FIXTURES;

  log(`starting the orders server on http://localhost:${ORDERS_PORT} …`);
  ordersServer = spawn(`npx next start --port ${ORDERS_PORT}`, {
    cwd: ROOT,
    env: serverEnv,
    shell: true,
    stdio: "inherit",
  });
  ordersServer.once("error", (error) => {
    console.error(`[e2e-orders] orders server failed to start: ${error.message}`);
    void shutdown(1);
  });
  ordersServer.once("exit", (code, signal) => {
    if (!shuttingDown) {
      console.error(
        `[e2e-orders] orders server exited unexpectedly (code ${code ?? "null"}, signal ${signal ?? "none"})`,
      );
      void shutdown(1);
    }
  });

  log(`orders server launched; Playwright polls http://localhost:${ORDERS_PORT} …`);
  // Stay alive until Playwright terminates this tree (or a signal arrives).
  await new Promise<void>(() => undefined);
}

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    void shutdown(0);
  });
}

main().catch((error: unknown) => {
  console.error(`[e2e-orders] ${error instanceof Error ? error.message : String(error)}`);
  void shutdown(1);
});
