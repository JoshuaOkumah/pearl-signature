/**
 * Manual notification processor (Phase 7).
 *
 * The CLI twin of `POST /api/notifications/process`. Use it from the owner's
 * machine or a scheduled job when no deployment cron exists yet:
 *
 *   npm run notifications:process
 *   npm run notifications:process -- --limit=25
 *
 * It loads `.env.local` exactly like the other operator scripts, prints
 * readiness WITHOUT any secret, then drains one bounded batch. Exit code 0
 * means the scan ran (individual entries may still be pending, failed or
 * uncertain and are reported in the counters).
 *
 * The `react-server` condition is required because the dispatcher imports
 * `server-only`, whose default export throws outside a React Server
 * environment.
 */
import { loadEnvLocal } from "./load-env-local";
import mongoose from "mongoose";
import { emailReadiness } from "@/lib/notifications/config";
import { attemptDueNotifications } from "@/lib/notifications/dispatch";

loadEnvLocal();

function parseLimit(): number | undefined {
  const argument = process.argv.find((value) => value.startsWith("--limit="));
  if (!argument) return undefined;
  const parsed = Number(argument.slice("--limit=".length));
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}

async function main(): Promise<void> {
  const readiness = emailReadiness();
  console.log(`[notifications] provider: ${readiness.provider ?? "not configured"}`);
  console.log(
    `[notifications] delivery: ${readiness.configured ? "ready to attempt" : `unavailable (${readiness.reason})`}`,
  );
  console.log(
    `[notifications] owner recipient: ${readiness.ownerRecipientConfigured ? "configured" : "not configured"}`,
  );

  const result = await attemptDueNotifications(undefined, { limit: parseLimit() });
  console.log("[notifications] scan result:");
  console.log(JSON.stringify(result, null, 2));
  console.log(
    "[notifications] accepted means the provider queued the message, not that it was delivered.",
  );
}

main()
  .catch((error: unknown) => {
    console.error(
      "[notifications] processing failed:",
      error instanceof Error ? error.message : "unknown error",
    );
    process.exitCode = 1;
  })
  .finally(async () => {
    // Close the pool so a one-shot CLI run exits instead of waiting on an
    // idle socket.
    await mongoose.disconnect().catch(() => undefined);
  });
