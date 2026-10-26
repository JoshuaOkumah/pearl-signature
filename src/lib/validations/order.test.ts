import { describe, expect, it } from "vitest";
import {
  ORDER_KEY_PATTERN,
  ORDER_REFERENCE_PATTERN,
  MAX_ORDER_ITEMS,
  orderConfirmationRequestSchema,
  placeOrderRequestSchema,
} from "./order";
import { MAX_CART_LINES, MAX_CART_QUANTITY, MAX_LINE_QUANTITY } from "@/lib/cart/limits";
import { MAX_ORDER_TOTAL_CENTS } from "@/lib/checkout/pricing";

/**
 * Order contract tests (Phase 5, Milestone B).
 *
 * This is the public boundary between a customer's browser and the order
 * service, so the tests below assert the three properties everything else
 * depends on:
 *
 *  1. **Allowlist** — only the documented fields survive parsing. In
 *     particular there is no way to inject a price, a total, a status or a
 *     "payment succeeded" flag.
 *  2. **Bounds** — every array and number is explicitly capped, so one
 *     request can never trigger an unbounded read or write.
 *  3. **Capabilities** — the idempotency and confirmation keys are strict
 *     hex, unpredictable in length and never accepted in a malformed form.
 */

const KEY = "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2";

function baseRequest(overrides: Record<string, unknown> = {}) {
  return {
    idempotencyKey: KEY,
    confirmationKey: KEY.replace(/^./, "9"),
    expectedTotalCents: 4_938,
    items: [{ slug: "jollof-test", variantName: null, quantity: 3 }],
    customer: {
      fullName: "Ada Obi",
      email: "Ada.Obi@example.com",
      phone: "416 555 0123",
      fulfillment: "delivery",
      addressLine1: "1 Test Way",
      addressLine2: "",
      city: "Toronto",
      province: "ON",
      postalCode: "M5H 2N2",
      deliveryInstructions: "",
      notes: "",
    },
    paymentMethod: "cash_on_arrival",
    ...overrides,
  };
}

describe("placeOrderRequestSchema", () => {
  it("accepts a complete delivery request and normalises it", () => {
    const parsed = placeOrderRequestSchema.parse(baseRequest());

    expect(parsed.customer.email).toBe("ada.obi@example.com"); // lowercased
    expect(parsed.customer.phone).toBe("+14165550123"); // E.164-ish
    expect(parsed.customer.postalCode).toBe("M5H 2N2");
    expect(parsed.paymentMethod).toBe("cash_on_arrival");
  });

  it("accepts a pickup request without an address", () => {
    const parsed = placeOrderRequestSchema.parse(
      baseRequest({
        customer: {
          fullName: "Ada Obi",
          email: "ada@example.com",
          phone: "4165550123",
          fulfillment: "pickup",
          addressLine1: "",
          addressLine2: "",
          city: "",
          province: "",
          postalCode: "",
          deliveryInstructions: "",
          notes: "",
        },
      }),
    );

    expect(parsed.customer.fulfillment).toBe("pickup");
    // Empty strings normalise to "not provided" rather than being stored.
    expect(parsed.customer.addressLine1).toBeNull();
    expect(parsed.customer.city).toBeNull();
  });

  it("strips every field that is not on the allowlist", () => {
    const parsed = placeOrderRequestSchema.parse(
      baseRequest({
        status: "completed",
        paymentStatus: "paid",
        totalCents: 1,
        priceCents: 0,
        discount: 500,
        isAdmin: true,
        confirmedAt: "2026-01-01T00:00:00Z",
      }),
    );

    const output = parsed as unknown as Record<string, unknown>;
    expect(output).not.toHaveProperty("status");
    expect(output).not.toHaveProperty("paymentStatus");
    expect(output).not.toHaveProperty("totalCents");
    expect(output).not.toHaveProperty("priceCents");
    expect(output).not.toHaveProperty("discount");
    expect(output).not.toHaveProperty("isAdmin");
    expect(output).not.toHaveProperty("confirmedAt");
  });

  it("strips injected prices from the cart lines themselves", () => {
    const parsed = placeOrderRequestSchema.parse(
      baseRequest({
        items: [{ slug: "jollof-test", variantName: null, quantity: 2, priceCents: 1, lineTotalCents: 1 }],
      }),
    );

    expect(parsed.items[0]).toEqual({ slug: "jollof-test", variantName: null, quantity: 2 });
  });

  it("rejects any payment method other than Cash on Arrival", () => {
    const result = placeOrderRequestSchema.safeParse(baseRequest({ paymentMethod: "card" }));
    expect(result.success).toBe(false);
  });

  it("accepts only 32-64 character lowercase hex keys", () => {
    expect(ORDER_KEY_PATTERN.test(KEY)).toBe(true);
    expect(placeOrderRequestSchema.safeParse(baseRequest({ idempotencyKey: KEY.slice(0, 31) })).success).toBe(false);
    expect(placeOrderRequestSchema.safeParse(baseRequest({ idempotencyKey: `${KEY}a` })).success).toBe(false);
    expect(placeOrderRequestSchema.safeParse(baseRequest({ confirmationKey: "z".repeat(64) })).success).toBe(false);
  });

  it("lowercases and trims a capability before matching it", () => {
    const parsed = placeOrderRequestSchema.parse(
      baseRequest({ idempotencyKey: `  ${KEY.toUpperCase()}  ` }),
    );
    expect(parsed.idempotencyKey).toBe(KEY);
  });

  it("bounds the reviewed total to positive whole cents", () => {
    expect(placeOrderRequestSchema.safeParse(baseRequest({ expectedTotalCents: 0 })).success).toBe(false);
    expect(placeOrderRequestSchema.safeParse(baseRequest({ expectedTotalCents: -100 })).success).toBe(false);
    expect(placeOrderRequestSchema.safeParse(baseRequest({ expectedTotalCents: 12.5 })).success).toBe(false);
    expect(
      placeOrderRequestSchema.safeParse(baseRequest({ expectedTotalCents: MAX_ORDER_TOTAL_CENTS + 1 })).success,
    ).toBe(false);
    // A numeric string is coerced, because form state round-trips as text.
    expect(placeOrderRequestSchema.parse(baseRequest({ expectedTotalCents: "4938" })).expectedTotalCents).toBe(4_938);
  });

  it("rejects an empty cart", () => {
    expect(placeOrderRequestSchema.safeParse(baseRequest({ items: [] })).success).toBe(false);
  });

  it("rejects duplicate line identities", () => {
    const result = placeOrderRequestSchema.safeParse(
      baseRequest({
        items: [
          { slug: "jollof-test", variantName: null, quantity: 1 },
          { slug: "jollof-test", variantName: null, quantity: 2 },
        ],
      }),
    );
    expect(result.success).toBe(false);
  });

  it("rejects carts beyond the shared line and quantity bounds", () => {
    const tooManyLines = Array.from({ length: MAX_CART_LINES + 1 }, (_, index) => ({
      slug: `item-${index}`,
      variantName: null,
      quantity: 1,
    }));
    expect(placeOrderRequestSchema.safeParse(baseRequest({ items: tooManyLines })).success).toBe(false);

    const tooManyUnits = Array.from({ length: 5 }, () => ({
      slug: "jollof-test",
      variantName: null,
      quantity: MAX_LINE_QUANTITY,
    }));
    // 5 distinct-slug lines would exceed the cart unit cap (99) as well.
    const capped = tooManyUnits.map((item, index) => ({ ...item, slug: `bulk-${index}` }));
    expect(
      placeOrderRequestSchema.safeParse(
        baseRequest({ items: [...capped, { slug: "one-more", variantName: null, quantity: 10 }] }),
      ).success,
    ).toBe(false);
    expect(MAX_CART_QUANTITY).toBeLessThanOrEqual(99);
  });

  it("rejects out-of-range quantities", () => {
    expect(
      placeOrderRequestSchema.safeParse(baseRequest({ items: [{ slug: "jollof-test", variantName: null, quantity: 0 }] }))
        .success,
    ).toBe(false);
    expect(
      placeOrderRequestSchema.safeParse(
        baseRequest({
          items: [{ slug: "jollof-test", variantName: null, quantity: MAX_LINE_QUANTITY + 1 }],
        }),
      ).success,
    ).toBe(false);
  });

  it("requires a complete address only for delivery", () => {
    const missingAddress = placeOrderRequestSchema.safeParse(
      baseRequest({
        customer: {
          fullName: "Ada Obi",
          email: "ada@example.com",
          phone: "4165550123",
          fulfillment: "delivery",
          addressLine1: "",
          addressLine2: "",
          city: "",
          province: "",
          postalCode: "",
          deliveryInstructions: "",
          notes: "",
        },
      }),
    );
    expect(missingAddress.success).toBe(false);
  });

  it("rejects a phone number that is not a plausible Canadian number", () => {
    expect(
      placeOrderRequestSchema.safeParse(baseRequest({ customer: { ...baseRequest().customer, phone: "000 000 0000" } }))
        .success,
    ).toBe(false);
  });

  it("caps the line count at the documented order maximum", () => {
    expect(MAX_ORDER_ITEMS).toBe(MAX_CART_LINES);
  });
});

describe("orderConfirmationRequestSchema", () => {
  it("accepts a well-formed reference and capability", () => {
    const parsed = orderConfirmationRequestSchema.parse({ reference: "PS-1A2B3C4D5E", accessKey: KEY });
    expect(parsed.reference).toBe("PS-1A2B3C4D5E");
    expect(parsed.accessKey).toBe(KEY);
  });

  it("normalises a lower-case reference before matching it", () => {
    const parsed = orderConfirmationRequestSchema.parse({ reference: "  ps-1a2b3c4d5e ", accessKey: KEY });
    expect(parsed.reference).toBe("PS-1A2B3C4D5E");
    expect(ORDER_REFERENCE_PATTERN.test(parsed.reference)).toBe(true);
  });

  it("rejects malformed references so probes never reach the database", () => {
    for (const reference of ["PS-1A2B3C4D5", "PS-1A2B3C4D5EF", "PS-XXXXXXXXXX", "1A2B3C4D5E", ""]) {
      expect(orderConfirmationRequestSchema.safeParse({ reference, accessKey: KEY }).success).toBe(false);
    }
  });

  it("rejects a missing or malformed capability", () => {
    expect(orderConfirmationRequestSchema.safeParse({ reference: "PS-1A2B3C4D5E" }).success).toBe(false);
    expect(orderConfirmationRequestSchema.safeParse({ reference: "PS-1A2B3C4D5E", accessKey: "short" }).success).toBe(
      false,
    );
  });

  it("strips anything added to the lookup payload", () => {
    const parsed = orderConfirmationRequestSchema.parse({
      reference: "PS-1A2B3C4D5E",
      accessKey: KEY,
      admin: true,
      email: "attacker@example.com",
    });
    expect(parsed).toEqual({ reference: "PS-1A2B3C4D5E", accessKey: KEY });
  });
});
