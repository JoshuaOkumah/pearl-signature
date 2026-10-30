import "server-only";
import { randomBytes } from "node:crypto";
import { isValidObjectId } from "mongoose";
import { connectDatabase, logDatabaseError } from "@/lib/db/mongoose";
import { AdminModel } from "@/models/admin";
import {
  MAX_NOTIFICATION_AMBIGUOUS_ATTEMPTS,
  MAX_NOTIFICATION_ATTEMPTS,
  NOTIFICATION_LEASE_MS,
  NotificationOutboxModel,
  type NotificationOutboxRecord,
} from "@/models/notification-outbox";
import { OrderModel } from "@/models/order";
import { notificationConfig } from "./config";
import {
  NotificationDeliveryError,
  NOT_CONFIGURED_REASON,
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
import type { OrderStatus } from "@/lib/validations/order";

/**
 * Notification dispatch and outbox processing (Phase 5, extended in Phase 7).
 *
 * Two entry points, one rule: **nothing here may ever fail the business
 * operation that triggered it.**
 *
 *  - `notifyOrderEvent(event, reference)` is called AFTER a committed order or
 *    payment write. It AWAITs the idempotent enqueue (so entries exist before
 *    the caller returns and can be verified), then kicks off a best-effort
 *    delivery scan. The scan is fire-and-forget: it cannot slow the response
 *    and cannot fail the action.
 *  - `attemptDueNotifications(provider?)` is the processor. It is also called
 *    by the guarded `/api/notifications/process` route and the CLI.
 *
 * ## Claiming and leases
 *
 * An entry is claimed atomically (`pending` -> `processing`) with a random
 * lease token and expiry. Every settlement write includes the token, so a
 * processor whose lease expired can no longer mark the entry. A crash is
 * recovered by the next scan: expired leases return to `pending` with an honest
 * reason and a consumed attempt.
 *
 * ## Acceptance versus delivery
 *
 * A provider resolving means the provider ACCEPTED the message. The entry is
 * marked `sent` with the provider message id and `providerStatus: "accepted"`.
 * Only a verified delivery callback may change that to `delivered`, `bounced`
 * or `complained`.
 *
 * ## Duplicate protection
 *
 * The unique outbox key is the durable duplicate guard. Every provider request
 * also carries that key as an idempotency key, which narrows the window where an
 * ambiguous retry could duplicate a message. Ambiguous outcomes are retried a
 * bounded number of times and then parked as `uncertain` for an operator.
 *
 * ## Recipients
 *
 * The queue stores no personal data. The customer address comes from the order;
 * the owner address comes from `OWNER_NOTIFICATION_EMAIL` when configured, then
 * from the active owner admin account. Both are resolved per attempt.
 */

/** Most entries processed per scan - bounds the work any request does. */
export const NOTIFICATION_BATCH_LIMIT = 10;

/** Wait before re-checking while no provider is configured (attempts stay 0). */
export const NOT_CONFIGURED_RETRY_MS = 15 * 60 * 1_000;

/** Wait before re-checking after the provider rate-limited us. */
export const RATE_LIMITED_RETRY_MS = 15 * 60 * 1_000;

/** Fixed, PII-free reason shown while the configured quota is exhausted. */
export const QUOTA_REASON = "The configured email sending limit has been reached";

/** Fixed reason for an interrupted attempt recovered from an expired lease. */
export const INTERRUPTED_REASON = "A previous delivery attempt was interrupted before it was recorded";

const BASE_BACKOFF_MS = 60 * 1_000;
const MAX_BACKOFF_MS = 60 * 60 * 1_000;

/**
 * Pure backoff schedule: `60s, 2m, 4m, 8m`, capped at one hour.
 *
 * `attempts` is the FAILURE count AFTER the new failure (1-based). Guarded so a
 * large input can never produce `Infinity`.
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
  /** Parked because the provider outcome stayed ambiguous. */
  uncertain: number;
  /** Expired leases returned to the queue before this scan. */
  recovered: number;
  /** True when the configured monthly/daily limit stopped this scan. */
  quotaBlocked: boolean;
}

function emptyResult(): NotificationAttemptResult {
  return {
    processed: 0,
    sent: 0,
    failed: 0,
    deferred: 0,
    uncertain: 0,
    recovered: 0,
    quotaBlocked: false,
  };
}

function newLeaseToken(): string {
  return randomBytes(24).toString("hex");
}

/* ── enqueue (idempotent) ───────────────────────────────────────────── */

/**
 * Write the outbox entries for one order event.
 *
 * Idempotent by construction: each entry upserts on its unique key, so a
 * replayed order placement or a retried action cannot double-notify. All
 * failures are swallowed - enqueueing happens AFTER the business write
 * succeeded, and a queue problem cannot undo it.
 */
export async function enqueueOrderNotifications(
  event: NotificationEvent,
  reference: string,
  transition: OrderStatus | null = null,
): Promise<void> {
  try {
    await persistOrderNotifications(event, reference, transition);
  } catch (error) {
    logDatabaseError("notification-enqueue", error);
  }
}

/** Durable variant for webhook acknowledgements: callers must retry the
 * provider event if the outbox write cannot be committed. Delivery remains
 * decoupled; only inserting its idempotent queue entry is required. */
export async function persistOrderNotifications(
  event: NotificationEvent,
  reference: string,
  transition: OrderStatus | null = null,
): Promise<void> {
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
          transition,
          recipientRole: role,
          status: "pending",
          attempts: 0,
          ambiguousAttempts: 0,
          lastReason: null,
          nextAttemptAt: now,
          lastAttemptAt: null,
          sentAt: null,
          leaseToken: null,
          leaseExpiresAt: null,
          providerId: null,
          providerStatus: null,
          providerStatusAt: null,
        },
      },
      { upsert: true },
    );
  }
}

export async function notifyOrderEventDurably(
  event: NotificationEvent,
  reference: string,
  transition: OrderStatus | null = null,
): Promise<void> {
  await persistOrderNotifications(event, reference, transition);
  kickProcessing();
}

/**
 * The public entry point for order events: enqueue, then attempt delivery in
 * the background. Awaited by `createOrder` and the status-change action for the
 * ENQUEUE only - the scan is fire-and-forget and can neither slow the response
 * nor fail the action.
 */
export async function notifyOrderEvent(
  event: NotificationEvent,
  reference: string,
  transition: OrderStatus | null = null,
): Promise<void> {
  await enqueueOrderNotifications(event, reference, transition);
  kickProcessing();
}

/**
 * Best-effort latency improvement only. Scheduled/manual processing is the
 * delivery guarantee; this promise is deliberately detached and never rejects.
 */
function kickProcessing(): void {
  void attemptDueNotifications().catch(() => {
    // `attemptDueNotifications` already swallows its own failures; this is a
    // belt-and-braces guard so a detached promise can never become an
    // unhandled rejection.
  });
}

/* ── volume and quota ───────────────────────────────────────────────── */

export interface NotificationVolume {
  sentToday: number;
  sentThisMonth: number;
  dailyLimit: number;
  monthlyLimit: number;
  remaining: number;
}

function startOfDay(now: Date): Date {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

function startOfMonth(now: Date): Date {
  return new Date(now.getFullYear(), now.getMonth(), 1);
}

/** Lightweight send-volume count: accepted entries only, bounded by the TTL. */
export async function notificationVolume(now = new Date()): Promise<NotificationVolume> {
  const config = notificationConfig();
  const [sentToday, sentThisMonth] = await Promise.all([
    NotificationOutboxModel.countDocuments({ status: "sent", sentAt: { $gte: startOfDay(now) } }),
    NotificationOutboxModel.countDocuments({ status: "sent", sentAt: { $gte: startOfMonth(now) } }),
  ]);
  const remaining = Math.max(
    0,
    Math.min(config.monthlyLimit - sentThisMonth, config.dailyLimit - sentToday),
  );
  return {
    sentToday,
    sentThisMonth,
    dailyLimit: config.dailyLimit,
    monthlyLimit: config.monthlyLimit,
    remaining,
  };
}

/* ── lease recovery ─────────────────────────────────────────────────── */

/**
 * Return expired claims to the queue. The attempt and ambiguous counters move
 * forward because we cannot know whether the interrupted request reached the
 * provider; the provider idempotency key is unchanged, so the retry stays as
 * safe as the provider's retention window allows.
 */
export async function recoverExpiredLeases(now = new Date()): Promise<number> {
  const result = await NotificationOutboxModel.updateMany(
    { status: "processing", leaseExpiresAt: { $lte: now } },
    {
      $set: {
        status: "pending",
        leaseToken: null,
        leaseExpiresAt: null,
        lastReason: INTERRUPTED_REASON,
        nextAttemptAt: now,
      },
      $inc: { attempts: 1, ambiguousAttempts: 1 },
    },
  );
  return result.modifiedCount;
}

/* ── attempt (background, bounded, never throws) ────────────────────── */

export interface AttemptOptions {
  now?: Date;
  limit?: number;
  leaseMs?: number;
}

/**
 * Process due `pending` entries, up to `NOTIFICATION_BATCH_LIMIT`.
 *
 * The optional provider argument exists for tests and for callers that already
 * resolved one; the default reads `NOTIFICATION_PROVIDER` at call time so
 * configuration changes are picked up without a restart.
 */
export async function attemptDueNotifications(
  provider: NotificationProvider = resolveNotificationProvider(),
  options: AttemptOptions = {},
): Promise<NotificationAttemptResult> {
  const result = emptyResult();
  const now = options.now ?? new Date();
  const limit = Math.max(1, options.limit ?? NOTIFICATION_BATCH_LIMIT);
  const leaseMs = Math.max(1_000, options.leaseMs ?? NOTIFICATION_LEASE_MS);

  try {
    await connectDatabase();

    result.recovered = await recoverExpiredLeases(now);

    if (!provider.configured) {
      // Honest idle state: nothing is sent, no attempt is consumed, and the due
      // time moves forward so scans keep skipping these entries quickly until
      // the business configures a provider.
      const deferred = await NotificationOutboxModel.updateMany(
        { status: "pending", nextAttemptAt: { $lte: now } },
        {
          $set: {
            lastReason: provider.reason ?? NOT_CONFIGURED_REASON,
            nextAttemptAt: new Date(now.getTime() + NOT_CONFIGURED_RETRY_MS),
          },
        },
      );
      result.deferred = deferred.modifiedCount;
      return result;
    }

    const volume = await notificationVolume(now);
    let remainingQuota = volume.remaining;

    if (remainingQuota <= 0) {
      const deferred = await NotificationOutboxModel.updateMany(
        { status: "pending", nextAttemptAt: { $lte: now } },
        {
          $set: {
            lastReason: QUOTA_REASON,
            nextAttemptAt: new Date(now.getTime() + 60 * 60 * 1_000),
          },
        },
      );
      result.deferred = deferred.modifiedCount;
      result.quotaBlocked = true;
      return result;
    }

    for (let index = 0; index < limit && remainingQuota > 0; index += 1) {
      const claim = await claimNextDue(now, leaseMs);
      if (!claim) break;
      result.processed += 1;
      try {
        const sent = await deliverClaimed(provider, claim, now, result);
        if (sent) remainingQuota -= 1;
      } catch (error) {
        // Infrastructure trouble reading the order or writing the entry:
        // release the claim without consuming a retry so a later scan can
        // retry immediately. The provider call itself already classifies its
        // own failures inside `deliverClaimed`.
        logDatabaseError("notification-delivery", error);
        await releaseClaim(claim, now);
        result.deferred += 1;
        // Stop this scan: a database fault is unlikely to clear on the very
        // next entry, and the released entry must not be re-claimed in a loop.
        break;
      }
    }
  } catch (error) {
    logDatabaseError("notification-attempt", error);
  }

  return result;
}

/** Atomically claim the oldest due entry. Returns null when none is due. */
async function claimNextDue(
  now: Date,
  leaseMs: number,
): Promise<NotificationOutboxRecord | null> {
  const token = newLeaseToken();
  const claimed = await NotificationOutboxModel.findOneAndUpdate(
    { status: "pending", nextAttemptAt: { $lte: now } },
    {
      $set: {
        status: "processing",
        leaseToken: token,
        leaseExpiresAt: new Date(now.getTime() + leaseMs),
        lastAttemptAt: now,
      },
    },
    { sort: { nextAttemptAt: 1, _id: 1 }, returnDocument: "after" },
  ).lean();
  return (claimed as NotificationOutboxRecord | null) ?? null;
}

/* ── internals ──────────────────────────────────────────────────────── */

/** The order fields a message may state, plus the customer's address. */
interface OrderFacts extends NotificationOrderFacts {
  customerEmail: string | null;
}

async function loadOrderFacts(
  reference: string,
  transition: OrderStatus | null,
): Promise<OrderFacts | null> {
  const order = await OrderModel.findOne({ reference })
    .select({
      reference: 1,
      status: 1,
      "fulfillment.method": 1,
      "fulfillment.serviceAreaLabel": 1,
      "fulfillment.pickupInstructions": 1,
      "money.subtotalCents": 1,
      "money.deliveryFeeCents": 1,
      "money.taxCents": 1,
      "money.totalCents": 1,
      "money.currency": 1,
      "money.taxLabel": 1,
      "customer.fullName": 1,
      "customer.email": 1,
      "payment.method": 1,
      "payment.status": 1,
      items: 1,
      statusHistory: 1,
      createdAt: 1,
    })
    .lean();
  if (!order) return null;

  // A status message describes the transition that produced it, even if the
  // order has since moved further. The stored transition is authoritative.
  const status = transition ?? order.status;
  const history = Array.isArray(order.statusHistory) ? order.statusHistory : [];
  const matching = transition
    ? [...history].reverse().find((entry) => entry.to === transition)
    : undefined;

  return {
    reference: order.reference,
    status,
    method: order.fulfillment.method,
    totalCents: order.money.totalCents,
    customerName: order.customer.fullName,
    customerEmail: order.customer.email ?? null,
    paymentMethod: order.payment.method,
    paymentStatus: order.payment.status,
    items: (order.items ?? []).map((item) => ({
      name: item.name,
      variantName: item.variantName ?? null,
      quantity: item.quantity,
      unitPriceCents: item.unitPriceCents,
      lineTotalCents: item.lineTotalCents,
    })),
    money: {
      currency: "CAD",
      subtotalCents: order.money.subtotalCents,
      deliveryFeeCents: order.money.deliveryFeeCents,
      taxCents: order.money.taxCents,
      totalCents: order.money.totalCents,
      taxLabel: order.money.taxLabel ?? null,
    },
    placedAtIso: order.createdAt ? new Date(order.createdAt).toISOString() : undefined,
    statusChangedAtIso: matching?.at ? new Date(matching.at).toISOString() : null,
    serviceAreaLabel: order.fulfillment.serviceAreaLabel ?? null,
    pickupInstructions: order.fulfillment.pickupInstructions ?? null,
    siteUrl: notificationConfig().siteUrl,
  };
}

/** The store's recipient: the configured owner address, then the active owner. */
async function adminRecipientEmail(): Promise<string | null> {
  const configured = notificationConfig().ownerRecipient;
  if (configured) return configured;
  const admin = await AdminModel.findOne({ role: "owner", status: "active" })
    .select({ email: 1 })
    .lean();
  return admin?.email ?? null;
}

interface SettlementFilter {
  _id: unknown;
  status: "processing";
  leaseToken: string;
}

function settlementFilter(entry: NotificationOutboxRecord): SettlementFilter {
  return { _id: entry._id, status: "processing", leaseToken: entry.leaseToken ?? "" };
}

/** Park an entry permanently with an operator-readable, PII-free reason. */
async function settleFailed(
  entry: NotificationOutboxRecord,
  reason: string,
  attempts = entry.attempts,
): Promise<boolean> {
  const result = await NotificationOutboxModel.updateOne(settlementFilter(entry), {
    $set: {
      status: "failed",
      attempts,
      lastReason: reason.slice(0, 300),
      nextAttemptAt: new Date(),
      leaseToken: null,
      leaseExpiresAt: null,
    },
  });
  return result.matchedCount > 0;
}

async function settlePending(
  entry: NotificationOutboxRecord,
  update: {
    attempts?: number;
    ambiguousAttempts?: number;
    lastReason: string;
    delayMs: number;
    now: Date;
  },
): Promise<boolean> {
  const result = await NotificationOutboxModel.updateOne(settlementFilter(entry), {
    $set: {
      status: "pending",
      ...(update.attempts === undefined ? {} : { attempts: update.attempts }),
      ...(update.ambiguousAttempts === undefined ? {} : { ambiguousAttempts: update.ambiguousAttempts }),
      lastReason: update.lastReason.slice(0, 300),
      nextAttemptAt: new Date(update.now.getTime() + update.delayMs),
      leaseToken: null,
      leaseExpiresAt: null,
    },
  });
  return result.matchedCount > 0;
}

/** Return a claim to the queue without consuming a retry (infrastructure fault). */
async function releaseClaim(entry: NotificationOutboxRecord, now: Date): Promise<void> {
  try {
    await NotificationOutboxModel.updateOne(settlementFilter(entry), {
      $set: {
        status: "pending",
        leaseToken: null,
        leaseExpiresAt: null,
        lastReason: null,
        nextAttemptAt: now,
      },
    });
  } catch {
    // If even the release write fails, the lease expiry recovers the entry.
  }
}

async function settleUncertain(
  entry: NotificationOutboxRecord,
  reason: string,
  attempts: number,
  ambiguousAttempts: number,
): Promise<boolean> {  const result = await NotificationOutboxModel.updateOne(settlementFilter(entry), {
    $set: {
      status: "uncertain",
      attempts,
      ambiguousAttempts,
      lastReason: reason.slice(0, 300),
      leaseToken: null,
      leaseExpiresAt: null,
    },
  });
  return result.matchedCount > 0;
}

/** Returns true only when this attempt was recorded as accepted. */
async function deliverClaimed(
  provider: NotificationProvider,
  entry: NotificationOutboxRecord,
  now: Date,
  result: NotificationAttemptResult,
): Promise<boolean> {
  const facts = await loadOrderFacts(entry.reference, (entry.transition as OrderStatus | null) ?? null);
  if (!facts) {
    // The order is gone (or the reference is stale): retrying can never
    // succeed, so the entry fails immediately with a readable reason.
    if (await settleFailed(entry, "The order for this notification no longer exists")) {
      result.failed += 1;
    }
    return false;
  }

  let recipient: string | null;
  if (entry.recipientRole === "customer") {
    recipient = facts.customerEmail;
    if (!recipient) {
      if (await settleFailed(entry, "The order has no customer email address")) {
        result.failed += 1;
      }
      return false;
    }
  } else {
    recipient = await adminRecipientEmail();
    if (!recipient) {
      if (await settleFailed(entry, "No owner notification recipient is configured")) {
        result.failed += 1;
      }
      return false;
    }
  }

  const message = buildNotification(entry.event, entry.recipientRole, facts);

  try {
    const sent = await provider.send({
      to: recipient,
      subject: message.subject,
      html: message.html,
      text: message.text,
      // Stable for the lifetime of the entry: every retry reuses it.
      idempotencyKey: entry.key,
    });

    const settled = await NotificationOutboxModel.updateOne(settlementFilter(entry), {
      $set: {
        status: "sent",
        sentAt: now,
        lastAttemptAt: now,
        lastReason: null,
        leaseToken: null,
        leaseExpiresAt: null,
        providerId: sent.providerMessageId,
        providerStatus:
          sent.status === "delivered" ? "delivered" : sent.status === "accepted" ? "accepted" : "unknown",
        providerStatusAt: now,
      },
    });
    if (settled.matchedCount > 0) {
      result.sent += 1;
      return true;
    }
    // The lease was lost while the provider call was in flight. The entry may
    // have been recovered and re-sent; do not count this attempt as recorded.
    result.deferred += 1;
    return false;
  } catch (error) {
    const failure =
      error instanceof NotificationDeliveryError
        ? error
        : new NotificationDeliveryError("The notification provider failed to send the message", {
            kind: "transient",
          });
    const reason = failure.message;

    if (failure.kind === "rate_limited") {
      // Provider pressure is not the entry's fault: defer without consuming a
      // retry, and honour Retry-After when supplied.
      const delay = failure.retryAfterMs ?? RATE_LIMITED_RETRY_MS;
      if (await settlePending(entry, { lastReason: reason, delayMs: delay, now })) {
        result.deferred += 1;
      }
      return false;
    }

    if (failure.kind === "ambiguous") {
      const attempts = entry.attempts + 1;
      const ambiguousAttempts = entry.ambiguousAttempts + 1;
      if (ambiguousAttempts >= MAX_NOTIFICATION_AMBIGUOUS_ATTEMPTS) {
        if (await settleUncertain(entry, reason, attempts, ambiguousAttempts)) {
          result.uncertain += 1;
        }
        return false;
      }
      if (
        await settlePending(entry, {
          attempts,
          ambiguousAttempts,
          lastReason: reason,
          delayMs: nextAttemptDelayMs(attempts),
          now,
        })
      ) {
        result.deferred += 1;
      }
      return false;
    }

    const attempts = entry.attempts + 1;
    if (failure.kind === "permanent" || attempts >= MAX_NOTIFICATION_ATTEMPTS) {
      if (await settleFailed(entry, reason, attempts)) {
        result.failed += 1;
      }
      return false;
    }

    if (
      await settlePending(entry, {
        attempts,
        lastReason: reason,
        delayMs: failure.retryAfterMs ?? nextAttemptDelayMs(attempts),
        now,
      })
    ) {
      result.deferred += 1;
    }
    return false;
  }
}

/* ── operator retry ─────────────────────────────────────────────────── */

export type RetryNotificationOutcome = "requeued" | "not_found" | "not_eligible";

/**
 * Requeue one failed or uncertain entry.
 *
 * The caller supplies only an id. The original event, order and recipient role
 * are preserved, so an operator can never inject a recipient or arbitrary
 * content. Counters reset so the entry gets a fresh bounded budget; the
 * idempotency key is unchanged.
 */
export async function retryNotificationById(id: string): Promise<RetryNotificationOutcome> {
  if (!isValidObjectId(id)) return "not_found";
  await connectDatabase();
  const now = new Date();
  const result = await NotificationOutboxModel.updateOne(
    { _id: id, status: { $in: ["failed", "uncertain"] } },
    {
      $set: {
        status: "pending",
        attempts: 0,
        ambiguousAttempts: 0,
        lastReason: null,
        nextAttemptAt: now,
        lastAttemptAt: null,
        leaseToken: null,
        leaseExpiresAt: null,
      },
    },
  );
  if (result.matchedCount > 0) return "requeued";
  const exists = await NotificationOutboxModel.exists({ _id: id });
  return exists ? "not_eligible" : "not_found";
}
