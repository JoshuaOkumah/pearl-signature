import { describe, expect, it } from "vitest";
import {
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
  MAX_SEARCH_LENGTH,
  categoryDTOSchema,
  parseMenuSearchParams,
  productDTOSchema,
  productImageSchema,
  slugSchema,
} from "./catalogue";

describe("slugSchema", () => {
  it("accepts normalised URL slugs", () => {
    expect(slugSchema.parse("traditional-foods")).toBe("traditional-foods");
    expect(slugSchema.parse("egusi-soup")).toBe("egusi-soup");
    expect(slugSchema.parse(" a2-b3 ")).toBe("a2-b3"); // trimmed
  });

  it("rejects malformed slugs", () => {
    for (const bad of ["Traditional Foods", "egusi soup", "-leading", "trailing-", "a--b", "emoji-🍲", ""]) {
      expect(slugSchema.safeParse(bad).success, bad).toBe(false);
    }
    expect(slugSchema.safeParse("x".repeat(81)).success).toBe(false);
  });
});

describe("parseMenuSearchParams", () => {
  it("applies defaults for an empty query", () => {
    expect(parseMenuSearchParams({})).toEqual({
      category: undefined,
      search: undefined,
      page: 1,
      pageSize: DEFAULT_PAGE_SIZE,
    });
  });

  it("keeps valid values", () => {
    expect(
      parseMenuSearchParams({ category: "drinks", search: "egusi", page: "3", pageSize: "6" }),
    ).toEqual({ category: "drinks", search: "egusi", page: 3, pageSize: 6 });
  });

  it("takes the last value of repeated keys", () => {
    expect(parseMenuSearchParams({ category: ["drinks", "pastries-snacks"] }).category).toBe("pastries-snacks");
  });

  it("drops malformed categories instead of failing the page", () => {
    expect(parseMenuSearchParams({ category: "DROP TABLE" }).category).toBeUndefined();
    expect(parseMenuSearchParams({ category: "Not Valid!" }).category).toBeUndefined();
    expect(parseMenuSearchParams({ category: ["drinks", "not valid"] }).category).toBeUndefined();
  });

  it("falls back safely on out-of-range or junk pagination", () => {
    expect(parseMenuSearchParams({ page: "0" }).page).toBe(1);
    expect(parseMenuSearchParams({ page: "-4" }).page).toBe(1);
    expect(parseMenuSearchParams({ page: "abc" }).page).toBe(1);
    expect(parseMenuSearchParams({ page: "1.5" }).page).toBe(1);
    expect(parseMenuSearchParams({ page: "999999" }).page).toBe(1);
    expect(parseMenuSearchParams({ pageSize: "0" }).pageSize).toBe(DEFAULT_PAGE_SIZE);
    expect(parseMenuSearchParams({ pageSize: String(MAX_PAGE_SIZE + 1) }).pageSize).toBe(DEFAULT_PAGE_SIZE);
    expect(parseMenuSearchParams({ pageSize: "9999" }).pageSize).toBe(DEFAULT_PAGE_SIZE);
    expect(parseMenuSearchParams({ pageSize: {} as unknown as string }).pageSize).toBe(DEFAULT_PAGE_SIZE);
  });

  it("bounds search terms", () => {
    expect(parseMenuSearchParams({ search: "  egusi  " }).search).toBe("egusi");
    expect(parseMenuSearchParams({ search: "x".repeat(MAX_SEARCH_LENGTH + 50) }).search).toBeUndefined();
    expect(parseMenuSearchParams({ search: { evil: true } as unknown as string }).search).toBeUndefined();
  });
});

describe("productImageSchema", () => {
  const valid = {
    secureUrl: "https://res.cloudinary.com/demo/image/upload/v1/egusi.jpg",
    alt: "A bowl of egusi soup",
    sortOrder: 0,
  };

  it("accepts validated Cloudinary images", () => {
    expect(productImageSchema.safeParse(valid).success).toBe(true);
    expect(
      productImageSchema.safeParse({ ...valid, publicId: "products/egusi", width: 800, height: 600 }).success,
    ).toBe(true);
  });

  it("rejects missing alt text, non-Cloudinary hosts, and bad geometry", () => {
    expect(productImageSchema.safeParse({ ...valid, alt: "" }).success).toBe(false);
    expect(productImageSchema.safeParse({ ...valid, secureUrl: "https://evil.example.com/x.jpg" }).success).toBe(false);
    expect(productImageSchema.safeParse({ ...valid, secureUrl: "not-a-url" }).success).toBe(false);
    expect(productImageSchema.safeParse({ ...valid, sortOrder: -1 }).success).toBe(false);
    expect(productImageSchema.safeParse({ ...valid, width: 0 }).success).toBe(false);
  });
});

describe("productDTOSchema", () => {
  const base = {
    slug: "egusi-soup",
    name: "Egusi Soup",
    category: "traditional-foods",
    categoryName: "Traditional Foods",
    description: "Ground melon seeds cooked into a rich soup.",
    shortDescription: null,
    featured: true,
    theme: { deep: "#6E5320", base: "#C9A24B", accent: "#5C7A58" },
    status: "published",
    availability: "available",
    currency: "CAD",
    priceCents: null,
    variants: [],
    images: [],
    tags: [],
    sortOrder: 10,
  };

  it("accepts a published product without a price (price stays null)", () => {
    const parsed = productDTOSchema.safeParse(base);
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.priceCents).toBeNull();
  });

  it("accepts configured pricing only as positive integer cents", () => {
    expect(productDTOSchema.safeParse({ ...base, priceCents: 1800 }).success).toBe(true);
    expect(productDTOSchema.safeParse({ ...base, priceCents: 0 }).success).toBe(false); // no fake $0
    expect(productDTOSchema.safeParse({ ...base, priceCents: 18.5 }).success).toBe(false); // no floats
    expect(productDTOSchema.safeParse({ ...base, priceCents: -100 }).success).toBe(false);
  });

  it("enforces publication and availability vocabularies", () => {
    expect(productDTOSchema.safeParse({ ...base, status: "archived" }).success).toBe(true); // Phase 3 archive stays readable in the data layer
    expect(productDTOSchema.safeParse({ ...base, status: "draft" }).success).toBe(true); // data layer may hold drafts
    expect(productDTOSchema.safeParse({ ...base, status: "retired" }).success).toBe(false);
    expect(productDTOSchema.safeParse({ ...base, availability: "resting" }).success).toBe(false);
    expect(productDTOSchema.safeParse({ ...base, currency: "USD" }).success).toBe(false);
  });

  it("requires names, descriptions and CAD-compatible structure", () => {
    expect(productDTOSchema.safeParse({ ...base, name: "" }).success).toBe(false);
    expect(productDTOSchema.safeParse({ ...base, description: "" }).success).toBe(false);
    expect(productDTOSchema.safeParse({ ...base, category: "Not Valid" }).success).toBe(false);
    expect(productDTOSchema.safeParse({ ...base, theme: { deep: "", base: "", accent: "" } }).success).toBe(false);
  });

  it("validates variants with positive integer prices or null", () => {
    const withVariant = { ...base, variants: [{ name: "Family", priceCents: 2400 }] };
    expect(productDTOSchema.safeParse(withVariant).success).toBe(true);
    expect(productDTOSchema.safeParse({ ...base, variants: [{ name: "Family", priceCents: null }] }).success).toBe(true);
    expect(productDTOSchema.safeParse({ ...base, variants: [{ name: "Family", priceCents: 0 }] }).success).toBe(false);
    expect(productDTOSchema.safeParse({ ...base, variants: [{ name: "", priceCents: null }] }).success).toBe(false);
  });

  it("rejects an unbounded number of images", () => {
    const image = {
      secureUrl: "https://res.cloudinary.com/demo/image/upload/v1/x.jpg",
      alt: "x",
      sortOrder: 0,
    };
    const many = Array.from({ length: 11 }, (_, index) => ({ ...image, sortOrder: index }));
    expect(productDTOSchema.safeParse({ ...base, images: many }).success).toBe(false);
  });
});

describe("categoryDTOSchema", () => {
  it("accepts database categories and rejects empty names", () => {
    expect(
      categoryDTOSchema.safeParse({
        slug: "drinks",
        name: "Drinks",
        description: "Refreshing homemade drinks.",
        sortOrder: 20,
      }).success,
    ).toBe(true);
    expect(categoryDTOSchema.safeParse({ slug: "drinks", name: "", description: "", sortOrder: 0 }).success).toBe(false);
    expect(categoryDTOSchema.safeParse({ slug: "DRINKS", name: "Drinks", description: "", sortOrder: 0 }).success).toBe(
      false,
    );
  });
});
