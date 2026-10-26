import { describe, expect, it } from "vitest";
import {
  calculateTaxCents,
  checkoutBlockers,
  matchServiceArea,
  priceCheckout,
} from "@/lib/checkout/pricing";
import type { CheckoutSettings, PublicServiceArea } from "@/lib/validations/store-config";

/**
 * Pricing boundary tests (Phase 5, Milestone A).
 *
 * These rules decide whether live ordering is allowed and what a customer
 * is charged, so every branch that could invent money is pinned here:
 * a missing configuration must block, fees must come from a matched area,
 * and tax is only ever the owner's own attested value.
 */

function settings(overrides: Partial<CheckoutSettings> = {}): CheckoutSettings {
  return {
    available: true,
    intakeEnabled: true,
    deliveryEnabled: true,
    serviceAreas: [],
    pickupEnabled: true,
    pickupInstructions: "Collect from the kitchen door.",
    tax: { mode: "zero", rateBps: null, base: null, label: null },
    customerNote: null,
    ...overrides,
  };
}

const areas: PublicServiceArea[] = [
  { label: "Downtown", provinces: ["ON"], postalPrefixes: ["M5H", "M5V"], feeCents: 500 },
  { label: "All Ontario", provinces: ["ON"], postalPrefixes: [], feeCents: 800 },
  { label: "Calgary", provinces: ["AB"], postalPrefixes: [], feeCents: 0 },
];

describe("checkoutBlockers", () => {
  it("reports nothing when everything is configured", () => {
    expect(checkoutBlockers(settings())).toEqual([]);
  });

  it("blocks with a single reason when settings cannot be read", () => {
    expect(checkoutBlockers(settings({ available: false }))).toEqual(["settings_unavailable"]);
  });

  it("blocks while intake is closed", () => {
    expect(checkoutBlockers(settings({ intakeEnabled: false }))).toEqual(["intake_closed"]);
  });

  it("blocks when no fulfilment method is enabled", () => {
    expect(
      checkoutBlockers(settings({ deliveryEnabled: false, pickupEnabled: false })),
    ).toEqual(["no_fulfillment_method"]);
  });

  it("blocks while tax is unconfigured", () => {
    expect(
      checkoutBlockers(settings({ tax: { mode: "unconfigured", rateBps: null, base: null, label: null } })),
    ).toEqual(["tax_unconfigured"]);
  });

  it("lists intake first when several decisions are pending", () => {
    const blockers = checkoutBlockers(
      settings({
        intakeEnabled: false,
        deliveryEnabled: false,
        pickupEnabled: false,
        tax: { mode: "unconfigured", rateBps: null, base: null, label: null },
      }),
    );
    expect(blockers[0]).toBe("intake_closed");
    expect(blockers).toHaveLength(3);
  });
});

describe("matchServiceArea", () => {
  it("prefers an area whose postal prefixes match", () => {
    const matched = matchServiceArea({ province: "ON", postalCode: "M5H 2N2" }, areas);
    expect(matched?.label).toBe("Downtown");
  });

  it("falls back to a province-wide area outside the prefixes", () => {
    const matched = matchServiceArea({ province: "ON", postalCode: "K1A 0B1" }, areas);
    expect(matched?.label).toBe("All Ontario");
  });

  it("matches a different province by its own area", () => {
    const matched = matchServiceArea({ province: "AB", postalCode: "T2P 1J1" }, areas);
    expect(matched?.label).toBe("Calgary");
  });

  it("matches case and whitespace insensitively", () => {
    const matched = matchServiceArea({ province: " on ", postalCode: "m5h2n2" }, areas);
    expect(matched?.label).toBe("Downtown");
  });

  it("returns null outside every configured area", () => {
    expect(matchServiceArea({ province: "QC", postalCode: "H2X 1Y4" }, areas)).toBeNull();
    expect(matchServiceArea({ province: "", postalCode: "" }, areas)).toBeNull();
  });

  it("never matches a malformed postal code against a prefixed area", () => {
    // Province-wide areas still serve it; the prefixed one must not.
    const matched = matchServiceArea({ province: "ON", postalCode: "not-a-code" }, areas.slice(0, 1));
    expect(matched).toBeNull();
  });
});

describe("calculateTaxCents", () => {
  it("returns zero for an owner-attested zero treatment", () => {
    const result = calculateTaxCents(12_345, {
      mode: "zero",
      rateBps: null,
      base: null,
      label: null,
    });
    expect(result).toEqual({ ok: true, taxCents: 0 });
  });

  it("refuses to invent tax when unconfigured", () => {
    expect(
      calculateTaxCents(12_345, { mode: "unconfigured", rateBps: null, base: null, label: null }),
    ).toEqual({ ok: false });
  });

  it("applies an owner rate with documented half-up rounding", () => {
    const tax = { mode: "rate" as const, rateBps: 1_300, base: "merchandise" as const, label: "HST" };
    // $10.00 × 13% = $1.30 exactly
    expect(calculateTaxCents(1_000, tax)).toEqual({ ok: true, taxCents: 130 });
    // $19.99 × 13% = $2.5987 → $2.60 (half up)
    expect(calculateTaxCents(1_999, tax)).toEqual({ ok: true, taxCents: 260 });
    // $0.01 × 13% = $0.0013 → $0.00 (never a phantom cent)
    expect(calculateTaxCents(1, tax)).toEqual({ ok: true, taxCents: 0 });
  });

  it("treats a rate without a base or rate as unusable", () => {
    expect(calculateTaxCents(1_000, { mode: "rate", rateBps: null, base: null, label: null })).toEqual({
      ok: false,
    });
    expect(calculateTaxCents(1_000, { mode: "rate", rateBps: 1_300, base: null, label: null })).toEqual({
      ok: false,
    });
  });

  it("rejects negative or non-integer bases", () => {
    const tax = { mode: "rate" as const, rateBps: 500, base: "merchandise" as const, label: null };
    expect(calculateTaxCents(-1, tax)).toEqual({ ok: false });
    expect(calculateTaxCents(10.5, tax)).toEqual({ ok: false });
  });
});

describe("priceCheckout", () => {
  it("prices delivery with the matched area fee and zero tax", () => {
    const result = priceCheckout({
      subtotalCents: 3_750,
      method: "delivery",
      address: { province: "ON", postalCode: "M5H 2N2" },
      settings: settings({ serviceAreas: areas }),
    });
    expect(result).toEqual({
      ok: true,
      totals: { subtotalCents: 3_750, deliveryFeeCents: 500, taxCents: 0, totalCents: 4_250 },
    });
  });

  it("prices pickup without a delivery fee", () => {
    const result = priceCheckout({ subtotalCents: 3_750, method: "pickup", settings: settings({ serviceAreas: areas }) });
    expect(result).toEqual({
      ok: true,
      totals: { subtotalCents: 3_750, deliveryFeeCents: 0, taxCents: 0, totalCents: 3_750 },
    });
  });

  it("applies a rate tax on the configured base", () => {
    const result = priceCheckout({
      subtotalCents: 2_000,
      method: "pickup",
      settings: settings({
        tax: { mode: "rate", rateBps: 1_300, base: "with_delivery", label: "HST" },
      }),
    });
    expect(result).toEqual({
      ok: true,
      totals: { subtotalCents: 2_000, deliveryFeeCents: 0, taxCents: 260, totalCents: 2_260 },
    });
  });

  it("refuses delivery outside every service area", () => {
    const result = priceCheckout({
      subtotalCents: 1_000,
      method: "delivery",
      address: { province: "QC", postalCode: "H2X 1Y4" },
      settings: settings({ serviceAreas: areas }),
    });
    expect(result).toEqual({ ok: false, blocker: "area_unsupported" });
  });

  it("refuses a method the owner has not enabled", () => {
    expect(
      priceCheckout({ subtotalCents: 1_000, method: "pickup", settings: settings({ pickupEnabled: false }) }),
    ).toEqual({ ok: false, blocker: "method_unavailable" });
    expect(
      priceCheckout({
        subtotalCents: 1_000,
        method: "delivery",
        address: { province: "ON", postalCode: "M5H 2N2" },
        settings: settings({ deliveryEnabled: false, serviceAreas: areas }),
      }),
    ).toEqual({ ok: false, blocker: "method_unavailable" });
  });

  it("passes readiness blockers straight through", () => {
    expect(
      priceCheckout({ subtotalCents: 1_000, method: "pickup", settings: settings({ intakeEnabled: false }) }),
    ).toEqual({ ok: false, blocker: "intake_closed" });
    expect(
      priceCheckout({
        subtotalCents: 1_000,
        method: "pickup",
        settings: settings({
          tax: { mode: "unconfigured", rateBps: null, base: null, label: null },
        }),
      }),
    ).toEqual({ ok: false, blocker: "tax_unconfigured" });
  });

  it("never produces a total above the supported money ceiling", () => {
    const result = priceCheckout({
      subtotalCents: 99_999_999,
      method: "pickup",
      settings: settings(),
    });
    // Subtotal at the ceiling plus zero fee and zero tax is still valid…
    expect(result.ok).toBe(true);
    // …but a fee pushing past it is refused rather than wrapped.
    const overflow = priceCheckout({
      subtotalCents: 99_999_999,
      method: "delivery",
      address: { province: "ON", postalCode: "M5H 2N2" },
      settings: settings({ serviceAreas: [{ label: "Fee", provinces: ["ON"], postalPrefixes: [], feeCents: 999_999 }] }),
    });
    expect(overflow).toEqual({ ok: false, blocker: "total_out_of_bounds" });
  });
});
