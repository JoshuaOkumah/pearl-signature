import { describe, expect, it } from "vitest";
import {
  EMPTY_CHECKOUT_SETTINGS,
  UNAVAILABLE_CHECKOUT_SETTINGS,
  basisPointsToPercent,
  normalizeCheckoutSettings,
  percentToBasisPoints,
  storeConfigFormSchema,
} from "@/lib/validations/store-config";

/**
 * Store configuration contract tests (Phase 5, Milestone A).
 *
 * The two rules that matter most for order correctness live here:
 * an invalid tax block degrades to "unconfigured" (blocking), never to a
 * silent zero; and the owner cannot turn intake on without a fulfilment
 * method and a confirmed tax treatment.
 */

describe("normalizeCheckoutSettings", () => {
  it("returns the unavailable state for unreadable input", () => {
    expect(normalizeCheckoutSettings(null)).toEqual(UNAVAILABLE_CHECKOUT_SETTINGS);
    expect(normalizeCheckoutSettings("nonsense")).toEqual(UNAVAILABLE_CHECKOUT_SETTINGS);
    expect(normalizeCheckoutSettings(undefined)).toEqual(UNAVAILABLE_CHECKOUT_SETTINGS);
  });

  it("returns honest empty defaults for an empty record", () => {
    expect(normalizeCheckoutSettings({})).toEqual(EMPTY_CHECKOUT_SETTINGS);
  });

  it("passes through a complete valid record", () => {
    const settings = normalizeCheckoutSettings({
      orderIntakeEnabled: true,
      delivery: {
        enabled: true,
        serviceAreas: [{ label: "Downtown", provinces: ["ON"], postalPrefixes: ["M5H"], feeCents: 500 }],
      },
      pickup: { enabled: true, instructions: "Collect at the side door." },
      tax: { mode: "rate", rateBps: 1_300, base: "merchandise", label: "HST" },
      customerNote: "Orders are prepared fresh.",
    });
    expect(settings.available).toBe(true);
    expect(settings.intakeEnabled).toBe(true);
    expect(settings.serviceAreas).toEqual([
      { label: "Downtown", provinces: ["ON"], postalPrefixes: ["M5H"], feeCents: 500 },
    ]);
    expect(settings.pickupInstructions).toBe("Collect at the side door.");
    expect(settings.tax).toEqual({ mode: "rate", rateBps: 1_300, base: "merchandise", label: "HST" });
  });

  it("degrades a broken tax block to unconfigured instead of zero", () => {
    const broken = normalizeCheckoutSettings({ tax: { mode: "rate", rateBps: null, base: "merchandise" } });
    expect(broken.tax.mode).toBe("unconfigured");

    const unknown = normalizeCheckoutSettings({ tax: { mode: "invented", rateBps: 500, base: null } });
    expect(unknown.tax.mode).toBe("unconfigured");
  });

  it("drops malformed service areas rather than rendering a wrong fee", () => {
    const settings = normalizeCheckoutSettings({
      delivery: {
        enabled: true,
        serviceAreas: [
          { label: "Good", provinces: ["ON"], postalPrefixes: [], feeCents: 500 },
          { label: "", provinces: ["ON"], postalPrefixes: [], feeCents: 500 },
          { label: "Bad fee", provinces: ["ON"], postalPrefixes: [], feeCents: -1 },
          { label: "Bad province", provinces: ["XX"], postalPrefixes: [], feeCents: 500 },
          { label: "Bad prefix", provinces: ["ON"], postalPrefixes: ["nope"], feeCents: 500 },
        ],
      },
    });
    expect(settings.serviceAreas.map((area) => area.label)).toEqual(["Good"]);
  });
});

describe("percentToBasisPoints / basisPointsToPercent", () => {
  it("round-trips common approved rates", () => {
    expect(percentToBasisPoints("13")).toBe(1_300);
    expect(percentToBasisPoints("13.5")).toBe(1_350);
    expect(percentToBasisPoints("5")).toBe(500);
    expect(basisPointsToPercent(1_300)).toBe("13");
    expect(basisPointsToPercent(1_350)).toBe("13.5");
  });

  it("rejects malformed or out-of-range rates", () => {
    expect(percentToBasisPoints("")).toBeNull();
    expect(percentToBasisPoints("abc")).toBeNull();
    expect(percentToBasisPoints("0")).toBeNull();
    expect(percentToBasisPoints("101")).toBeNull();
    expect(percentToBasisPoints("-5")).toBeNull();
  });
});

describe("storeConfigFormSchema", () => {
  const valid = {
    orderIntakeEnabled: true,
    deliveryEnabled: true,
    serviceAreas: [{ label: "Downtown", provinces: ["ON"], postalPrefixes: "M5H", fee: "5" }],
    pickupEnabled: true,
    pickupInstructions: "Collect at the side door.",
    taxMode: "rate",
    taxRatePercent: "13",
    taxBase: "merchandise",
    taxLabel: "HST",
    customerNote: "",
  };

  it("accepts a complete configuration", () => {
    const result = storeConfigFormSchema.safeParse(valid);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.serviceAreas[0].fee).toBe(500);
      expect(result.data.serviceAreas[0].postalPrefixes).toEqual(["M5H"]);
      expect(result.data.pickupInstructions).toBe("Collect at the side door.");
      expect(result.data.customerNote).toBeNull();
    }
  });

  it("strips unknown keys (no mass assignment)", () => {
    const result = storeConfigFormSchema.safeParse({ ...valid, adminEmail: "sneaky@example.com", __proto__: {} });
    expect(result.success).toBe(true);
    if (result.success) expect("adminEmail" in result.data).toBe(false);
  });

  it("refuses intake without a fulfilment method", () => {
    const result = storeConfigFormSchema.safeParse({
      ...valid,
      deliveryEnabled: false,
      pickupEnabled: false,
      serviceAreas: [],
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const paths = result.error.issues.map((issue) => String(issue.path[0]));
      expect(paths).toContain("orderIntakeEnabled");
    }
  });

  it("refuses intake while tax is unconfigured", () => {
    const result = storeConfigFormSchema.safeParse({ ...valid, taxMode: "unconfigured" });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.map((issue) => String(issue.path[0]))).toContain("taxMode");
    }
  });

  it("allows an owner to keep everything off", () => {
    const result = storeConfigFormSchema.safeParse({
      ...valid,
      orderIntakeEnabled: false,
      deliveryEnabled: false,
      pickupEnabled: false,
      serviceAreas: [],
      pickupInstructions: "",
      taxMode: "unconfigured",
      taxRatePercent: "",
      taxBase: null,
      taxLabel: "",
    });
    expect(result.success).toBe(true);
  });

  it("refuses pickup without instructions", () => {
    const result = storeConfigFormSchema.safeParse({ ...valid, pickupEnabled: true, pickupInstructions: " " });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.map((issue) => String(issue.path[0]))).toContain("pickupInstructions");
    }
  });

  it("refuses a rate tax without a rate or a base", () => {
    const noRate = storeConfigFormSchema.safeParse({ ...valid, taxRatePercent: "" });
    expect(noRate.success).toBe(false);

    const noBase = storeConfigFormSchema.safeParse({ ...valid, taxBase: "" });
    expect(noBase.success).toBe(false);
    if (!noBase.success) {
      expect(noBase.error.issues.map((issue) => String(issue.path[0]))).toContain("taxBase");
    }
  });

  it("refuses service areas with bad postal prefixes or missing provinces", () => {
    const badPrefix = storeConfigFormSchema.safeParse({
      ...valid,
      serviceAreas: [{ label: "Area", provinces: ["ON"], postalPrefixes: "not-a-prefix", fee: "5" }],
    });
    expect(badPrefix.success).toBe(false);

    const noProvince = storeConfigFormSchema.safeParse({
      ...valid,
      serviceAreas: [{ label: "Area", provinces: [], postalPrefixes: "", fee: "5" }],
    });
    expect(noProvince.success).toBe(false);
  });

  it("accepts free delivery as an explicit zero fee", () => {
    const result = storeConfigFormSchema.safeParse({
      ...valid,
      serviceAreas: [{ label: "Area", provinces: ["ON"], postalPrefixes: "", fee: "0" }],
    });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.serviceAreas[0].fee).toBe(0);
  });
});
