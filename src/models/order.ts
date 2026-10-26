import { Schema, models, model, type InferSchemaType, type Model } from "mongoose";
import { FULFILLMENT_METHODS } from "@/lib/validations/checkout";
import {
  MAX_ORDER_NOTES,
  MAX_STATUS_HISTORY,
  ORDER_KEY_PATTERN,
  ORDER_REFERENCE_PATTERN,
  ORDER_STATUSES,
  PAYMENT_METHODS,
  PAYMENT_STATUSES,
} from "@/lib/validations/order";

/**
 * Order schema (Phase 5).
 *
 * An order is a frozen record of a commercial transaction, not a view over
 * the catalogue. Everything a customer agreed to is SNAPSHOT at creation:
 * product names, variant names, unit prices, the delivery fee, the tax and
 * the total. Editing or archiving a product later can never rewrite history,
 * because nothing here reads back from `products`.
 *
 * ## Money
 *
 * Integer CAD cents everywhere. `currency` is stored (not assumed) so a
 * later phase cannot silently reinterpret these numbers. No floating-point
 * arithmetic touches any field in this file.
 *
 * ## Status versus payment
 *
 * `status` is the fulfilment lifecycle (placed → confirmed → …). Payment is
 * a SEPARATE axis: `payment.method` + `payment.status` (`unpaid`/`paid`).
 * Completing fulfilment never changes payment status, and cancelling a Cash
 * on Arrival order never records a refund for money that was never
 * collected. This separation is what lets the next phase add Stripe without
 * touching order storage.
 *
 * ## Identity
 *
 * - `reference` — public, unique, human-quotable (`PS-XXXXXXXX`).
 * - `idempotencyKey` — client-generated checkout-attempt id, UNIQUE index:
 *   a retry can never insert twice, and a conflicting reuse of the same key
 *   is detectable through `idempotencyHash`.
 * - `confirmationKeyHash` — sha256 of an opaque guest access capability.
 *   The raw capability NEVER reaches the database or a URL; the order
 *   reference alone is not enough to read an order back.
 *
 * ## Indexes
 *
 * Deliberately small (`autoIndex` is off; `scripts/seed.ts` creates them):
 * unique reference, unique idempotency key, creation-date ordering,
 * status + date for the admin list, and payment status for the "unpaid
 * Cash on Arrival" dashboard metric. Searches use the status/date index
 * with an in-memory name/reference filter, which is the right trade at
 * Atlas M0 order volumes.
 */

/**
 * Re-exported for convenience so model consumers can import either module.
 * The definitions themselves live in `src/lib/validations/order.ts`, which
 * is isomorphic and must never import mongoose.
 */
export { ORDER_STATUSES, PAYMENT_METHODS, PAYMENT_STATUSES };
export type { OrderStatus, PaymentMethod, PaymentStatus } from "@/lib/validations/order";

const OrderItemSchema = new Schema(
  {
    productId: {
      type: String,
      required: true,
      maxlength: 64,
    },
    slug: {
      type: String,
      required: true,
      maxlength: 120,
    },
    /** Product name AT PURCHASE TIME — never re-read from the catalogue. */
    name: {
      type: String,
      required: true,
      maxlength: 200,
    },
    /** null when the product has no options. */
    variantName: {
      type: String,
      default: null,
      maxlength: 80,
    },
    quantity: {
      type: Number,
      required: true,
      min: 1,
      max: 99,
      validate: {
        validator: Number.isInteger,
        message: "Quantity must be a whole number",
      },
    },
    /** Agreed unit price in integer CAD cents. */
    unitPriceCents: {
      type: Number,
      required: true,
      min: 1,
      max: 99_999_999,
      validate: {
        validator: Number.isInteger,
        message: "Unit price must be whole cents",
      },
    },
    lineTotalCents: {
      type: Number,
      required: true,
      min: 1,
      max: 99_999_999,
      validate: {
        validator: Number.isInteger,
        message: "Line total must be whole cents",
      },
    },
    /** Cloudinary reference only (URL + alt), captured at purchase time. */
    image: {
      type: new Schema(
        {
          secureUrl: { type: String, required: true, maxlength: 500 },
          alt: { type: String, required: true, maxlength: 200 },
        },
        { _id: false },
      ),
      default: null,
    },
  },
  { _id: false },
);

const StatusEventSchema = new Schema(
  {
    from: { type: String, enum: [...ORDER_STATUSES, null], default: null },
    to: { type: String, enum: ORDER_STATUSES, required: true },
    at: { type: Date, required: true },
    /** null for the initial placement event (the customer is not an admin). */
    adminId: { type: String, default: null, maxlength: 64 },
    /** Short operator-authored reason or note. No PII beyond what is needed. */
    note: { type: String, default: null, maxlength: 300 },
  },
  { _id: false },
);

const OrderNoteSchema = new Schema(
  {
    body: { type: String, required: true, maxlength: 500 },
    at: { type: Date, required: true },
    adminId: { type: String, default: null, maxlength: 64 },
  },
  { _id: false },
);

export const OrderSchema = new Schema(
  {
    reference: {
      type: String,
      required: true,
      unique: true,
      uppercase: true,
      match: [ORDER_REFERENCE_PATTERN, "Malformed order reference"],
    },
    idempotencyKey: {
      type: String,
      required: true,
      unique: true,
      match: [ORDER_KEY_PATTERN, "Malformed idempotency key"],
    },
    /** sha256 of the canonical order intent; equal key + equal intent = retry. */
    idempotencyHash: {
      type: String,
      required: true,
      maxlength: 64,
    },
    /** sha256 of the guest confirmation capability. Raw value is never stored. */
    confirmationKeyHash: {
      type: String,
      required: true,
      maxlength: 64,
    },

    customer: {
      type: new Schema(
        {
          fullName: { type: String, required: true, maxlength: 120 },
          email: { type: String, required: true, maxlength: 160, lowercase: true, trim: true },
          phone: { type: String, required: true, maxlength: 25 },
        },
        { _id: false },
      ),
      required: true,
    },

    fulfillment: {
      type: new Schema(
        {
          method: { type: String, enum: FULFILLMENT_METHODS, required: true },
          address: {
            type: new Schema(
              {
                line1: { type: String, required: true, maxlength: 180 },
                line2: { type: String, default: null, maxlength: 120 },
                city: { type: String, required: true, maxlength: 120 },
                province: { type: String, required: true, maxlength: 3 },
                postalCode: { type: String, required: true, maxlength: 10 },
              },
              { _id: false },
            ),
            default: null,
          },
          instructions: { type: String, default: null, maxlength: 400 },
          notes: { type: String, default: null, maxlength: 600 },
          /** Owner-configured area label that served this order, when delivery. */
          serviceAreaLabel: { type: String, default: null, maxlength: 80 },
          /** Pickup instructions as configured when the order was placed. */
          pickupInstructions: { type: String, default: null, maxlength: 500 },
        },
        { _id: false },
      ),
      required: true,
    },

    items: {
      type: [OrderItemSchema],
      required: true,
      validate: [
        {
          validator: (value: unknown[]) => Array.isArray(value) && value.length >= 1 && value.length <= 30,
          message: "An order needs 1-30 items",
        },
      ],
    },

    money: {
      type: new Schema(
        {
          currency: { type: String, enum: ["CAD"], required: true, default: "CAD" },
          subtotalCents: { type: Number, required: true, min: 0, max: 99_999_999 },
          deliveryFeeCents: { type: Number, required: true, min: 0, max: 999_999 },
          taxCents: { type: Number, required: true, min: 0, max: 99_999_999 },
          totalCents: { type: Number, required: true, min: 1, max: 99_999_999 },
          /** Owner-provided tax label snapshot (e.g. "HST"), or null. */
          taxLabel: { type: String, default: null, maxlength: 40 },
          /** Owner-attested tax rate snapshot in basis points, or null. */
          taxRateBps: { type: Number, default: null, min: 1, max: 10_000 },
        },
        { _id: false },
      ),
      required: true,
    },

    payment: {
      type: new Schema(
        {
          method: { type: String, enum: PAYMENT_METHODS, required: true, default: "cash_on_arrival" },
          status: { type: String, enum: PAYMENT_STATUSES, required: true, default: "unpaid" },
          /** When an admin recorded that payment was received. */
          paidAt: { type: Date, default: null },
          /** The admin who recorded it. */
          paidByAdminId: { type: String, default: null, maxlength: 64 },
          paidByLabel: { type: String, default: null, maxlength: 160 },
        },
        { _id: false },
      ),
      required: true,
    },

    status: {
      type: String,
      enum: ORDER_STATUSES,
      required: true,
      default: "placed",
    },
    statusHistory: {
      type: [StatusEventSchema],
      default: () => [],
      validate: [
        {
          validator: (value: unknown[]) => Array.isArray(value) && value.length <= MAX_STATUS_HISTORY,
          message: "Status history is bounded",
        },
      ],
    },
    cancellationReason: {
      type: String,
      default: null,
      maxlength: 300,
    },
    notes: {
      type: [OrderNoteSchema],
      default: () => [],
      validate: [
        {
          validator: (value: unknown[]) => Array.isArray(value) && value.length <= MAX_ORDER_NOTES,
          message: `Operational notes are limited to ${MAX_ORDER_NOTES}`,
        },
      ],
    },

    /** Optimistic-concurrency token for admin updates. */
    version: {
      type: Number,
      required: true,
      default: 1,
      min: 1,
    },
  },
  {
    timestamps: true,
    collection: "orders",
  },
);

/** Money consistency: the components must add up to the stored total. */
OrderSchema.path("money").validate(function validateMoney(this: { money?: { subtotalCents?: number; deliveryFeeCents?: number; taxCents?: number; totalCents?: number } }): boolean {
  const money = this.money;
  if (!money) return false;
  const { subtotalCents, deliveryFeeCents, taxCents, totalCents } = money;
  if (
    subtotalCents === undefined ||
    deliveryFeeCents === undefined ||
    taxCents === undefined ||
    totalCents === undefined ||
    !Number.isInteger(subtotalCents) ||
    !Number.isInteger(deliveryFeeCents) ||
    !Number.isInteger(taxCents) ||
    !Number.isInteger(totalCents)
  ) {
    return false;
  }
  return subtotalCents + deliveryFeeCents + taxCents === totalCents;
}, "Order money components must sum to the total");

/* Listing indexes (newest first, optionally filtered by lifecycle or payment
 * state). Built by `scripts/seed.ts` / the test harness, never as a side
 * effect of a process connecting (`autoIndex` is off). */
OrderSchema.index({ createdAt: -1 });
OrderSchema.index({ status: 1, createdAt: -1 });
OrderSchema.index({ "payment.status": 1, createdAt: -1 });

export type OrderRecord = InferSchemaType<typeof OrderSchema> & {
  _id: unknown;
  createdAt: Date;
  updatedAt: Date;
};

export const OrderModel: Model<OrderRecord> =
  (models.Order as Model<OrderRecord> | undefined) ?? model<OrderRecord>("Order", OrderSchema);
