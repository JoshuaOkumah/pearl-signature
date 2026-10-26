import { Schema, models, model, type InferSchemaType, type Model } from "mongoose";

/** Durable webhook deduplication and recoverable processing state. No raw
 * provider payload or customer PII is stored. Retain financial event IDs for
 * reconciliation rather than applying a short TTL to the dedupe ledger. */
export const StripeEventSchema = new Schema(
  {
    eventId: { type: String, required: true, unique: true, maxlength: 255 },
    type: { type: String, required: true, maxlength: 100 },
    objectId: { type: String, required: true, maxlength: 255 },
    livemode: { type: Boolean, required: true, default: false },
    eventCreatedAt: { type: Date, required: true },
    status: { type: String, enum: ["received", "processed", "retry", "quarantined"], required: true, default: "received" },
    orderReference: { type: String, default: null, maxlength: 20 },
    attempts: { type: Number, required: true, min: 0, default: 0 },
    processedAt: { type: Date, default: null },
    lastErrorCode: { type: String, default: null, maxlength: 80 },
  },
  { timestamps: true, collection: "stripe_events" },
);

StripeEventSchema.index({ status:  1, createdAt: 1 });
StripeEventSchema.index({ orderReference: 1, eventCreatedAt: -1 });

export type StripeEventRecord = InferSchemaType<typeof StripeEventSchema> & {
  _id: unknown;
  createdAt: Date;
  updatedAt: Date;
};

export const StripeEventModel: Model<StripeEventRecord> =
  (models.StripeEvent as Model<StripeEventRecord> | undefined) ??
  model<StripeEventRecord>("StripeEvent", StripeEventSchema);
