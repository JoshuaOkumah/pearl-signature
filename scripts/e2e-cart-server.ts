/**
 * Phase 4 cart E2E server harness (third Playwright webServer entry).
 *
 * The first webServer entry (`npm run build && npm run start`) owns the build
 * and serves the honest, entirely unpriced preview fixtures on port 3000 —
 * which is exactly right for the catalogue and mobile suites, and useless for
 * testing a shopping cart, because nothing there can be bought.
 *
 * This harness reuses the SAME `.next` build (one build per run) and starts a
 * second `next start` on port 3002 with `E2E_PURCHASABLE_FIXTURES=1`. That
 * flag is the only thing that adds a handful of clearly-labelled synthetic
 * orderable products to the fixture set (see `src/data/e2e-products.ts`), so
 * the cart and checkout suites have something real to add, price and
 * reconcile. It is never set by `next dev`, by production, or by the other
 * two projects.
 *
 * The env var is read when the fixture module is evaluated by the SERVER at
 * request time, not inlined at build time — the same mechanism the admin
 * harness already relies on to point `MONGODB_URI` at its in-memory database.
 *
 * Everything here is test-only: no cloud services, no real credentials.
 */
import { spawn, spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const STOREFRONT_URL = process.env.E2E_STOREFRONT_URL ?? "http://localhost:3000";
const CART_PORT = 3002;

let cartServer: ReturnType<typeof spawn> | null = null;
let shuttingDown = false;

function log(message: string): void {
  console.log(`[e2e-cart] ${message}`);
}

/** Poll until the URL answers any HTTP status (5xx means "still settling"). */
async function waitForHttp(url: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(4_000), redirect: "manual" });
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

function killCartServerTree(): void {
  if (!cartServer?.pid) return;
  if (process.platform === "win32") {
    try {
      spawnSync("taskkill", ["/pid", String(cartServer.pid), "/T", "/F"], { stdio: "ignore" });
    } catch {
      // Already gone.
    }
  } else if (!cartServer.killed) {
    cartServer.kill("SIGTERM");
  }
}

function shutdown(code: number): void {
  if (shuttingDown) return;
  shuttingDown = true;
  killCartServerTree();
  process.exit(code);
}

async function main(): Promise<void> {
  log(`waiting for the storefront server (build + fixtures) at ${STOREFRONT_URL} …`);
  await waitForHttp(STOREFRONT_URL, 300_000);

  const serverEnv: NodeJS.ProcessEnv = {
    ...process.env,
    NODE_ENV: "production",
    NEXT_TELEMETRY_DISABLED: "1",
    CATALOGUE_SOURCE: "fixtures",
    E2E_PURCHASABLE_FIXTURES: "1",
  };

  // Real credentials may exist in the operator's `.env.local`, which
  // `next start` loads automatically. The disposable stack must never see
  // them: an upload would otherwise create REAL Cloudinary assets, and a
  // MONGODB_URI would defeat `CATALOGUE_SOURCE=fixtures` entirely, because
  // resolveCatalogueSource gives the URI precedence — the cart suite would
  // then read the live catalogue and find no orderable E2E fixtures at all.
  // Empty strings are never overridden by `.env.local` loading, and every
  // reader treats "" as unconfigured.
  serverEnv.CLOUDINARY_CLOUD_NAME = "";
  serverEnv.CLOUDINARY_API_KEY = "";
  serverEnv.CLOUDINARY_API_SECRET = "";
  serverEnv.NEXT_PUBLIC_CLOUDINARY_ENABLED = "";
  serverEnv.MONGODB_URI = "";

  log(`starting the cart fixture server on http://localhost:${CART_PORT} …`);
  cartServer = spawn(`npx next start --port ${CART_PORT}`, {
    cwd: ROOT,
    env: serverEnv,
    shell: true,
    stdio: "inherit",
  });
  cartServer.once("error", (error) => {
    console.error(`[e2e-cart] cart server failed to start: ${error.message}`);
    shutdown(1);
  });
  cartServer.once("exit", (code, signal) => {
    if (!shuttingDown) {
      console.error(
        `[e2e-cart] cart server exited unexpectedly (code ${code ?? "null"}, signal ${signal ?? "none"})`,
      );
      shutdown(1);
    }
  });

  log(`cart server launched; Playwright polls http://localhost:${CART_PORT} …`);
  // Stay alive until Playwright terminates this tree (or a signal arrives).
  await new Promise<void>(() => undefined);
}

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => shutdown(0));
}

main().catch((error: unknown) => {
  console.error(`[e2e-cart] ${error instanceof Error ? error.message : String(error)}`);
  shutdown(1);
});
