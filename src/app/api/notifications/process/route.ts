import { emailReadiness } from "@/lib/notifications/config";
import { isNotificationProcessorRequest } from "@/lib/notifications/auth";
import { attemptDueNotifications } from "@/lib/notifications/dispatch";

/**
 * Guarded notification processor (Phase 7).
 *
 * `POST /api/notifications/process` is the scheduler-facing entry point. It is
 * deliberately not a public trigger:
 *
 *  - 503 when `NOTIFICATION_PROCESSOR_SECRET` is absent (nothing is open by
 *    default),
 *  - 401 for a missing or wrong bearer secret,
 *  - 200 with bounded counters after one processing scan.
 *
 * The response never contains recipient addresses, message bodies, provider
 * payloads or configuration values. Order and payment writes remain
 * authoritative: this endpoint only drains the outbox.
 */

const NO_STORE = {
  "Cache-Control": "private, no-store, max-age=0",
  "Content-Type": "application/json; charset=utf-8",
  "X-Content-Type-Options": "nosniff",
};

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: NO_STORE });
}

export async function POST(request: Request): Promise<Response> {
  const readiness = emailReadiness();
  if (!readiness.processorConfigured) {
    return json(503, { error: "Notification processing is not configured" });
  }
  if (!isNotificationProcessorRequest(request)) {
    return json(401, { error: "Unauthorized" });
  }

  try {
    const result = await attemptDueNotifications();
    return json(200, {
      processed: result.processed,
      sent: result.sent,
      failed: result.failed,
      deferred: result.deferred,
      uncertain: result.uncertain,
      recovered: result.recovered,
      quotaBlocked: result.quotaBlocked,
    });
  } catch {
    // Internal details never leave this endpoint. The scheduler may retry.
    return json(500, { error: "Notification processing failed" });
  }
}
