import { Schema, models, model, type InferSchemaType, type Model } from "mongoose";

/**
 * Public order-submission rate-limit buckets (Phase 5).
 *
 * A dedicated collection, deliberately parallel to `admin_login_attempts`
 * rather than shared with it: login protection must never be weakened or
 * slowed down by public traffic, and the two limiters have completely
 * different budgets and consequences.
 *
 * Same proven design as Phase 3:
 *
 *  - Key hashes the scope + client address + time bucket, so no raw address
 *    or identifier is stored and every window opens a fresh document.
 *  - Atomic upsert `$inc`, so concurrent requests never lose counts.
 *  - TTL index on `expiresAt` bounds the collection on Atlas M0.
 *
 * Scopes:
 *
 *  - `order.create` — placing orders from one address.
 *  - `order.lookup` — guest confirmation reads, which also stop bulk
 *    enumeration attempts against order references.
 *
 * Limits are generous enough for a household (and honest about shared NAT
 * addresses) while making automated order spam expensive.
 */

export const ORDER_RATE_WINDOW_MS = 15 * 60 * 1_000;
export const ORDER_CREATE_MAX_ATTEMPTS = 10;
export const ORDER_LOOKUP_MAX_ATTEMPTS = 30;
export const PAYMENT_CREATE_MAX_ATTEMPTS = 10;
/** Cross-device tracking recovery: code requests per address per window. */
export const TRACKING_REQUEST_MAX_ATTEMPTS = 5;
/** Cross-device tracking recovery: code submissions per address per window. */
export const TRACKING_VERIFY_MAX_ATTEMPTS = 10;

export const ORDER_RATE_SCOPES = [
  "order.create",
  "order.lookup",
  "payment.create",
  "tracking.request",
  "tracking.verify",
] as const;
export type OrderRateScope = (typeof ORDER_RATE_SCOPES)[number];

export const OrderAttemptSchema = new Schema(
  {
    key: {
      type: String,
      required: true,
      unique: true,
      maxlength: [200, "Attempt key is malformed"],
    },
    count: {
      type: Number,
      required: true,
      min: 0,
      default: 0,
    },
    expiresAt: {
      type: Date,
      required: true,
    },
  },
  {
    timestamps: false,
    collection: "order_attempts",
  },
);

/* TTL: buckets delete themselves at window end, so the collection stays
 * bounded on Atlas M0 without any cleanup job. Built by the seed script /
 * the test harness (`autoIndex` is off). */
OrderAttemptSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export type OrderAttemptRecord = InferSchemaType<typeof OrderAttemptSchema>;

export const OrderAttemptModel: Model<OrderAttemptRecord> =
  (models.OrderAttempt as Model<OrderAttemptRecord> | undefined) ??
  model<OrderAttemptRecord>("OrderAttempt", OrderAttemptSchema);
