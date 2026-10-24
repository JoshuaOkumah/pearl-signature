/**
 * Phase 3 admin E2E server harness (second Playwright webServer entry).
 *
 * The first webServer entry (`npm run build && npm run start`) owns the
 * build and serves the labelled preview fixtures on port 3000. This
 * harness runs alongside it and:
 *
 *   1. Waits until the storefront server responds, so it can reuse the
 *      SAME `.next` build (one build per run, no build race).
 *   2. Boots a disposable in-memory MongoDB (mongodb-memory-server).
 *   3. Seeds the preview catalogue through the real `scripts/seed.ts`.
 *   4. Creates the disposable owner account through the real
 *      `scripts/admin-bootstrap.ts` (credentials via env, never argv).
 *   5. Starts `next start` on port 3001 with MONGODB_URI pointing at the
 *      in-memory database, so admin reads and storefront reads both hit
 *      the database (mutations become publicly visible on that server).
 *   6. Tears everything down on SIGINT/SIGTERM/exit; Playwright also
 *      kills the whole process tree (Windows: taskkill /T) when the run
 *      ends.
 *
 * Everything here is test-only: no cloud services, no real credentials.
 */
import { spawn, spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { MongoMemoryServer } from "mongodb-memory-server";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const STOREFRONT_URL = process.env.E2E_STOREFRONT_URL ?? "http://localhost:3000";
const ADMIN_PORT = 3001;

let mongod: MongoMemoryServer | null = null;
let adminServer: ReturnType<typeof spawn> | null = null;
let shuttingDown = false;

function log(message: string): void {
  console.log(`[e2e-admin] ${message}`);
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

function killAdminServerTree(): void {
  if (!adminServer?.pid) return;
  if (process.platform === "win32") {
    try {
      spawnSync("taskkill", ["/pid", String(adminServer.pid), "/T", "/F"], { stdio: "ignore" });
    } catch {
      // Already gone.
    }
  } else if (!adminServer.killed) {
    adminServer.kill("SIGTERM");
  }
}

async function shutdown(code: number): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  killAdminServerTree();
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
  const mongoUri = mongod.getUri("pearl_signature_e2e");
  log(`in-memory database ready (${new URL(mongoUri).hostname})`);

  // Seed and bootstrap run as short-lived scripts against this URI.
  const dbEnv: NodeJS.ProcessEnv = { ...process.env, MONGODB_URI: mongoUri, NODE_ENV: "development" };

  log("seeding the preview catalogue (scripts/seed.ts) …");
  await runToCompletion("npx tsx scripts/seed.ts --yes", dbEnv, "catalogue seed");

  log("creating the disposable owner account (scripts/admin-bootstrap.ts) …");
  await runToCompletion(
    "npx tsx scripts/admin-bootstrap.ts --yes --non-interactive",
    { ...dbEnv, ADMIN_EMAIL: email, ADMIN_PASSWORD: password },
    "owner bootstrap",
  );

  const serverEnv: NodeJS.ProcessEnv = {
    ...process.env,
    MONGODB_URI: mongoUri,
    NODE_ENV: "production",
    NEXT_TELEMETRY_DISABLED: "1",
  };
  // The database wins in source resolution; never allow a fixtures override
  // to leak into the admin server from a developer shell.
  delete serverEnv.CATALOGUE_SOURCE;
  // Real credentials may exist in the operator's `.env.local`, which `next
  // start` loads automatically. The disposable stack must never see them:
  // an "upload" test would otherwise create REAL Cloudinary assets, and the
  // suite's honest "uploads are not configured" state would silently become
  // false. Empty strings are never overridden by `.env.local` loading, and
  // every reader treats "" as unconfigured.
  serverEnv.CLOUDINARY_CLOUD_NAME = "";
  serverEnv.CLOUDINARY_API_KEY = "";
  serverEnv.CLOUDINARY_API_SECRET = "";
  serverEnv.NEXT_PUBLIC_CLOUDINARY_ENABLED = "";

  log(`starting the admin server on http://localhost:${ADMIN_PORT} …`);
  adminServer = spawn(`npx next start --port ${ADMIN_PORT}`, {
    cwd: ROOT,
    env: serverEnv,
    shell: true,
    stdio: "inherit",
  });
  adminServer.once("error", (error) => {
    console.error(`[e2e-admin] admin server failed to start: ${error.message}`);
    void shutdown(1);
  });
  adminServer.once("exit", (code, signal) => {
    if (!shuttingDown) {
      console.error(
        `[e2e-admin] admin server exited unexpectedly (code ${code ?? "null"}, signal ${signal ?? "none"})`,
      );
      void shutdown(1);
    }
  });

  log(`admin server launched; Playwright polls http://localhost:${ADMIN_PORT} …`);
  // Stay alive until Playwright terminates this tree (or a signal arrives).
  await new Promise<void>(() => undefined);
}

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    void shutdown(0);
  });
}

main().catch((error: unknown) => {
  console.error(`[e2e-admin] ${error instanceof Error ? error.message : String(error)}`);
  void shutdown(1);
});
