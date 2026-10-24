import { describe, expect, it } from "vitest";
import { buildQuote, type ProductLookup } from "./quote";
import type { CartQuoteRequest } from "@/lib/validations/cart";

/* ── helpers ────────────────────────────────────────────────────────── */

function product(overrides: Partial<ProductLookup extends Map<string, infer V> ? V : never> & {
  slug: string;
}) {
  return {
    name: `Name of ${overrides.slug}`,
    categorySlug: "traditional-foods",
    availability: "available" as const,
    priceCents: 1200 as number | null,
    variants: [] as Array<{ name: string; priceCents: number | null }>,
    image: null as { secureUrl: string; alt: string } | null,
    ...overrides,
  };
}

function lookup(...products: ReturnType<typeof product>[]): ProductLookup {
  return new Map(products.map((item) => [item.slug, item]));
}

type RequestLine = Omit<CartQuoteRequest["items"][number], "variantName"> & {
  variantName?: string | null;
};

function request(...items: RequestLine[]): CartQuoteRequest {
  return {
    items: items.map((item) => ({ variantName: null, ...item })),
  };
}

/* ── happy path ─────────────────────────────────────────────────────── */

describe("buildQuote: purchasable lines", () => {
  it("prices a simple product and multiplies by quantity", () => {
    const quote = buildQuote(request({ slug: "meat-pie", quantity: 3 }), lookup(product({ slug: "meat-pie", priceCents: 450 })));

    expect(quote.lines).toHaveLength(1);
    expect(quote.lines[0]).toMatchObject({
      slug: "meat-pie",
      unitPriceCents: 450,
      lineTotalCents: 1350,
      name: "Name of meat-pie",
      issue: null,
    });
    expect(quote.subtotalCents).toBe(1350);
    expect(quote.purchasableQuantity).toBe(3);
    expect(quote.purchasableLineCount).toBe(1);
    expect(quote.hasIssues).toBe(false);
  });

  it("sums every purchasable line into the subtotal", () => {
    const quote = buildQuote(
      request({ slug: "a", quantity: 1 }, { slug: "b", quantity: 2 }),
      lookup(product({ slug: "a", priceCents: 1000 }), product({ slug: "b", priceCents: 250 })),
    );

    expect(quote.subtotalCents).toBe(1000 + 500);
    expect(quote.purchasableLineCount).toBe(2);
  });

  it("prices the exact variant that was selected", () => {
    const quote = buildQuote(
      request({ slug: "pack", variantName: "Large", quantity: 1 }),
      lookup(
        product({
          slug: "pack",
          priceCents: null,
          variants: [
            { name: "Small", priceCents: 800 },
            { name: "Large", priceCents: 1400 },
          ],
        }),
      ),
    );

    expect(quote.lines[0].unitPriceCents).toBe(1400);
    expect(quote.lines[0].variantName).toBe("Large");
  });

  it("passes through the catalogue image when one is deliverable", () => {
    const quote = buildQuote(
      request({ slug: "a", quantity: 1 }),
      lookup(product({ slug: "a", image: { secureUrl: "https://res.cloudinary.com/x/image/upload/a.jpg", alt: "A" } })),
    );

    expect(quote.lines[0].image).toEqual({ secureUrl: "https://res.cloudinary.com/x/image/upload/a.jpg", alt: "A" });
  });
});

/* ── reconciliation rules ───────────────────────────────────────────── */

describe("buildQuote: unavailable and unpriced lines", () => {
  it("masks every unknown product behind one neutral not_found line", () => {
    const quote = buildQuote(request({ slug: "ghost", quantity: 1 }), lookup());

    expect(quote.lines[0]).toEqual({
      slug: "ghost",
      variantName: null,
      quantity: 1,
      unitPriceCents: null,
      lineTotalCents: null,
      name: null,
      categorySlug: null,
      image: null,
      issue: "not_found",
    });
    expect(quote.subtotalCents).toBe(0);
    expect(quote.hasIssues).toBe(true);
  });

  it("never leaks a name for a product that cannot be shown", () => {
    const quote = buildQuote(request({ slug: "ghost", quantity: 1 }), lookup());
    expect(quote.lines[0].name).toBeNull();
    expect(quote.lines[0].image).toBeNull();
  });

  it("reports an unavailable product by name but without a price", () => {
    const quote = buildQuote(
      request({ slug: "sold-out", quantity: 2 }),
      lookup(product({ slug: "sold-out", availability: "sold_out" })),
    );

    expect(quote.lines[0]).toMatchObject({
      issue: "unavailable",
      name: "Name of sold-out",
      unitPriceCents: null,
      lineTotalCents: null,
    });
    expect(quote.subtotalCents).toBe(0);
    expect(quote.purchasableQuantity).toBe(0);
    expect(quote.purchasableLineCount).toBe(0);
  });

  it("never treats a missing price as zero", () => {
    const quote = buildQuote(
      request({ slug: "unpriced", quantity: 1 }),
      lookup(product({ slug: "unpriced", priceCents: null })),
    );

    expect(quote.lines[0].issue).toBe("unpriced");
    expect(quote.lines[0].unitPriceCents).toBeNull();
    expect(quote.subtotalCents).toBe(0);
  });

  it("rejects a zero or negative catalogue price instead of selling for free", () => {
    const zero = buildQuote(request({ slug: "a", quantity: 1 }), lookup(product({ slug: "a", priceCents: 0 })));
    const negative = buildQuote(request({ slug: "a", quantity: 1 }), lookup(product({ slug: "a", priceCents: -100 })));

    expect(zero.lines[0].issue).toBe("unpriced");
    expect(negative.lines[0].issue).toBe("unpriced");
    expect(zero.subtotalCents + negative.subtotalCents).toBe(0);
  });

  it("rejects a non-integer catalogue price", () => {
    const quote = buildQuote(request({ slug: "a", quantity: 1 }), lookup(product({ slug: "a", priceCents: 12.5 })));
    expect(quote.lines[0].issue).toBe("unpriced");
  });
});

describe("buildQuote: variant rules", () => {
  const variants = product({
    slug: "pack",
    priceCents: null,
    variants: [
      { name: "Small", priceCents: 800 },
      { name: "Large", priceCents: null },
    ],
  });

  it("requires an explicit selection when a product has options", () => {
    const quote = buildQuote(request({ slug: "pack", quantity: 1 }), lookup(variants));

    expect(quote.lines[0].issue).toBe("variant_required");
    expect(quote.subtotalCents).toBe(0);
  });

  it("does not silently substitute the base price for a variant", () => {
    // Even though a base price exists, the variant governs.
    const quote = buildQuote(
      request({ slug: "pack", quantity: 1 }),
      lookup({ ...variants, priceCents: 999 }),
    );

    expect(quote.lines[0].issue).toBe("variant_required");
  });

  it("reports a renamed or deleted variant", () => {
    const quote = buildQuote(
      request({ slug: "pack", variantName: "Family", quantity: 1 }),
      lookup(variants),
    );

    expect(quote.lines[0].issue).toBe("variant_not_found");
    expect(quote.lines[0].name).toBe("Name of pack");
  });

  it("refuses to price a duplicate variant name by accident", () => {
    const ambiguous = product({
      slug: "pack",
      priceCents: null,
      variants: [
        { name: "Small", priceCents: 800 },
        { name: "Small", priceCents: 900 },
      ],
    });

    const quote = buildQuote(request({ slug: "pack", variantName: "Small", quantity: 1 }), lookup(ambiguous));
    expect(quote.lines[0].issue).toBe("variant_ambiguous");
  });

  it("treats an unpriced variant as unpriced", () => {
    const quote = buildQuote(
      request({ slug: "pack", variantName: "Large", quantity: 1 }),
      lookup(variants),
    );

    expect(quote.lines[0].issue).toBe("variant_unpriced");
    expect(quote.subtotalCents).toBe(0);
  });

  it("requires a selection even for a product with exactly one option", () => {
    const single = product({
      slug: "only",
      priceCents: null,
      variants: [{ name: "Regular", priceCents: 700 }],
    });

    const missing = buildQuote(request({ slug: "only", quantity: 1 }), lookup(single));
    const chosen = buildQuote(request({ slug: "only", variantName: "Regular", quantity: 1 }), lookup(single));

    expect(missing.lines[0].issue).toBe("variant_required");
    expect(chosen.lines[0].unitPriceCents).toBe(700);
  });
});

/* ── arithmetic integrity ───────────────────────────────────────────── */

describe("buildQuote: totals", () => {
  it("excludes broken lines from the subtotal and unit count", () => {
    const quote = buildQuote(
      request({ slug: "good", quantity: 2 }, { slug: "ghost", quantity: 5 }, { slug: "off", quantity: 3 }),
      lookup(
        product({ slug: "good", priceCents: 1000 }),
        product({ slug: "off", availability: "sold_out" }),
      ),
    );

    expect(quote.subtotalCents).toBe(2000);
    expect(quote.purchasableQuantity).toBe(2);
    expect(quote.purchasableLineCount).toBe(1);
    expect(quote.hasIssues).toBe(true);
  });

  it("flags issues without ever producing a negative or fractional total", () => {
    const quote = buildQuote(
      request({ slug: "ghost", quantity: 4 }),
      lookup(),
    );

    expect(quote.subtotalCents).toBe(0);
    expect(Number.isInteger(quote.subtotalCents)).toBe(true);
    expect(quote.subtotalCents).toBeGreaterThanOrEqual(0);
  });

  it("keeps order: quoted lines match the request order", () => {
    const quote = buildQuote(
      request({ slug: "c", quantity: 1 }, { slug: "a", quantity: 1 }, { slug: "b", quantity: 1 }),
      lookup(
        product({ slug: "a", priceCents: 100 }),
        product({ slug: "b", priceCents: 100 }),
        product({ slug: "c", priceCents: 100 }),
      ),
    );

    expect(quote.lines.map((line) => line.slug)).toEqual(["c", "a", "b"]);
  });

  it("stays exact for a large, high-value cart", () => {
    const quote = buildQuote(
      request({ slug: "a", quantity: 25 }, { slug: "b", quantity: 25 }, { slug: "c", quantity: 25 }),
      lookup(
        product({ slug: "a", priceCents: 99_999 }),
        product({ slug: "b", priceCents: 99_999 }),
        product({ slug: "c", priceCents: 99_999 }),
      ),
    );

    expect(quote.subtotalCents).toBe(99_999 * 75);
    expect(quote.subtotalCents).toBe(7_499_925);
  });
});
