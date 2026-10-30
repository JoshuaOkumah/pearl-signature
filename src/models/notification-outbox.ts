import { Schema, models, model, type InferSchemaType, type Model } from "mongoose";
import { NOTIFICATION_EVENTS, NOTIFICATION_RECIPIENT_ROLES } from "@/lib/notifications/templates";
import { ORDER_STATUSES } from "@/lib/validations/order";

/**
 * Notification outbox (Phase 5, extended in Phase 7).
 *
 * Every notification event first writes an ENTRY here (idempotently, keyed by
 * event + order + recipient role), and delivery is attempted afterwards from
 * this queue. That buys three properties the order flow depends on:
 *
 *  - **Order persistence is independent of delivery.** A notification failure
 *    can neither fail nor roll back an order placement or a status change: the
 *    entry simply stays `pending` and is retried later.
 *  - **Idempotent enqueue.** Replaying the same event upserts on the unique
 *    `key`, so an idempotent order replay never double-notifies.
 *  - **Bounded work.** `attempts` counts FAILURES only (a success ends the
 *    entry), and `MAX_NOTIFICATION_ATTEMPTS` stops permanent outages from
 *    retrying forever.
 *
 * ## Claiming (Phase 7)
 *
 * A processor claims an entry atomically, moving it to `processing` with a
 * random `leaseToken` and a short `leaseExpiresAt`. A crash leaves the entry
 * `processing` only until the lease expires; the next processor returns it to
 * `pending` with an honest reason. Two processors therefore never send the same
 * entry concurrently.
 *
 * ## Provider acceptance versus delivery
 *
 * `sent` means the provider ACCEPTED the message. `providerId` is the provider's
 * message id; `providerStatus` starts at `accepted` and only a verified delivery
 * callback may move it to `delivered`, `bounced` or `complained`. HTTP success
 * alone never proves delivery.
 *
 * ## Uncertain outcomes
 *
 * A timeout or 5xx may mean the provider accepted the message. Such entries are
 * retried a bounded number of times with the SAME provider idempotency key, then
 * parked as `uncertain` for an operator instead of being re-sent blindly.
 *
 * ## Privacy
 *
 * This collection stores NO personal data: no email, no name, no address, no
 * message body. The recipient is resolved from the order (customer) or the
 * admin collection at dispatch time, and the rendered message exists only in
 * flight. That is what makes the TTL and the shared M0 collection safe for a
 * queue of guest-order events.
 *
 * Indexes are created deliberately (`autoIndex` is off): the seed script and the
 * test harness call `createIndexes()`.
 */

/** Failures tolerated per entry before it is parked as `failed`. */
export const MAX_NOTIFICATION_ATTEMPTS = 5;

/** Ambiguous provider outcomes tolerated before parking as `uncertain`. */
export const MAX_NOTIFICATION_AMBIGUOUS_ATTEMPTS = 2;

/** How long an accepted entry stays queryable. Unresolved failures never expire. */
export const NOTIFICATION_TTL_SECONDS = 30 * 24 * 60 * 60;

/** How long a processor may hold an entry before another may recover it. */
export const NOTIFICATION_LEASE_MS = 2 * 60 * 1_000;

export const NOTIFICATION_STATUSES = [
  "pending",
  "processing",
  "sent",
  "failed",
  "uncertain",
] as const;
export type NotificationStatus = (typeof NOTIFICATION_STATUSES)[number];

export const NOTIFICATION_PROVIDER_STATUSES = [
  "accepted",
  "delivered",
  "bounced",
  "complained",
  "failed",
  "unknown",
] as const;
export type NotificationProviderStatus = (typeof NOTIFICATION_PROVIDER_STATUSES)[number];

export const NotificationOutboxSchema = new Schema(
  {
    key: {
      type: String,
      required: true,
      unique: true,
      maxlength: [200, "Notification key is malformed"],
    },
    event: {
      type: String,
      required: true,
      enum: NOTIFICATION_EVENTS,
    },
    // The public order reference (not a Mongo id): it is stable, URL-safe
    // and already validated wherever it appears.
    reference: {
      type: String,
      required: true,
      maxlength: [20, "Order reference is malformed"],
    },
    // Target lifecycle status for status events, so the template and the
    // retry path know which transition this entry describes.
    transition: {
      type: String,
      enum: ORDER_STATUSES,
      default: null,
    },
    recipientRole: {
      type: String,
      required: true,
      enum: NOTIFICATION_RECIPIENT_ROLES,
    },
    status: {
      type: String,
      required: true,
      enum: NOTIFICATION_STATUSES,
      default: "pending",
    },
    // Failure count only. Never incremented while no provider is
    // configured, so an unconfigured store never exhausts its retries.
    attempts: {
      type: Number,
      required: true,
      min: 0,
      default: 0,
    },
    // Ambiguous outcomes (timeout/5xx) are bounded separately: they are the
    // only failures that risk a duplicate delivery.
    ambiguousAttempts: {
      type: Number,
      required: true,
      min: 0,
      default: 0,
    },
    // Operator-facing delivery problem. Sanitised before it is stored (no
    // recipient data, no raw third-party payloads).
    lastReason: {
      type: String,
      default: null,
      maxlength: [300, "Notification reason is too long"],
    },
    nextAttemptAt: {
      type: Date,
      required: true,
    },
    lastAttemptAt: {
      type: Date,
      default: null,
    },
    sentAt: {
      type: Date,
      default: null,
    },
    // Claim lease: only the processor holding this token may settle the entry.
    leaseToken: {
      type: String,
      default: null,
      maxlength: [64, "Notification lease token is malformed"],
    },
    leaseExpiresAt: {
      type: Date,
      default: null,
    },
    // Provider acceptance facts. `providerId` is the provider's message id.
    providerId: {
      type: String,
      default: null,
      maxlength: [200, "Provider message id is malformed"],
    },
    providerStatus: {
      type: String,
      enum: NOTIFICATION_PROVIDER_STATUSES,
      default: null,
    },
    providerStatusAt: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true, // updatedAt marks retries and operator actions
    collection: "notification_outbox",
  },
);

// Dispatcher scan: "due pending entries", oldest schedule first.
NotificationOutboxSchema.index({ status: 1, nextAttemptAt: 1 });

// Lease recovery: expired claims are returned to the queue.
NotificationOutboxSchema.index({ status: 1, leaseExpiresAt: 1 });

// Admin observability: most recently changed entries first.
NotificationOutboxSchema.index({ status: 1, updatedAt: -1 });

// Self-cleaning queue for ACCEPTED entries only. A missing/null `sentAt` is
// not a date, so pending, failed and uncertain entries are never deleted by
// the TTL monitor. Unresolved failures stay visible until an operator acts.
NotificationOutboxSchema.index({ sentAt: 1 }, { expireAfterSeconds: NOTIFICATION_TTL_SECONDS });

export type NotificationOutboxRecord = InferSchemaType<typeof NotificationOutboxSchema> & {
  _id: unknown;
  createdAt: Date;
  updatedAt: Date;
};

export const NotificationOutboxModel: Model<NotificationOutboxRecord> =
  (models.NotificationOutbox as Model<NotificationOutboxRecord> | undefined) ??
  model<NotificationOutboxRecord>("NotificationOutbox", NotificationOutboxSchema);
