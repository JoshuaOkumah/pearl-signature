import { Schema, models, model, type InferSchemaType, type Model } from "mongoose";

/**
 * Scoped tracking grant (Phase 7).
 *
 * Cross-device access must not turn the public reference into a lookup key, so
 * a successful verification code exchange issues a separate, limited grant:
 *
 *  - a 32-byte random token, stored only as a sha256,
 *  - scoped to ONE order,
 *  - valid for 24 hours,
 *  - revocable,
 *  - kept in the browser's sessionStorage, never in a URL.
 *
 * The grant does not replace the Phase 5 confirmation capability: same-browser
 * access still uses that. It only exists so a customer who proved control of
 * the order email can open the order elsewhere.
 *
 * Indexes are created explicitly (`autoIndex` is off).
 */

export const ORDER_ACCESS_GRANT_TTL_MS = 24 * 60 * 60 * 1_000;

const OrderAccessGrantSchema = new Schema(
  {
    reference: {
      type: String,
      required: true,
      maxlength: [20, "Order reference is malformed"],
    },
    // The owning order's Mongo id, so a grant cannot be replayed against a
    // different order that happens to share a reference (references are
    // unique, but binding both is cheap and explicit).
    orderId: {
      type: String,
      required: true,
      maxlength: [40, "Order id is malformed"],
    },
    tokenHash: {
      type: String,
      required: true,
      maxlength: [64, "Grant token hash is malformed"],
    },
    expiresAt: {
      type: Date,
      required: true,
    },
    revokedAt: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
    collection: "order_access_grants",
  },
);

// Lookup path: one grant token, one order.
OrderAccessGrantSchema.index({ tokenHash: 1 }, { unique: true });

// Expired grants delete themselves; the read path also checks the date.
OrderAccessGrantSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export type OrderAccessGrantRecord = InferSchemaType<typeof OrderAccessGrantSchema> & {
  _id: unknown;
  createdAt: Date;
  updatedAt: Date;
};

export const OrderAccessGrantModel: Model<OrderAccessGrantRecord> =
  (models.OrderAccessGrant as Model<OrderAccessGrantRecord> | undefined) ??
  model<OrderAccessGrantRecord>("OrderAccessGrant", OrderAccessGrantSchema);
