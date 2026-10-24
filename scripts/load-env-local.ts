import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Minimal `.env.local` loader for operator scripts (Phase 3 follow-up).
 *
 * `next dev/build/start` load `.env.local` automatically, but plain Node
 * scripts (seed, admin bootstrap, admin reset) do not — while every error
 * message and guide tells operators to put `MONGODB_URI` there. This
 * loader closes that gap with no new dependency:
 *
 *   - NEVER overrides a variable that already exists in `process.env`
 *     (explicit shell/CI values win — the disposable e2e stack relies on
 *     this: its in-memory MongoDB URI always beats a developer's
 *     `.env.local`).
 *   - Silently does nothing when the file is absent (CI runs, test
 *     machines), so the explicit-env automation path keeps working.
 *   - Ignores blank lines and `#` comments; strips one pair of matching
 *     quotes; never truncates values containing `#` (connection strings
 *     and query strings must stay intact).
 *
 * Only operator scripts call this. The web app never imports it (Next.js
 * owns `.env.local` there), and `scripts/e2e-admin-server.ts` deliberately
 * does NOT load it: the disposable stack must stay isolated from real
 * credentials.
 */
export function loadEnvLocal(filename = ".env.local"): void {
  let raw: string;
  try {
    raw = readFileSync(resolve(process.cwd(), filename), "utf8");
  } catch {
    return; // absent file is a normal state for automation environments
  }

  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const separator = trimmed.indexOf("=");
    if (separator <= 0) continue;

    const key = trimmed.slice(0, separator).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;
    if (process.env[key] !== undefined) continue; // explicit env wins

    let value = trimmed.slice(separator + 1).trim();
    if (
      value.length >= 2 &&
      ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'")))
    ) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
}
