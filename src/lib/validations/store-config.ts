import { z } from "zod";
import { CANADIAN_PROVINCES } from "@/lib/validations/checkout";

/**
 * Store checkout configuration contract (Phase 5).
 *
 * Two audiences, two shapes:
 *
 *  - `storeConfigFormSchema` parses the owner's settings form on the server.
 *    It is the complete allowlist of writable fields (unknown keys are
 *    stripped) and encodes the consistency rules: a rate tax needs a rate
 *    and a base, service areas need a province and a fee, and pickup needs
 *    instructions before it can be offered.
 *  - `CheckoutSettings` is the sanitised public projection served to the
 *    checkout client. It contains only what a customer needs to see before
 *    ordering (which methods exist, which areas are served, what they cost).
 *    It never contains internal ids or anything the admin wrote privately.
 *
 * This module is isomorphic: the pure pricing helpers and the checkout UI
 * both import it. Money is integer cents everywhere.
 */

/* ── shared constants ───────────────────────────────────────────────── */

export const TAX_MODES = ["unconfigured", "zero", "rate"] as const;
export type TaxMode = (typeof TAX_MODES)[number];

export const TAX_BASES = ["merchandise", "with_delivery"] as const;
export type TaxBase = (typeof TAX_BASES)[number];

const PROVINCE_CODES = CANADIAN_PROVINCES.map((province) => province.code) as [string, ...string[]];

/** Canadian forward sortation area, e.g. `M5H` (case-insensitive input). */
export const FSA_PATTERN = /^[A-Z]\d[A-Z]$/;
export const MAX_SERVICE_AREAS = 20;

/* ── public settings (checkout client projection) ───────────────────── */

export interface PublicServiceArea {
  label: string;
  provinces: string[];
  postalPrefixes: string[];
  feeCents: number;
}

export interface PublicTaxSettings {
  mode: (typeof TAX_MODES)[number];
  rateBps: number | null;
  base: (typeof TAX_BASES)[number] | null;
  label: string | null;
}

export interface CheckoutSettings {
  /** False when the configuration could not be read (no database). */
  available: boolean;
  intakeEnabled: boolean;
  deliveryEnabled: boolean;
  serviceAreas: PublicServiceArea[];
  pickupEnabled: boolean;
  pickupInstructions: string | null;
  tax: PublicTaxSettings;
  customerNote: string | null;
}

/** Everything the customer cannot order until the owner resolves. */
export type CheckoutBlocker =
  | "settings_unavailable"
  | "intake_closed"
  | "no_fulfillment_method"
  | "tax_unconfigured";

/** The honest, read-only state used when nothing can be configured. */
export const UNAVAILABLE_CHECKOUT_SETTINGS: CheckoutSettings = Object.freeze({
  available: false,
  intakeEnabled: false,
  deliveryEnabled: false,
  serviceAreas: [],
  pickupEnabled: false,
  pickupInstructions: null,
  tax: { mode: "unconfigured", rateBps: null, base: null, label: null } satisfies PublicTaxSettings,
  customerNote: null,
});

/**
 * Fresh-deployment defaults: readable, but every business decision still
 * pending. Intake is closed until the owner explicitly opens it.
 */
export const EMPTY_CHECKOUT_SETTINGS: CheckoutSettings = Object.freeze({
  available: true,
  intakeEnabled: false,
  deliveryEnabled: false,
  serviceAreas: [],
  pickupEnabled: false,
  pickupInstructions: null,
  tax: { mode: "unconfigured", rateBps: null, base: null, label: null } satisfies PublicTaxSettings,
  customerNote: null,
});

/* ── admin form schema ──────────────────────────────────────────────── */

/**
 * Delivery fee input: `""` or `0` means explicitly free (a legitimate
 * owner choice), otherwise the usual CAD shape up to $9,999.99.
 */
const feeInputSchema = z
  .string()
  .trim()
  .max(16, "Fee is too long")
  .refine((value) => value === "" || /^\$?\d{1,4}(\.\d{1,2})?$/.test(value), {
    message: "Enter a fee like 5.00 (up to two decimal places)",
  })
  .transform((value): number => {
    if (value === "" || value === "0") return 0;
    const [whole, fraction = ""] = value.replace(/^\$/, "").split(".");
    return Number(whole) * 100 + Number(`${fraction}00`.slice(0, 2));
  })
  .refine((cents) => Number.isInteger(cents) && cents >= 0 && cents <= 999_999, {
    message: "Fee must be between $0.00 and $9,999.99",
  });

/** Comma-separated FSA list → normalised, deduplicated prefixes. */
const fsaListInput = z
  .string()
  .trim()
  .max(2_000, "Postal prefixes are too long")
  .transform((value) =>
    value === ""
      ? []
      : [
          ...new Set(
            value
              .split(",")
              .map((prefix) => prefix.trim().toUpperCase().replace(/\s+/g, ""))
              .filter(Boolean),
          ),
        ],
  )
  .refine((prefixes) => prefixes.length <= 200, "Use at most 200 postal prefixes")
  .refine(
    (prefixes) => prefixes.every((prefix) => FSA_PATTERN.test(prefix)),
    "Postal prefixes must be 3-character FSAs like M5H",
  );

export const serviceAreaInputSchema = z.object({
  label: z.string().trim().min(1, "Name the area you deliver to").max(80, "Label is too long"),
  provinces: z
    .array(z.enum(PROVINCE_CODES))
    .min(1, "Choose at least one province")
    .max(13, "At most 13 provinces and territories"),
  postalPrefixes: fsaListInput,
  fee: feeInputSchema,
});

export type ServiceAreaInput = z.output<typeof serviceAreaInputSchema>;

export const TAX_RATE_PERCENT_PATTERN = /^\d{1,2}(\.\d{1,2})?$/;

/** Percent string ("13", "13.5") → integer basis points (1300, 1350). */
export function percentToBasisPoints(raw: string): number | null {
  const value = raw.trim();
  if (value === "" || !TAX_RATE_PERCENT_PATTERN.test(value)) return null;
  const [whole, fraction = ""] = value.split(".");
  const bps = Number(whole) * 100 + Number(`${fraction}00`.slice(0, 2));
  if (!Number.isInteger(bps) || bps < 1 || bps > 10_000) return null;
  return bps;
}

/** Integer basis points → percent string for the admin input ("1300" → "13"). */
export function basisPointsToPercent(bps: number | null): string {
  if (typeof bps !== "number" || !Number.isInteger(bps) || bps < 1) return "";
  const whole = Math.floor(bps / 100);
  const remainder = bps % 100;
  return remainder === 0 ? String(whole) : `${whole}.${String(remainder).padStart(2, "0").replace(/0$/, "")}`;
}

export const storeConfigFormSchema = z
  .object({
    orderIntakeEnabled: z.boolean(),
    deliveryEnabled: z.boolean(),
    serviceAreas: z
      .array(serviceAreaInputSchema)
      .max(MAX_SERVICE_AREAS, `At most ${MAX_SERVICE_AREAS} service areas`),
    pickupEnabled: z.boolean(),
    pickupInstructions: z
      .string()
      .trim()
      .max(500, "Instructions are too long")
      .transform((value) => (value === "" ? null : value)),
    taxMode: z.enum(TAX_MODES, { message: "Choose a tax treatment" }),
    taxRatePercent: z.string().trim().max(8, "Rate is too long"),
    taxBase: z.enum(TAX_BASES).nullable().catch(null),
    taxLabel: z
      .string()
      .trim()
      .max(40, "Label is too long")
      .transform((value) => (value === "" ? null : value)),
    customerNote: z
      .string()
      .trim()
      .max(300, "Note is too long")
      .transform((value) => (value === "" ? null : value)),
    /** Optimistic-concurrency token: the updatedAt the editor loaded. */
    expectedUpdatedAt: z.string().trim().max(40).optional().catch(undefined),
  })
  .superRefine((value, ctx) => {
    if (value.deliveryEnabled && value.serviceAreas.length === 0) {
      ctx.addIssue({
        code: "custom",
        path: ["serviceAreas"],
        message: "Add at least one service area, or turn delivery off",
      });
    }

    if (value.pickupEnabled && !value.pickupInstructions) {
      ctx.addIssue({
        code: "custom",
        path: ["pickupInstructions"],
        message: "Describe where and how pickup works before offering it",
      });
    }

    if (value.taxMode === "rate") {
      if (percentToBasisPoints(value.taxRatePercent) === null) {
        ctx.addIssue({
          code: "custom",
          path: ["taxRatePercent"],
          message: "Enter the approved rate as a percentage, for example 13",
        });
      }
      if (value.taxBase === null) {
        ctx.addIssue({
          code: "custom",
          path: ["taxBase"],
          message: "Choose what the rate applies to",
        });
      }
    }

    if (value.orderIntakeEnabled) {
      if (!value.deliveryEnabled && !value.pickupEnabled) {
        ctx.addIssue({
          code: "custom",
          path: ["orderIntakeEnabled"],
          message: "Turn on delivery or pickup before accepting orders",
        });
      }
      if (value.taxMode === "unconfigured") {
        ctx.addIssue({
          code: "custom",
          path: ["taxMode"],
          message: "Confirm the tax treatment before accepting orders",
        });
      }
    }
  });

export type StoreConfigFormInput = z.output<typeof storeConfigFormSchema>;

/* ── record parsing (defensive read) ────────────────────────────────── */

/**
 * Parse whatever the database returns into safe settings. An invalid or
 * half-written record degrades to "unconfigured", never to a guess: a
 * corrupt tax block must block orders rather than silently charge $0 tax.
 */
export function normalizeCheckoutSettings(raw: unknown): CheckoutSettings {
  if (typeof raw !== "object" || raw === null) return UNAVAILABLE_CHECKOUT_SETTINGS;
  const record = raw as Record<string, unknown>;
  const delivery = (record.delivery ?? {}) as Record<string, unknown>;
  const pickup = (record.pickup ?? {}) as Record<string, unknown>;
  const tax = (record.tax ?? {}) as Record<string, unknown>;

  const areas: PublicServiceArea[] = [];
  if (Array.isArray(delivery.serviceAreas)) {
    for (const entry of delivery.serviceAreas) {
      if (typeof entry !== "object" || entry === null) continue;
      const area = entry as Record<string, unknown>;
      const label = typeof area.label === "string" ? area.label.trim() : "";
      const provinces = Array.isArray(area.provinces)
        ? area.provinces.filter((code): code is string => PROVINCE_CODES.includes(code as string))
        : [];
      // Prefix validation is deliberately strict: a stored prefix that no
      // longer validates would otherwise be dropped and silently WIDEN the
      // area to the whole province. Any invalid entry marks the record as
      // malformed, and a malformed area is refused rather than expanded.
      const rawPrefixes = area.postalPrefixes;
      let postalPrefixes: string[] = [];
      let prefixesValid = true;
      if (rawPrefixes === undefined || rawPrefixes === null) {
        postalPrefixes = [];
      } else if (Array.isArray(rawPrefixes)) {
        prefixesValid = rawPrefixes.every(
          (prefix) => typeof prefix === "string" && FSA_PATTERN.test(prefix),
        );
        postalPrefixes = prefixesValid ? [...rawPrefixes] : [];
      } else {
        prefixesValid = false;
      }
      const feeCents = area.feeCents;
      if (
        !prefixesValid ||
        label === "" ||
        provinces.length === 0 ||
        typeof feeCents !== "number" ||
        !Number.isInteger(feeCents) ||
        feeCents < 0 ||
        feeCents > 999_999
      ) {
        continue; // malformed area: drop it, never render a wrong fee
      }
      areas.push({ label, provinces, postalPrefixes, feeCents });
    }
  }

  const mode = TAX_MODES.includes(tax.mode as (typeof TAX_MODES)[number])
    ? (tax.mode as PublicTaxSettings["mode"])
    : "unconfigured";
  const rateBps =
    typeof tax.rateBps === "number" && Number.isInteger(tax.rateBps) && tax.rateBps >= 1 && tax.rateBps <= 10_000
      ? tax.rateBps
      : null;
  const base = TAX_BASES.includes(tax.base as (typeof TAX_BASES)[number])
    ? (tax.base as PublicTaxSettings["base"])
    : null;

  return {
    available: true,
    intakeEnabled: record.orderIntakeEnabled === true,
    deliveryEnabled: delivery.enabled === true,
    serviceAreas: areas,
    pickupEnabled: pickup.enabled === true,
    pickupInstructions: typeof pickup.instructions === "string" && pickup.instructions.trim() !== ""
      ? pickup.instructions
      : null,
    // A rate tax without a valid rate or base is treated as unconfigured:
    // that configuration cannot produce an accurate total, so it blocks.
    tax:
      mode === "rate" && (rateBps === null || base === null)
        ? { mode: "unconfigured", rateBps: null, base: null, label: null }
        : { mode, rateBps: mode === "rate" ? rateBps : null, base: mode === "rate" ? base : null, label: typeof tax.label === "string" && tax.label.trim() !== "" ? tax.label : null },
    customerNote:
      typeof record.customerNote === "string" && record.customerNote.trim() !== ""
        ? record.customerNote
        : null,
  };
}
