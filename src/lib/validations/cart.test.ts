import { describe, expect, it } from "vitest";
import { cartItemRequestSchema, cartQuoteRequestSchema } from "./cart";
import { MAX_CART_LINES, MAX_CART_QUANTITY, MAX_LINE_QUANTITY } from "@/lib/cart/limits";

/* ── line schema ────────────────────────────────────────────────────── */

describe("cartItemRequestSchema", () => {
  it("accepts a minimal well-formed line", () => {
    const parsed = cartItemRequestSchema.safeParse({ slug: "egusi-soup", quantity: 1, variantName: null });
    expect(parsed.success).toBe(true);
  });

  it("normalises an empty or whitespace variant to no variant", () => {
    const empty = cartItemRequestSchema.parse({ slug: "a", quantity: 1, variantName: "" });
    const blanks = cartItemRequestSchema.parse({ slug: "a", quantity: 1, variantName: "   " });

    expect(empty.variantName).toBeNull();
    expect(blanks.variantName).toBeNull();
  });

  it("trims a real variant name", () => {
    const parsed = cartItemRequestSchema.parse({ slug: "a", quantity: 1, variantName: "  Large  " });
    expect(parsed.variantName).toBe("Large");
  });

  it("rejects a slug that is not a public product address", () => {
    for (const slug of ["Egusi Soup", "egusi soup", "../admin", "", "a".repeat(200), "eggusi!", "drop;table"]) {
      const parsed = cartItemRequestSchema.safeParse({ slug, quantity: 1, variantName: null });
      expect(parsed.success, `expected "${slug}" to be rejected`).toBe(false);
    }
  });

  it("rejects quantities outside the per-line bounds", () => {
    for (const quantity of [0, -1, MAX_LINE_QUANTITY + 1, 1_000_000]) {
      expect(cartItemRequestSchema.safeParse({ slug: "a", quantity, variantName: null }).success).toBe(false);
    }
  });

  it("rejects fractional quantities", () => {
    expect(cartItemRequestSchema.safeParse({ slug: "a", quantity: 1.5, variantName: null }).success).toBe(false);
  });

  it("coerces a numeric string quantity but not a word", () => {
    const numeric = cartItemRequestSchema.safeParse({ slug: "a", quantity: "4", variantName: null });
    expect(numeric.success).toBe(true);

    expect(cartItemRequestSchema.safeParse({ slug: "a", quantity: "four", variantName: null }).success).toBe(false);
  });

  it("rejects an over-long variant name", () => {
    const parsed = cartItemRequestSchema.safeParse({ slug: "a", quantity: 1, variantName: "x".repeat(81) });
    expect(parsed.success).toBe(false);
  });

  it("drops any price, name or availability the client tried to assert", () => {
    const parsed = cartItemRequestSchema.parse({
      slug: "a",
      quantity: 1,
      variantName: null,
      unitPriceCents: 0,
      name: "Free please",
      available: true,
      status: "published",
      lineTotalCents: 0,
    });

    // The output carries only the three trusted fields.
    expect(Object.keys(parsed).sort()).toEqual(["quantity", "slug", "variantName"]);
  });
});

/* ── quote request schema ───────────────────────────────────────────── */

describe("cartQuoteRequestSchema", () => {
  const line = (slug: string, quantity = 1) => ({ slug, quantity, variantName: null });

  it("accepts a single line", () => {
    expect(cartQuoteRequestSchema.safeParse({ items: [line("egusi-soup")] }).success).toBe(true);
  });

  it("rejects an empty cart", () => {
    const parsed = cartQuoteRequestSchema.safeParse({ items: [] });
    expect(parsed.success).toBe(false);
  });

  it("rejects more distinct lines than the limit allows", () => {
    const items = Array.from({ length: MAX_CART_LINES + 1 }, (_, index) => line(`dish-${index}`));
    expect(cartQuoteRequestSchema.safeParse({ items }).success).toBe(false);
  });

  it("rejects a cart whose units exceed the whole-cart limit", () => {
    const items = Array.from({ length: 10 }, (_, index) => line(`dish-${index}`, MAX_LINE_QUANTITY));
    expect(cartQuoteRequestSchema.safeParse({ items }).success).toBe(false);
  });

  it("accepts a cart sitting exactly on both limits", () => {
    const items = Array.from({ length: MAX_CART_LINES }, (_, index) => ({
      slug: `dish-${index}`,
      quantity: Math.floor(MAX_CART_QUANTITY / MAX_CART_LINES),
      variantName: null,
    }));
    expect(cartQuoteRequestSchema.safeParse({ items }).success).toBe(true);
  });

  it("rejects duplicate line identities", () => {
    const parsed = cartQuoteRequestSchema.safeParse({ items: [line("a"), line("a")] });
    expect(parsed.success).toBe(false);
  });

  it("treats the same slug with different variants as distinct lines", () => {
    const parsed = cartQuoteRequestSchema.safeParse({
      items: [
        { slug: "pack", quantity: 1, variantName: "Small" },
        { slug: "pack", quantity: 1, variantName: "Large" },
      ],
    });
    expect(parsed.success).toBe(true);
  });

  it("rejects one poisoned line among many good ones", () => {
    const parsed = cartQuoteRequestSchema.safeParse({ items: [line("a"), { slug: "not a slug", quantity: 1, variantName: null }] });
    expect(parsed.success).toBe(false);
  });

  it("never accepts a client-supplied price as part of the contract", () => {
    const parsed = cartQuoteRequestSchema.parse({
      items: [{ slug: "a", quantity: 1, variantName: null, unitPriceCents: 1 }],
    });
    expect(parsed.items[0]).not.toHaveProperty("unitPriceCents");
  });
});
