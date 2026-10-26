import type { FulfillmentMethod } from "@/lib/validations/checkout";
import type {
  CheckoutBlocker,
  CheckoutSettings,
  PublicServiceArea,
} from "@/lib/validations/store-config";

/**
 * Checkout pricing boundary (Phase 5) — pure, isomorphic, integer cents.
 *
 * The SAME functions run twice for every order:
 *
 *  1. In the browser, to show the customer the delivery fee, tax and final
 *     total before they commit (honest preview, computed from settings the
 *     server published).
 *  2. On the server inside order creation, where the result is authoritative
 *     and any difference from what the client displayed is rejected as a
 *     price change rather than silently accepted.
 *
 * Because both sides execute this identical code, a displayed total and a
 * persisted total cannot drift. Nothing here reads a database, and nothing
 * here invents a business rule: fees come from owner-configured service
 * areas, tax comes from owner-attested configuration, and when either is
 * missing the result is a blocker, never an assumed zero.
 */

/** Upper bound for an order total (same ceiling as catalogue prices). */
export const MAX_ORDER_TOTAL_CENTS = 99_999_999;

export type PriceBlocker =
  | CheckoutBlocker
  | "method_unavailable"
  | "area_unsupported"
  | "total_out_of_bounds";

export interface OrderTotals {
  subtotalCents: number;
  deliveryFeeCents: number;
  taxCents: number;
  totalCents: number;
}

export interface DeliveryAddressForMatching {
  province: string;
  postalCode: string;
}

export type PriceCheckoutResult =
  | { ok: true; totals: OrderTotals }
  | { ok: false; blocker: PriceBlocker };

/* ── readiness ──────────────────────────────────────────────────────── */

/**
 * Everything currently preventing live order submission, in the order the
 * customer should read them. An empty list means checkout can submit.
 */
export function checkoutBlockers(settings: CheckoutSettings): CheckoutBlocker[] {
  const blockers: CheckoutBlocker[] = [];
  if (!settings.available) {
    blockers.push("settings_unavailable");
    return blockers;
  }
  if (!settings.intakeEnabled) blockers.push("intake_closed");
  if (!settings.deliveryEnabled && !settings.pickupEnabled) blockers.push("no_fulfillment_method");
  if (settings.tax.mode === "unconfigured") blockers.push("tax_unconfigured");
  return blockers;
}

/* ── service-area matching ──────────────────────────────────────────── */

/**
 * Which owner-configured area (if any) serves this address.
 *
 * Rules, deliberately simple and publishable: the province must be listed
 * for the area, and when the area lists postal prefixes the address's FSA
 * (first three characters of the postal code) must be one of them. An area
 * with no prefixes covers its whole province. No geocoding, no distance.
 *
 * Matching is case and whitespace insensitive; a malformed postal code
 * simply matches no prefixed area rather than throwing.
 */
export function matchServiceArea(
  address: DeliveryAddressForMatching,
  areas: PublicServiceArea[],
): PublicServiceArea | null {
  const province = address.province.trim().toUpperCase();
  const fsa = address.postalCode.replace(/[\s-]/g, "").toUpperCase().slice(0, 3);

  for (const area of areas) {
    if (!area.provinces.includes(province)) continue;
    if (area.postalPrefixes.length === 0) return area;
    if (/^[A-Z]\d[A-Z]$/.test(fsa) && area.postalPrefixes.includes(fsa)) return area;
  }
  return null;
}

/* ── tax ────────────────────────────────────────────────────────────── */

/**
 * Owner-attested tax, rounded **half up to the nearest cent** using integer
 * arithmetic only: `floor((base × rateBps + 5 000) ÷ 10 000)`.
 *
 * The policy is deterministic and documented in `docs/BUSINESS_CONFIGURATION.md`.
 * `mode: "zero"` is an explicit owner statement that no tax is collected;
 * `mode: "unconfigured"` never reaches this function because it blocks.
 */
export function calculateTaxCents(
  baseCents: number,
  tax: CheckoutSettings["tax"],
): { ok: true; taxCents: number } | { ok: false } {
  if (tax.mode === "zero") return { ok: true, taxCents: 0 };
  if (tax.mode !== "rate" || tax.rateBps === null || tax.base === null) return { ok: false };
  if (!Number.isInteger(baseCents) || baseCents < 0) return { ok: false };
  return { ok: true, taxCents: Math.floor((baseCents * tax.rateBps + 5_000) / 10_000) };
}

/* ── totals ─────────────────────────────────────────────────────────── */

/**
 * Full order pricing for one fulfilment method. Fails loudly (a blocker)
 * instead of guessing:
 *
 *  - any unresolved readiness blocker passes straight through;
 *  - a method the owner has not enabled is unavailable;
 *  - delivery outside every configured service area is unsupported;
 *  - an unusable tax configuration cannot produce a total.
 */
export function priceCheckout(input: {
  subtotalCents: number;
  method: FulfillmentMethod;
  address?: DeliveryAddressForMatching | null;
  settings: CheckoutSettings;
}): PriceCheckoutResult {
  const blockers = checkoutBlockers(input.settings);
  if (blockers.length > 0) return { ok: false, blocker: blockers[0] };

  const { subtotalCents, settings } = input;
  if (!Number.isInteger(subtotalCents) || subtotalCents < 0) {
    return { ok: false, blocker: "total_out_of_bounds" };
  }

  let deliveryFeeCents = 0;
  if (input.method === "delivery") {
    if (!settings.deliveryEnabled) return { ok: false, blocker: "method_unavailable" };
    const area = matchServiceArea(
      input.address ?? { province: "", postalCode: "" },
      settings.serviceAreas,
    );
    if (!area) return { ok: false, blocker: "area_unsupported" };
    deliveryFeeCents = area.feeCents;
  } else {
    if (!settings.pickupEnabled) return { ok: false, blocker: "method_unavailable" };
    deliveryFeeCents = 0;
  }

  const taxBaseCents =
    settings.tax.mode === "rate" && settings.tax.base === "with_delivery"
      ? subtotalCents + deliveryFeeCents
      : subtotalCents;

  const tax = calculateTaxCents(taxBaseCents, settings.tax);
  if (!tax.ok) return { ok: false, blocker: "tax_unconfigured" };

  const totalCents = subtotalCents + deliveryFeeCents + tax.taxCents;
  if (!Number.isSafeInteger(totalCents) || totalCents > MAX_ORDER_TOTAL_CENTS) {
    return { ok: false, blocker: "total_out_of_bounds" };
  }

  return {
    ok: true,
    totals: {
      subtotalCents,
      deliveryFeeCents,
      taxCents: tax.taxCents,
      totalCents,
    },
  };
}
