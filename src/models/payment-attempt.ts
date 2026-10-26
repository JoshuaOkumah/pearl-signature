import { Schema, models, model, type InferSchemaType, type Model } from "mongoose";

export const PAYMENT_ATTEMPT_STATUSES = [
  "creating",
  "open",
  "processing",
  "succeeded",
  "failed",
  "expired",
  "uncertain",
] as const;

/**
 * Durable provider-attempt history. One `active` attempt per order is
 * enforced by a partial unique index. The provider idempotency key is
 * persisted before calling Stripe, so network timeouts can safely retry the
 * same request instead of creating a second chargeable session.
 */
export const PaymentAttemptSchema = new Schema(
  {
    orderId: { type: String, required: true, maxlength: 64 },
    orderReference: { type: String, required: true, maxlength: 20 },
    sequence: { type: Number, required: true, min: 1, validate: Number.isInteger },
    amountCents: {
      type: Number,
      required: true,
      min: 1,
      max: 99_999_999,
      validate: { validator: Number.isInteger, message: "Payment amount must be whole cents" },
    },
    currency: { type: String, enum: ["CAD"], required: true, default: "CAD" },
    provider: { type: String, enum: ["stripe"], required: true, default: "stripe" },
    status: { type: String, enum: PAYMENT_ATTEMPT_STATUSES, required: true },
    active: { type: Boolean, required: true, default: true },
    providerIdempotencyKey: { type: String, required: true, unique: true, maxlength: 255 },
    checkoutSessionId: { type: String, default: null, maxlength: 255 },
    paymentIntentId: { type: String, default: null, maxlength: 255 },
    expiresAt: { type: Date, default: null },
    providerCreatedAt: { type: Date, default: null },
    succeededAt: { type: Date, default: null },
    failureCode: { type: String, default: null, maxlength: 80 },
    lastReconciledAt: { type: Date, default: null },
    reconciliationStatus: {
      type: String,
      enum: ["not_checked", "matched", "mismatch", "error"],
      default: "not_checked",
      required: true,
    },
  },
  { timestamps: true, collection: "payment_attempts" },
);

PaymentAttemptSchema.index({ orderId:  1, sequence: 1 }, { unique: true });
PaymentAttemptSchema.index({ orderId: 1, active: 1 }, { unique: true, partialFilterExpression: { active: true } });
PaymentAttemptSchema.index({ checkoutSessionId: 1 }, { unique: true, partialFilterExpression: { checkoutSessionId: { $type: "string" } } });
PaymentAttemptSchema.index({ paymentIntentId: 1 }, { unique: true, partialFilterExpression: { paymentIntentId: { $type: "string" } } });
PaymentAttemptSchema.index({ orderReference: 1, createdAt: -1 });

export type PaymentAttemptRecord = InferSchemaType<typeof PaymentAttemptSchema> & {
  _id: unknown;
  createdAt: Date;
  updatedAt: Date;
};

export const PaymentAttemptModel: Model<PaymentAttemptRecord> =
  (models.PaymentAttempt as Model<PaymentAttemptRecord> | undefined) ??
  model<PaymentAttemptRecord>("PaymentAttempt", PaymentAttemptSchema);
