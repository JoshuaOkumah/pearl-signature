import { Schema, models, model, type InferSchemaType, type Model } from "mongoose";

export const PaymentRefundSchema = new Schema(
  {
    orderId: { type: String, required: true, maxlength: 64 },
    orderReference: { type: String, required: true, maxlength: 20 },
    attemptId: { type: String, required: true, maxlength: 64 },
    stripeRefundId: { type: String, required: true, unique: true, maxlength: 255 },
    stripePaymentIntentId: { type: String, required: true, maxlength: 255 },
    amountCents: {
      type: Number,
      required: true,
      min: 1,
      max: 99_999_999,
      validate: { validator: Number.isInteger, message: "Refund amount must be whole cents" },
    },
    currency: { type: String, enum: ["CAD"], required: true },
    status: { type: String, enum: ["pending", "succeeded", "failed", "canceled"], required: true },
    providerCreatedAt: { type: Date, required: true },
    reconciledAt: { type: Date, default: null },
  },
  { timestamps: true, collection: "payment_refunds" },
);

PaymentRefundSchema.index({ orderId: 1, createdAt: -1 });
PaymentRefundSchema.index({ attemptId: 1, createdAt: -1 });

export type PaymentRefundRecord = InferSchemaType<typeof PaymentRefundSchema> & {
  _id: unknown;
  createdAt: Date;
  updatedAt: Date;
};

export const PaymentRefundModel: Model<PaymentRefundRecord> =
  (models.PaymentRefund as Model<PaymentRefundRecord> | undefined) ??
  model<PaymentRefundRecord>("PaymentRefund", PaymentRefundSchema);
