import "server-only";
import { connectDatabase, logDatabaseError } from "@/lib/db/mongoose";
import { AdminModel } from "@/models/admin";
import {
  MAX_NOTIFICATION_ATTEMPTS,
  NotificationOutboxModel,
  type NotificationOutboxRecord,
} from "@/models/notification-outbox";
import { OrderModel } from "@/models/order";
import {
  NOT_CONFIGURED_REASON,
  NotificationDeliveryError,
  resolveNotificationProvider,
  type NotificationProvider,
} from "./provider";
import {
  NOTIFICATION_EVENT_ROLES,
  buildNotification,
  notificationKey,
  type NotificationEvent,
  type NotificationOrderFacts,
} from "./templates";

/**
 * Notification dispatch (Phase 5, Milestone E).
 *
 * Two entry points, one rule: **nothing here may ever fail the business
 * operation that triggered it.**
 *
 *  - `notifyOrderEvent(event, reference)` — called by order creation and
 *    by status changes. It AWAITs the idempotent enqueue (so the entries
 *    exist before the caller returns and can be verified), then kicks off
 *    a delivery attempt in the background. Every error is caught and
 *    logged; the promise never rejects.
 *  - `attemptDueNotifications(provider?)` — scans due `pending` entries,
 *    resolves each recipient, renders the message and hands it to the
 *    provider. Also never rejects; it reports counts instead.
 *
 * ## Delivery model, stated honestly
 *
 * Phase 5 has no cron and no queue worker. Attempts happen opportunistically:
 * whenever an order event enqueues new work, the same request scans for due
 * entries (bounded to `NOTIFICATION_BATCH_LIMIT`), and backoff delays the
 * rest to a later scan. An entry whose next attempt lands between scans
 * waits for the next order event. This is enough for a low-volume store and
 * is documented as a known limitation in docs/ORDER_NOTIFICATIONS.md — no
 * scheduler is pretended where none exists.
 *
 * ## Recipients are resolved at dispatch time
 *
 * The outbox stores no email or name (see the model). The customer's
 * address comes from the order; the store's from the active owner admin.
 * That is why a notification's personal data never sits in a queue
 * document, a shared index or a log line.
 */

/** Most entries processed per scan — bounds the work any request does. */
export const NOTIFICATION_BATCH_LIMIT = 10;

/** Wait before re-checking while no provider is configured (attempts stay 0). */
export const NOT_CONFIGURED_RETRY_MS = 15 * 60 * 1_000;

const BASE_BACKOFF_MS = 60 * 1_000;
const MAX_BACKOFF_MS = 60 * 60 * 1_000;

/**
 * Pure backoff schedule: `60s, 2m, 4m, 8m`, capped at one hour.
 *
 * `attempts` is the FAILURE count AFTER the new failure (1-based). Guarded
 * so a large input can never produce `Infinity`.
 */
export function nextAttemptDelayMs(attempts: number): number {
  const exponent = Math.min(Math.max(attempts, 1) - 1, 20);
  return Math.min(BASE_BACKOFF_MS * 2 ** exponent, MAX_BACKOFF_MS);
}

export interface NotificationAttemptResult {
  /** Entries whose delivery was attempted or resolved this scan. */
  processed: number;
  sent: number;
  /** Terminal: non-retryable problem or retries exhausted. */
  failed: number;
  /** Kept `pending` for a later attempt (includes "not configured"). */
  deferred: number;
}

/* ── enqueue (idempotent) ───────────────────────────────────────────── */

/**
 * Write the outbox entries for one order event.
 *
 * Idempotent by construction: each entry upserts on its unique key, so a
 * replayed order placement or a retried action cannot double-notify. All
 * failures are swallowed — enqueueing happens AFTER the business write
 * succeeded, and a queue problem cannot undo it.
 */
export async function enqueueOrderNotifications(
  event: NotificationEvent,
  reference: string,
): Promise<void> {
  try {
    await connectDatabase();
    const now = new Date();
    for (const role of NOTIFICATION_EVENT_ROLES[event]) {
      const key = notificationKey(event, reference, role);
      await NotificationOutboxModel.updateOne(
        { key },
        {
          $setOnInsert: {
            key,
            event,
            reference,
            recipientRole: role,
            status: "pending",
            attempts: 0,
            lastReason: null,
            nextAttemptAt: now,
            sentAt: null,
          },
        },
        { upsert: true },
      );
    }
  } catch (error) {
    logDatabaseError("notification-enqueue", error);
  }
}

/**
 * The public entry point for order events: enqueue, then attempt delivery
 * in the background. Awaited by `createOrder` and the status-change action
 * for the ENQUEUE only — the scan is fire-and-forget and can neither slow
 * the response nor fail the action.
 */
export async function notifyOrderEvent(
  event: NotificationEvent,
  reference: string,
): Promise<void> {
  await enqueueOrderNotifications(event, reference);
  void attemptDueNotifications();
}

/* ── attempt (background, bounded, never throws) ────────────────────── */

/**
 * Process due `pending` entries, up to `NOTIFICATION_BATCH_LIMIT`.
 *
 * The optional provider argument exists for tests and for callers that
 * already resolved one; the default reads `NOTIFICATION_PROVIDER` at call
 * time so configuration changes are picked up without a restart.
 */
export async function attemptDueNotifications(
  provider: NotificationProvider = resolveNotificationProvider(),
): Promise<NotificationAttemptResult> {
  const result: NotificationAttemptResult = { processed: 0, sent: 0, failed: 0, deferred: 0 };

  try {
    await connectDatabase();
    const now = new Date();

    if (!provider.configured) {
      // Honest idle state: nothing is sent, no attempt is consumed, and
      // the due time moves forward so scans keep skipping this entry
      // quickly until the business configures a provider.
      const deferred = await NotificationOutboxModel.updateMany(
        { status: "pending", nextAttemptAt: { $lte: now } },
        {
          $set: {
            lastReason: NOT_CONFIGURED_REASON,
            nextAttemptAt: new Date(now.getTime() + NOT_CONFIGURED_RETRY_MS),
          },
        },
      );
      result.deferred = deferred.modifiedCount;
      return result;
    }

    const due = await NotificationOutboxModel.find({
      status: "pending",
      nextAttemptAt: { $lte: now },
    })
      .sort({ nextAttemptAt: 1, _id: 1 })
      .limit(NOTIFICATION_BATCH_LIMIT);

    for (const entry of due) {
      result.processed += 1;
      try {
        await deliverOne(provider, entry, now, result);
      } catch (error) {
        // Infrastructure trouble reading the order or writing the entry:
        // leave it pending for a later scan without consuming a retry.
        logDatabaseError("notification-delivery", error);
        result.deferred += 1;
      }
    }
  } catch (error) {
    logDatabaseError("notification-attempt", error);
  }

  return result;
}

/* ── internals ──────────────────────────────────────────────────────── */

/** The order fields a message may state, plus the customer's address. */
interface OrderFacts extends NotificationOrderFacts {
  customerEmail: string | null;
}

async function loadOrderFacts(reference: string): Promise<OrderFacts | null> {
  const order = await OrderModel.findOne({ reference })
    .select({
      reference: 1,
      status: 1,
      "fulfillment.method": 1,
      "money.totalCents": 1,
      "customer.fullName": 1,
      "customer.email": 1,
    })
    .lean();
  if (!order) return null;
  return {
    reference: order.reference,
    status: order.status,
    method: order.fulfillment.method,
    totalCents: order.money.totalCents,
    customerName: order.customer.fullName,
    customerEmail: order.customer.email ?? null,
  };
}

/** The store's recipient: the active owner admin, resolved per attempt. */
async function adminRecipientEmail(): Promise<string | null> {
  const admin = await AdminModel.findOne({ role: "owner", status: "active" })
    .select({ email: 1 })
    .lean();
  return admin?.email ?? null;
}

/** Park an entry permanently with an operator-readable, PII-free reason. */
async function settleFailed(
  entry: NotificationOutboxRecord,
  reason: string,
): Promise<void> {
  await NotificationOutboxModel.updateOne(
    { _id: entry._id, status: "pending" },
    {
      $set: {
        status: "failed",
        lastReason: reason.slice(0, 300),
        nextAttemptAt: new Date(),
      },
    },
  );
}

async function deliverOne(
  provider: NotificationProvider,
  entry: NotificationOutboxRecord,
  now: Date,
  result: NotificationAttemptResult,
): Promise<void> {
  const facts = await loadOrderFacts(entry.reference);
  if (!facts) {
    // The order is gone (or the reference is stale): retrying can never
    // succeed, so the entry fails immediately with a readable reason.
    await settleFailed(entry, "The order for this notification no longer exists");
    result.failed += 1;
    return;
  }

  let recipient: string | null;
  if (entry.recipientRole === "customer") {
    recipient = facts.customerEmail;
    if (!recipient) {
      await settleFailed(entry, "The order has no customer email address");
      result.failed += 1;
      return;
    }
  } else {
    recipient = await adminRecipientEmail();
    if (!recipient) {
      await settleFailed(entry, "No active admin recipient is configured");
      result.failed += 1;
      return;
    }
  }

  const message = buildNotification(entry.event, entry.recipientRole, facts);

  try {
    await provider.send({
      to: recipient,
      subject: message.subject,
      text: message.text,
    });
  } catch (error) {
    const attempts = entry.attempts + 1;
    const retryable = !(error instanceof NotificationDeliveryError) || error.retryable;
    // Only OUR error messages are stored: a third-party message might
    // contain the recipient address, and the outbox keeps no personal data.
    const reason =
      error instanceof NotificationDeliveryError
        ? error.message
        : "The notification provider failed to send the message";

    if (!retryable || attempts >= MAX_NOTIFICATION_ATTEMPTS) {
      await NotificationOutboxModel.updateOne(
        { _id: entry._id, status: "pending" },
        { $set: { status: "failed", attempts, lastReason: reason.slice(0, 300) } },
      );
      result.failed += 1;
    } else {
      await NotificationOutboxModel.updateOne(
        { _id: entry._id, status: "pending" },
        {
          $set: {
            attempts,
            lastReason: reason.slice(0, 300),
            nextAttemptAt: new Date(now.getTime() + nextAttemptDelayMs(attempts)),
          },
        },
      );
      result.deferred += 1;
    }
    return;
  }

  await NotificationOutboxModel.updateOne(
    { _id: entry._id, status: "pending" },
    { $set: { status: "sent", sentAt: now, lastReason: null } },
  );
  result.sent += 1;
}
