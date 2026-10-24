import { z } from "zod";

/**
 * Checkout form validation (Phase 4).
 *
 * Phase 4 validates the customer's details LOCALLY so the form is a real,
 * testable foundation, but nothing here is ever transmitted or stored: there
 * is no order-creation endpoint yet, and the form deliberately has no submit
 * action. Values live in component state for the duration of the visit.
 *
 * Validation policy choices (documented in `docs/CHECKOUT_FOUNDATION.md`):
 *
 *  - **Names** accept any printable characters. Punctuation, accents, hyphens
 *    and apostrophes are legitimate in real names, so rejecting them would
 *    reject real customers. Only length and blankness are enforced.
 *  - **Phone numbers** follow the North American Numbering Plan that Canada
 *    uses: 10 digits, optionally prefixed by `1`, written in any of the usual
 *    separators. The stored value is normalised to `+1XXXXXXXXXX`.
 *  - **Postal codes** follow `A1A 1A1`, the only format Canada Post issues,
 *    and are normalised to upper case with a single space.
 *  - **Delivery fields** are required only when delivery is chosen, and the
 *    province list covers all ten provinces and three territories — no
 *    customer is assumed to live anywhere in particular.
 */

/* ── Canadian phone ─────────────────────────────────────────────────── */

/**
 * Parse a Canadian phone number into E.164-ish `+1XXXXXXXXXX`.
 * Returns `null` when the input is not a plausible NANP number.
 *
 * "Plausible" means the shape every Canadian number shares under the North
 * American Numbering Plan: ten digits, an area code and an exchange code that
 * each begin with 2-9 (so `0000000000` or `+1 123 456 7890` are rejected),
 * optionally preceded by the country code 1.
 */
export function normalizeCanadianPhone(raw: string): string | null {
  const compact = raw.trim().replace(/[\s().\-/]/g, "");
  const digits = compact.replace(/^\+/, "");
  if (!/^\d{10,11}$/.test(digits)) return null;

  const nanp = digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits.length === 10 ? digits : null;
  if (nanp === null) return null;

  // [2-9]xx area code, [2-9]xx exchange code, then any four digits.
  if (!/^[2-9]\d{2}[2-9]\d{6}$/.test(nanp)) return null;

  return `+1${nanp}`;
}

export const canadianPhoneSchema = z
  .string()
  .trim()
  .max(25, "Phone number is too long")
  .refine((value) => normalizeCanadianPhone(value) !== null, {
    message: "Enter a Canadian phone number, for example 416 555 0123",
  })
  .transform((value) => normalizeCanadianPhone(value) as string);

/* ── Canadian postal code ───────────────────────────────────────────── */

/** Normalise to the canonical `A1A 1A1` shape, or `null` when malformed. */
export function normalizePostalCode(raw: string): string | null {
  const compact = raw.trim().toUpperCase().replace(/[\s-]/g, "");
  if (!/^[ABCEGHJ-NPRSTVXY]\d[ABCEGHJ-NPRSTVWXYZ]\d[ABCEGHJ-NPRSTVWXYZ]\d$/.test(compact)) {
    return null;
  }
  return `${compact.slice(0, 3)} ${compact.slice(3)}`;
}

export const postalCodeSchema = z
  .string()
  .trim()
  .max(10, "Postal code is too long")
  .refine((value) => normalizePostalCode(value) !== null, {
    message: "Enter a postal code like K1A 0B1",
  })
  .transform((value) => normalizePostalCode(value) as string);

/* ── provinces and territories ──────────────────────────────────────── */

export const CANADIAN_PROVINCES: ReadonlyArray<{ code: string; name: string }> = [
  { code: "AB", name: "Alberta" },
  { code: "BC", name: "British Columbia" },
  { code: "MB", name: "Manitoba" },
  { code: "NB", name: "New Brunswick" },
  { code: "NL", name: "Newfoundland and Labrador" },
  { code: "NS", name: "Nova Scotia" },
  { code: "NT", name: "Northwest Territories" },
  { code: "NU", name: "Nunavut" },
  { code: "ON", name: "Ontario" },
  { code: "PE", name: "Prince Edward Island" },
  { code: "QC", name: "Quebec" },
  { code: "SK", name: "Saskatchewan" },
  { code: "YT", name: "Yukon" },
];

const provinceCodes = CANADIAN_PROVINCES.map((province) => province.code) as [string, ...string[]];

/* ── fulfilment ─────────────────────────────────────────────────────── */

/**
 * The two fulfilment methods the business intends to offer. Neither is
 * configured yet: coverage, fees and pickup arrangements are still owner
 * decisions, so the UI labels both as unconfirmed and the form collects no
 * fee or promise.
 */
export const FULFILLMENT_METHODS = ["delivery", "pickup"] as const;
export type FulfillmentMethod = (typeof FULFILLMENT_METHODS)[number];

/* ── form schema ────────────────────────────────────────────────────── */

const shortText = (max: number, requiredMessage: string) =>
  z
    .string()
    .trim()
    .max(max, `Must be at most ${max} characters`)
    .refine((value) => value.length > 0, requiredMessage);

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `Must be at most ${max} characters`)
    .transform((value) => (value === "" ? null : value));

export const checkoutFormSchema = z
  .object({
    fullName: shortText(120, "Enter your full name"),
    email: z
      .string()
      .trim()
      .toLowerCase()
      .max(160, "Email is too long")
      .refine((value) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value), "Enter a valid email address"),
    phone: canadianPhoneSchema,
    fulfillment: z.enum(FULFILLMENT_METHODS, { message: "Choose how you would like to receive your order" }),
    addressLine1: optionalText(180),
    addressLine2: optionalText(120),
    city: optionalText(120),
    province: z.string().trim().catch(""),
    postalCode: z.string().trim().max(10, "Postal code is too long").catch(""),
    deliveryInstructions: optionalText(400),
    notes: optionalText(600),
  })
  .superRefine((value, ctx) => {
    if (value.fulfillment !== "delivery") return;

    // `optionalText` has already run, so an untouched field arrives as `null`
    // rather than "". Both count as "not provided" here.
    const provided = (field: "addressLine1" | "city"): string => (value[field] ?? "").trim();

    const required: Array<[keyof typeof value, string]> = [
      ["addressLine1", "Enter your street address"],
      ["city", "Enter your city or town"],
    ];
    for (const [field, message] of required) {
      if (provided(field as "addressLine1" | "city") === "") {
        ctx.addIssue({ code: "custom", path: [field], message });
      }
    }

    if (!provinceCodes.includes(value.province)) {
      ctx.addIssue({ code: "custom", path: ["province"], message: "Choose your province or territory" });
    }

    if (normalizePostalCode(value.postalCode) === null) {
      ctx.addIssue({
        code: "custom",
        path: ["postalCode"],
        message: "Enter a postal code like K1A 0B1",
      });
    }
  });

export type CheckoutFormInput = z.output<typeof checkoutFormSchema>;
export type CheckoutFieldErrors = Partial<Record<keyof CheckoutFormInput, string>>;

/** Raw form values (pre-validation) for controlled inputs. */
export interface CheckoutFormValues {
  fullName: string;
  email: string;
  phone: string;
  fulfillment: FulfillmentMethod;
  addressLine1: string;
  addressLine2: string;
  city: string;
  province: string;
  postalCode: string;
  deliveryInstructions: string;
  notes: string;
}

export const EMPTY_CHECKOUT_VALUES: CheckoutFormValues = {
  fullName: "",
  email: "",
  phone: "",
  fulfillment: "delivery",
  addressLine1: "",
  addressLine2: "",
  city: "",
  province: "",
  postalCode: "",
  deliveryInstructions: "",
  notes: "",
};

/** First error per field, keyed the way the form renders them. */
export function checkoutFieldErrors(error: z.ZodError): CheckoutFormErrors {
  const errors: CheckoutFormErrors = {};
  for (const issue of error.issues) {
    const key = String(issue.path[0] ?? "form") as keyof CheckoutFormErrors;
    errors[key] ??= issue.message;
  }
  return errors;
}

type CheckoutFormErrors = CheckoutFieldErrors & { form?: string };
