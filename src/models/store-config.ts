import { Schema, models, model, type InferSchemaType, type Model } from "mongoose";
import { TAX_BASES, TAX_MODES } from "@/lib/validations/store-config";

/**
 * Store checkout configuration (Phase 5).
 *
 * A single singleton document (`_id: "checkout"`) holding every business
 * decision that determines whether an order can actually be fulfilled:
 * order intake, delivery coverage and fees, arranged pickup, and the tax
 * treatment applied to an order total.
 *
 * Honesty rules baked into the defaults:
 *
 *  - Nothing here is invented. Out of the box intake is OFF, delivery and
 *    pickup are unconfigured and tax mode is `"unconfigured"`, which
 *    BLOCKS live order submission until the owner makes explicit choices.
 *  - `serviceAreas` are deliberately simple: a province list plus optional
 *    postal-code prefixes (Canadian FSAs such as `M5H`) and one flat fee.
 *    No geocoding, no zones engine, no distance maths.
 *  - Tax is owner-attested: either `"zero"` (the owner states no tax is
 *    collected) or `"rate"` (an owner-supplied rate in basis points with an
 *    owner-supplied label). There is no hardcoded Canadian rate anywhere.
 *
 * The public, sanitised projection of this document is served to the
 * checkout client by `getCheckoutSettingsAction`; the raw record never
 * leaves the admin boundary.
 */

export const STORE_CONFIG_ID = "checkout";

const CANADIAN_PROVINCE_CODES = [
  "AB", "BC", "MB", "NB", "NL", "NS", "NT", "NU", "ON", "PE", "QC", "SK", "YT",
];

/** Canadian forward sortation area, e.g. `M5H`. */
const FSA_PATTERN = /^[A-Z]\d[A-Z]$/;

const ServiceAreaSchema = new Schema(
  {
    label: {
      type: String,
      required: [true, "A service area needs a label"],
      trim: true,
      maxlength: [80, "Service area label is too long"],
    },
    provinces: {
      type: [String],
      required: [true, "A service area needs at least one province"],
      validate: {
        validator: (value: string[]) =>
          value.length >= 1 && value.length <= 13 && value.every((code) => CANADIAN_PROVINCE_CODES.includes(code)),
        message: "Service areas need 1-13 valid province or territory codes",
      },
    },
    /**
     * Optional forward-sortation-area prefixes (`M5H`). Empty means the
     * whole province (or provinces) listed above is covered.
     */
    postalPrefixes: {
      type: [String],
      default: [],
      validate: {
        validator: (value: string[]) => value.length <= 200 && value.every((prefix) => FSA_PATTERN.test(prefix)),
        message: "Postal prefixes must be 3-character FSAs like M5H",
      },
    },
    feeCents: {
      type: Number,
      required: [true, "A service area needs a delivery fee"],
      default: 0,
      validate: {
        validator: (value: number) => Number.isInteger(value) && value >= 0 && value <= 999_999,
        message: "Delivery fee must be whole cents between 0 and $9,999.99",
      },
    },
  },
  { _id: false },
);

export const StoreConfigSchema = new Schema(
  {
    _id: {
      type: String,
      required: true,
    },
    orderIntakeEnabled: {
      type: Boolean,
      default: false,
    },
    payments: {
      type: new Schema(
        {
          onlineEnabled: { type: Boolean, default: false },
        },
        { _id: false },
      ),
      default: () => ({}),
    },
    /**
     * Phase 7 customer-email preferences. Only the nonessential `preparing`
     * update can be muted; confirmations and payment messages always send.
     */
    notifications: {
      type: new Schema(
        {
          preparingUpdateEnabled: { type: Boolean, default: true },
        },
        { _id: false },
      ),
      default: () => ({}),
    },
    delivery: {
      type: new Schema(
        {
          enabled: { type: Boolean, default: false },
          serviceAreas: { type: [ServiceAreaSchema], default: [] },
        },
        { _id: false },
      ),
      default: () => ({}),
    },
    pickup: {
      type: new Schema(
        {
          enabled: { type: Boolean, default: false },
          instructions: {
            type: String,
            default: null,
            trim: true,
            maxlength: [500, "Pickup instructions are too long"],
          },
        },
        { _id: false },
      ),
      default: () => ({}),
    },
    tax: {
      type: new Schema(
        {
          mode: { type: String, enum: TAX_MODES, default: "unconfigured" },
          /** Owner-attested rate in basis points (13% = 1300). Rate mode only. */
          rateBps: {
            type: Number,
            default: null,
            validate: {
              validator: (value: number | null) =>
                value === null || (Number.isInteger(value) && value >= 1 && value <= 10_000),
              message: "Tax rate must be 1-10000 basis points",
            },
          },
          base: {
            type: String,
            enum: [...TAX_BASES, null],
            default: null,
          },
          /** Owner-provided display label, e.g. "HST". Never invented by the app. */
          label: {
            type: String,
            default: null,
            trim: true,
            maxlength: [40, "Tax label is too long"],
          },
        },
        { _id: false },
      ),
      default: () => ({}),
    },
    /** Optional customer-facing note shown at checkout (fulfilment context). */
    customerNote: {
      type: String,
      default: null,
      trim: true,
      maxlength: [300, "Customer note is too long"],
    },
  },
  {
    timestamps: true,
    collection: "store_configs",
  },
);

/** Consistency rules for tax configuration, enforced at every write boundary. */
export function isConsistentTaxConfig(tax: {
  mode?: string | null;
  rateBps?: number | null;
  base?: string | null;
}): boolean {
  if (tax.mode !== "rate") return true;
  return (
    typeof tax.rateBps === "number" &&
    Number.isInteger(tax.rateBps) &&
    tax.rateBps >= 1 &&
    tax.rateBps <= 10_000 &&
    (tax.base === "merchandise" || tax.base === "with_delivery")
  );
}

export type StoreConfigRecord = InferSchemaType<typeof StoreConfigSchema> & {
  _id: string;
  createdAt?: Date;
  updatedAt?: Date;
};

export const StoreConfigModel: Model<StoreConfigRecord> =
  (models.StoreConfig as Model<StoreConfigRecord> | undefined) ??
  model<StoreConfigRecord>("StoreConfig", StoreConfigSchema);
