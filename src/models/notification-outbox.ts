import { Schema, models, model, type InferSchemaType, type Model } from "mongoose";
import {
  NOTIFICATION_EVENTS,
  NOTIFICATION_RECIPIENT_ROLES,
} from "@/lib/notifications/templates";

/**
 * Notification outbox (Phase 5, Milestone E).
 *
 * Notifications are never sent inline with a business operation. Every
 * event first writes an ENTRY here (idempotently, keyed by event + order +
 * recipient role), and delivery is attempted afterwards from this queue.
 * That buys three properties the order flow depends on:
 *
 *  - **Order persistence is independent of delivery.** A notification
 *    failure can neither fail nor roll back an order placement or a status
 *    change: the entry simply stays `pending` and is retried later.
 *  - **Idempotent enqueue.** Replaying the same event upserts on the
 *    unique `key`, so an idempotent order replay never double-notifies.
 *  - **Bounded work.** `attempts` counts FAILURES only (a success ends the
 *    entry), and `MAX_NOTIFICATION_ATTEMPTS` stops permanent outages from
 *    retrying forever.
 *
 * ## Privacy
 *
 * This collection stores NO personal data: no email, no name, no address,
 * no message body. The recipient is resolved from the order (customer) or
 * the admin collection at dispatch time, and the rendered message exists
 * only in flight. That is what makes the TTL and the shared M0 collection
 * safe for a queue of guest-order events.
 *
 * ## Retries
 *
 * `nextAttemptAt` carries the backoff schedule (see `nextAttemptDelayMs`
 * in dispatch.ts). Entries are picked up opportunistically — whenever an
 * order event enqueues new work — because Phase 5 has no scheduler; the
 * honest tradeoff is documented in docs/ORDER_NOTIFICATIONS.md.
 *
 * Indexes are created deliberately (`autoIndex` is off): the seed script
 * and the test harness call `createIndexes()`.
 */

/** Failures tolerated per entry before it is parked as `failed`. */
export const MAX_NOTIFICATION_ATTEMPTS = 5;

/** How long a finished entry (sent or failed) stays queryable. */
export const NOTIFICATION_TTL_SECONDS = 30 * 24 * 60 * 60;

export const NOTIFICATION_STATUSES = ["pending", "sent", "failed"] as const;
export type NotificationStatus = (typeof NOTIFICATION_STATUSES)[number];

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
    sentAt: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true, // createdAt feeds the TTL; updatedAt marks retries
    collection: "notification_outbox",
  },
);

// Dispatcher scan: "due pending entries", newest schedule first.
NotificationOutboxSchema.index({ status: 1, nextAttemptAt: 1 });

// Self-cleaning queue: entries expire 30 days after they were created, so
// the collection stays bounded on Atlas M0 without a cleanup job.
NotificationOutboxSchema.index({ createdAt: 1 }, { expireAfterSeconds: NOTIFICATION_TTL_SECONDS });

export type NotificationOutboxRecord = InferSchemaType<typeof NotificationOutboxSchema> & {
  _id: unknown;
  createdAt: Date;
  updatedAt: Date;
};

export const NotificationOutboxModel: Model<NotificationOutboxRecord> =
  (models.NotificationOutbox as Model<NotificationOutboxRecord> | undefined) ??
  model<NotificationOutboxRecord>("NotificationOutbox", NotificationOutboxSchema);
