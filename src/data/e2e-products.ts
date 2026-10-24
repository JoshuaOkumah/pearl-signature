import type { Product, ProductStatus } from "@/types";

/**
 * E2E-only purchasable fixtures (Phase 4).
 *
 * The public preview fixtures deliberately carry `priceCents: null` because
 * the business has not confirmed any prices — nothing invented may appear in
 * `next dev` or in production. But the shopping-cart browser tests need at
 * least one product that IS orderable, or there is nothing to add.
 *
 * So these synthetic records exist, and are included by `src/data/products.ts`
 * ONLY when `E2E_PURCHASABLE_FIXTURES=1` is present in the environment. That
 * flag is set by `scripts/e2e-cart-server.ts`, which serves a disposable
 * Playwright project on port 3002. It is never set by `next dev`, by
 * `next build`, by production, or by either of the other e2e projects.
 *
 * Every name is prefixed `E2E` so they are unmistakable if they ever appear
 * where they should not.
 */

const PUBLISHED: ProductStatus = "published";

function e2eProduct(input: Partial<Product> & Pick<Product, "slug" | "name" | "category" | "description">): Product {
  return {
    categoryName: input.category,
    shortDescription: null,
    status: PUBLISHED,
    availability: "available",
    currency: "CAD",
    priceCents: null,
    variants: [],
    images: [],
    tags: [],
    featured: false,
    sortOrder: 9_000,
    theme: { deep: "#6E5320", base: "#C9A24B", accent: "#5C7A58" },
    ...input,
  };
}

/** Empty outside the disposable cart server — this is the whole gate. */
export const e2ePurchasableProducts: Product[] =
  process.env.E2E_PURCHASABLE_FIXTURES === "1"
    ? [
        e2eProduct({
          slug: "e2e-sample-meal",
          name: "E2E Sample Meal",
          category: "traditional-foods",
          description:
            "Synthetic catalogue record used by the automated cart tests. It exists only on the disposable test server.",
          priceCents: 1_250, // $12.50
          sortOrder: 9_010,
        }),
        e2eProduct({
          slug: "e2e-portion-pack",
          name: "E2E Portion Pack",
          category: "traditional-foods",
          description:
            "Synthetic record with two priced options, used to verify that different options stay separate cart lines.",
          priceCents: null,
          variants: [
            { name: "Small", priceCents: 800 },
            { name: "Large", priceCents: 1_400 },
          ],
          sortOrder: 9_020,
        }),
        e2eProduct({
          slug: "e2e-sold-out-item",
          name: "E2E Sold Out Item",
          category: "pastries-snacks",
          description:
            "Synthetic record that is priced but marked unavailable, used to verify disabled purchase controls.",
          priceCents: 500,
          availability: "unavailable",
          sortOrder: 9_030,
        }),
        e2eProduct({
          slug: "e2e-unpriced-item",
          name: "E2E Unpriced Item",
          category: "drinks",
          description:
            "Synthetic record with no confirmed price, used to verify that an unpriced product is never orderable.",
          priceCents: null,
          sortOrder: 9_040,
        }),
      ]
    : [];
