import { afterEach, describe, expect, it, vi } from "vitest";
import { CategoryModel } from "@/models/category";
import { ProductModel, type ProductRecord } from "@/models/product";
import { connectDatabase, logDatabaseError } from "@/lib/db/mongoose";
import { products as fixtureProducts } from "@/data/products";
import {
  countPublishedProducts,
  escapeRegExp,
  getActiveCategories,
  getCategoryCounts,
  getFeaturedProducts,
  getHomepageShowcase,
  getPublishedProductBySlug,
  getPublishedProducts,
  getRelatedProducts,
  resolveCatalogueSource,
} from "./catalogue";

vi.mock("@/lib/db/mongoose", () => ({
  connectDatabase: vi.fn(),
  logDatabaseError: vi.fn(),
  isDatabaseConfigured: vi.fn(() => true),
  DatabaseUnavailableError: class DatabaseUnavailableError extends Error {},
}));

vi.mock("@/models/category", () => ({
  CategoryModel: { find: vi.fn() },
}));

vi.mock("@/models/product", () => ({
  ProductModel: { find: vi.fn(), findOne: vi.fn(), countDocuments: vi.fn(), aggregate: vi.fn() },
}));

/** Chainable Query stand-in: .sort().skip().limit().lean(). */
function queryOf<T>(value: T): unknown {
  const query: Record<string, unknown> = {};
  query.sort = () => query;
  query.skip = () => query;
  query.limit = () => query;
  query.lean = () => Promise.resolve(value);
  return query;
}

const ACTIVE_CATEGORIES = [
  { _id: "cat-trad", slug: "traditional-foods", name: "Traditional Foods", description: "", sortOrder: 0, isActive: true },
  { _id: "cat-past", slug: "pastries-snacks", name: "Pastries & Snacks", description: "", sortOrder: 10, isActive: true },
  { _id: "cat-drink", slug: "drinks", name: "Drinks", description: "", sortOrder: 20, isActive: true },
];

function dbRecord(overrides: Partial<ProductRecord> = {}): ProductRecord {
  return {
    _id: "prod-1" as unknown as ProductRecord["_id"],
    name: "Egusi Soup",
    slug: "egusi-soup",
    shortDescription: null,
    description: "Ground melon seeds cooked into a rich soup.",
    categoryId: "cat-trad" as unknown as ProductRecord["categoryId"],
    images: [],
    currency: "CAD",
    priceCents: null,
    variants: [],
    status: "published",
    availability: "available",
    stock: { tracked: false, quantity: null },
    featured: true,
    tags: [],
    sortOrder: 10,
    ...overrides,
  } as ProductRecord;
}

function stubDatabase(categories = ACTIVE_CATEGORIES) {
  vi.mocked(CategoryModel.find).mockReturnValue(queryOf(categories) as never);
}

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
});

/* ── source resolution ──────────────────────────────────────────────── */

describe("resolveCatalogueSource", () => {
  it("uses the database when MONGODB_URI is configured", () => {
    vi.stubEnv("MONGODB_URI", "mongodb+srv://user:pass@cluster.mongodb.net/db");
    expect(resolveCatalogueSource()).toBe("database");
  });

  it("uses preview fixtures only in explicit dev/test configuration", () => {
    vi.stubEnv("CATALOGUE_SOURCE", "fixtures");
    expect(resolveCatalogueSource()).toBe("fixtures");
    // The default for local development (NODE_ENV=test in Vitest):
    vi.stubEnv("CATALOGUE_SOURCE", "");
    expect(resolveCatalogueSource()).toBe("fixtures");
  });

  it("is unavailable in production without configuration (no silent fixtures)", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("CATALOGUE_SOURCE", "");
    expect(resolveCatalogueSource()).toBe("unavailable");
  });

  it("treats an explicit database request without a connection string as unavailable", () => {
    vi.stubEnv("CATALOGUE_SOURCE", "database");
    expect(resolveCatalogueSource()).toBe("unavailable");
  });
});

/* ── escapeRegExp (query safety) ────────────────────────────────────── */

describe("escapeRegExp", () => {
  it("neutralises regex metacharacters so user input is a literal", () => {
    expect(escapeRegExp("a.*b")).toBe("a\\.\\*b");
    expect(new RegExp(escapeRegExp("a.*b"), "i").test("a.*b")).toBe(true);
    expect(new RegExp(escapeRegExp("a.*b"), "i").test("axxb")).toBe(false);
    expect(escapeRegExp("(unclosed")).toBe("\\(unclosed");
    expect(escapeRegExp("[a-z]+")).toBe("\\[a-z\\]\\+");
  });
});

/* ── fixture-mode reads (development/test preview catalogue) ────────── */

describe("fixture-mode catalogue reads", () => {
  it("returns active categories as plain DTOs", async () => {
    const result = await getActiveCategories();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.source).toBe("fixtures");
    expect(result.data.map((category) => category.slug)).toEqual([
      "traditional-foods",
      "pastries-snacks",
      "drinks",
    ]);
    expect(result.data[0]).toEqual({
      slug: "traditional-foods",
      name: "Traditional Foods",
      description: expect.any(String),
      sortOrder: 0,
    });
  });

  it("publishes 11 of 12 fixtures — the draft record never appears", async () => {
    expect(fixtureProducts).toHaveLength(12);

    const result = await getPublishedProducts();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.total).toBe(11);
    expect(result.data.items).toHaveLength(11);
    expect(result.data.items.some((product) => product.slug === "preview-draft-item")).toBe(false);
    expect(result.data.items.every((product) => product.status === "published")).toBe(true);
    // No fabricated prices anywhere in the preview set.
    expect(result.data.items.every((product) => product.priceCents === null)).toBe(true);
  });

  it("filters by category", async () => {
    const result = await getPublishedProducts({ categorySlug: "drinks" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.total).toBe(2);
    expect(result.data.items.every((product) => product.category === "drinks")).toBe(true);
  });

  it("returns an honest empty result for an unknown-but-wellformed category", async () => {
    const result = await getPublishedProducts({ categorySlug: "desserts" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.total).toBe(0);
    expect(result.data.items).toEqual([]);
  });

  it("matches product names only, with title-first relevance (Phase 2B)", async () => {
    // Single character: only names BEGINNING with it. No product name
    // starts with "f", so the result is empty — even though Egusi Soup's
    // description contains "favourite". Descriptions are never searched.
    const f = await getPublishedProducts({ search: "f" });
    expect(f.ok && f.data.total).toBe(0);
    expect(f.ok && f.data.items).toEqual([]);

    // Two characters: name prefixes (tier 1).
    const eg = await getPublishedProducts({ search: "eg" });
    expect(eg.ok && eg.data.items.map((product) => product.slug)).toEqual([
      "egusi-soup",
      "egg-roll",
    ]);

    // Word prefixes rank below name prefixes; "pie" matches three pies in
    // deterministic catalogue order.
    const pie = await getPublishedProducts({ search: "pie" });
    expect(pie.ok && pie.data.items.map((product) => product.slug)).toEqual([
      "turkey-pie",
      "meat-pie",
      "chicken-pie",
    ]);
    expect(pie.ok && pie.data.total).toBe(3);

    // Three+ characters: every soup matches via word prefix.
    const soups = await getPublishedProducts({ search: "sou" });
    expect(soups.ok && soups.data.items.map((product) => product.slug)).toEqual([
      "egusi-soup",
      "bitterleaf-soup",
      "vegetable-soup",
    ]);
  });

  it("is case-insensitive, trims whitespace, and treats empty as no search", async () => {
    const upper = await getPublishedProducts({ search: "PIE" });
    expect(upper.ok && upper.data.items.map((product) => product.slug)).toEqual([
      "turkey-pie",
      "meat-pie",
      "chicken-pie",
    ]);

    const padded = await getPublishedProducts({ search: "  pie  " });
    expect(padded.ok && padded.data.items.map((product) => product.slug)).toEqual(
      upper.ok ? upper.data.items.map((product) => product.slug) : [],
    );

    for (const search of ["", "   "]) {
      const result = await getPublishedProducts({ search });
      expect(result.ok && result.data.total).toBe(11);
    }
  });

  it("ignores special characters instead of crashing (regex is escaped)", async () => {
    const weird = await getPublishedProducts({ search: "([" });
    expect(weird.ok).toBe(true);
    if (weird.ok) expect(weird.ok && weird.data.total).toBe(0);

    const glob = await getPublishedProducts({ search: ".*" });
    expect(glob.ok).toBe(true);
    if (glob.ok) expect(glob.data.total).toBe(0);
  });

  it("combines search with the category filter", async () => {
    const pies = await getPublishedProducts({ categorySlug: "pastries-snacks", search: "pie" });
    expect(pies.ok && pies.data.total).toBe(3);
    expect(pies.ok && pies.data.items.every((product) => product.category === "pastries-snacks")).toBe(true);

    // No drinks are called "pie": an honest empty result, not a fallback.
    const drinkPies = await getPublishedProducts({ categorySlug: "drinks", search: "pie" });
    expect(drinkPies.ok && drinkPies.data.total).toBe(0);
    expect(drinkPies.ok && drinkPies.data.items).toEqual([]);
  });

  it("paginates search results after ranking, with stable pages and no duplicates", async () => {
    const page1 = await getPublishedProducts({ search: "pie", page: 1, pageSize: 2 });
    expect(page1.ok && page1.data.items.map((product) => product.slug)).toEqual(["turkey-pie", "meat-pie"]);
    expect(page1.ok && page1.data.total).toBe(3);
    expect(page1.ok && page1.data.totalPages).toBe(2);

    const page2 = await getPublishedProducts({ search: "pie", page: 2, pageSize: 2 });
    expect(page2.ok && page2.data.items.map((product) => product.slug)).toEqual(["chicken-pie"]);

    const seen = new Set(
      [...(page1.ok ? page1.data.items : []), ...(page2.ok ? page2.data.items : [])].map(
        (product) => product.slug,
      ),
    );
    expect(seen.size).toBe(3); // no duplicates across pages

    // Determinism: the same request returns the identical slice.
    const again = await getPublishedProducts({ search: "pie", page: 1, pageSize: 2 });
    expect(again.ok && again.data.items.map((product) => product.slug)).toEqual([
      "turkey-pie",
      "meat-pie",
    ]);
  });

  it("paginates server-side with stable totals", async () => {
    const first = await getPublishedProducts({ page: 1, pageSize: 4 });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.data.items).toHaveLength(4);
    expect(first.data.total).toBe(11);
    expect(first.data.totalPages).toBe(3);

    const last = await getPublishedProducts({ page: 3, pageSize: 4 });
    expect(last.ok && last.data.items).toHaveLength(3);

    // Beyond the end: items empty (the UI shows a past-end state), not an error.
    const beyond = await getPublishedProducts({ page: 99, pageSize: 4 });
    expect(beyond.ok).toBe(true);
    if (beyond.ok) {
      expect(beyond.data.items).toEqual([]);
      expect(beyond.data.total).toBe(11);
    }
  });

  it("clamps hostile pagination values instead of crashing", async () => {
    const result = await getPublishedProducts({ page: Number.NaN, pageSize: -5 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.page).toBe(1);
    expect(result.data.pageSize).toBe(1); // clamped into [1, max]
  });

  it("reads featured products and totals for the homepage", async () => {
    const featured = await getFeaturedProducts();
    expect(featured.ok).toBe(true);
    if (featured.ok) expect(featured.data).toHaveLength(5);

    const showcase = await getHomepageShowcase();
    expect(showcase.ok).toBe(true);
    if (!showcase.ok) return;
    expect(showcase.data.total).toBe(11);
    expect(showcase.data.featured.every((product) => product.featured)).toBe(true);
    expect(showcase.data.featured.some((product) => product.slug === "preview-draft-item")).toBe(false);
  });

  it("never returns the requested product when it is a draft", async () => {
    const published = await getPublishedProductBySlug("egusi-soup");
    expect(published.ok && published.data?.name).toBe("Egusi Soup");
    expect(published.ok && published.data?.categoryName).toBe("Traditional Foods");

    const draft = await getPublishedProductBySlug("preview-draft-item");
    expect(draft.ok).toBe(true);
    if (draft.ok) expect(draft.data).toBeNull();

    const missing = await getPublishedProductBySlug("does-not-exist");
    expect(missing.ok).toBe(true);
    if (missing.ok) expect(missing.data).toBeNull();
  });

  it("counts published products per category (draft excluded)", async () => {
    const counts = await getCategoryCounts();
    expect(counts.ok).toBe(true);
    if (!counts.ok) return;
    expect(counts.data).toEqual({ "traditional-foods": 4, "pastries-snacks": 5, drinks: 2 });

    const total = await countPublishedProducts();
    expect(total.ok && total.data).toBe(11);
  });

  it("excludes the current product from related items", async () => {
    const related = await getRelatedProducts({
      categorySlug: "traditional-foods",
      excludeSlug: "egusi-soup",
      limit: 4,
    });
    expect(related.ok).toBe(true);
    if (!related.ok) return;
    expect(related.data.map((product) => product.slug)).toEqual([
      "bitterleaf-soup",
      "vegetable-soup",
      "ukwa",
    ]);
    expect(related.data.some((product) => product.slug === "egusi-soup")).toBe(false);
  });
});

/* ── production behaviour without configuration ─────────────────────── */

describe("unavailable configuration", () => {
  it("returns a failed read instead of preview fixtures in production", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("CATALOGUE_SOURCE", "");

    const products = await getPublishedProducts();
    expect(products).toEqual({ ok: false, reason: "unavailable" });

    const categories = await getActiveCategories();
    expect(categories).toEqual({ ok: false, reason: "unavailable" });

    const product = await getPublishedProductBySlug("egusi-soup");
    expect(product).toEqual({ ok: false, reason: "unavailable" });
  });

  it("does not query the database when it is not configured", async () => {
    vi.stubEnv("CATALOGUE_SOURCE", "database");
    const result = await getPublishedProducts();
    expect(result).toEqual({ ok: false, reason: "unavailable" });
    expect(connectDatabase).not.toHaveBeenCalled();
  });
});

/* ── database mode (mocked models) ──────────────────────────────────── */

describe("database-mode reads (mocked models)", () => {
  function stubDatabaseEnv() {
    vi.stubEnv("MONGODB_URI", "mongodb+srv://user:pass@cluster.mongodb.net/pearl_signature");
    vi.stubEnv("CATALOGUE_SOURCE", "");
    vi.mocked(connectDatabase).mockResolvedValue({} as never);
  }

  it("queries only published products in active categories", async () => {
    stubDatabaseEnv();
    stubDatabase();
    vi.mocked(ProductModel.find).mockReturnValue(queryOf([dbRecord()]) as never);
    vi.mocked(ProductModel.countDocuments).mockResolvedValue(1 as never);

    const result = await getPublishedProducts();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.source).toBe("database");

    const filter = vi.mocked(ProductModel.find).mock.calls[0][0] as unknown as Record<string, unknown>;
    expect(filter.status).toBe("published");
    expect(filter.categoryId).toEqual({
      $in: ["cat-trad", "cat-past", "cat-drink"],
    });
    expect(result.data.items[0]).toMatchObject({
      slug: "egusi-soup",
      category: "traditional-foods",
      categoryName: "Traditional Foods",
      currency: "CAD",
      priceCents: null,
      status: "published",
    });
  });

  it("builds a name-only, escaped, length-aware candidate filter (Phase 2B)", async () => {
    stubDatabaseEnv();
    stubDatabase();
    vi.mocked(ProductModel.find).mockReturnValue(queryOf([]) as never);
    vi.mocked(ProductModel.countDocuments).mockResolvedValue(0 as never);

    await getPublishedProducts({ search: "a.*b(c" });

    const filter = vi.mocked(ProductModel.find).mock.calls[0][0] as unknown as Record<string, unknown>;
    // Descriptions, categories and tags are never searched.
    expect(filter.$or).toBeUndefined();
    expect(filter.description).toBeUndefined();
    expect(filter.shortDescription).toBeUndefined();
    const pattern = filter.name as RegExp;
    expect(pattern).toBeInstanceOf(RegExp);
    expect(pattern.flags).toBe("i");
    expect(pattern.source).toBe("a\\.\\*b\\(c"); // fully escaped literal substring (6 chars)
  });

  it("anchors single-character searches to the start of the name", async () => {
    stubDatabaseEnv();
    stubDatabase();
    vi.mocked(ProductModel.find).mockReturnValue(queryOf([]) as never);
    vi.mocked(ProductModel.countDocuments).mockResolvedValue(0 as never);

    await getPublishedProducts({ search: "f" });

    const filter = vi.mocked(ProductModel.find).mock.calls[0][0] as unknown as {
      name?: RegExp;
      $or?: unknown[];
    };
    expect(filter.$or).toBeUndefined();
    expect(filter.name?.source).toBe("^f"); // prefix only: "favourite" in a description can never match
  });

  it("keeps the search constraint in the same filter as status and category", async () => {
    stubDatabaseEnv();
    stubDatabase();
    vi.mocked(ProductModel.find).mockReturnValue(queryOf([]) as never);
    vi.mocked(ProductModel.countDocuments).mockResolvedValue(0 as never);

    await getPublishedProducts({ categorySlug: "pastries-snacks", search: "pie" });

    const filter = vi.mocked(ProductModel.find).mock.calls[0][0] as unknown as Record<string, unknown>;
    expect(filter.status).toBe("published");
    expect(filter.categoryId).toEqual({ $in: ["cat-past"] });
    expect((filter.name as RegExp).test("Meat Pie")).toBe(true);
  });

  it("ranks fetched candidates by relevance before slicing the page", async () => {
    stubDatabaseEnv();
    stubDatabase();
    // The database hands over every candidate; the tier order decides,
    // independent of catalogue sortOrder.
    vi.mocked(ProductModel.find).mockReturnValue(
      queryOf([
        dbRecord({ name: "Chicken Pie", slug: "chicken-pie", sortOrder: 10 }),
        dbRecord({ name: "Plantain Chips", slug: "plantain-chips", sortOrder: 90 }),
        dbRecord({ name: "Meat Pie", slug: "meat-pie", sortOrder: 50 }),
      ]) as never,
    );
    vi.mocked(ProductModel.countDocuments).mockResolvedValue(3 as never);

    const result = await getPublishedProducts({ search: "p", page: 1, pageSize: 2 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // "Plantain Chips" begins with "p" (tier 1) and outranks the tier-2
    // pies even though its sortOrder is the highest.
    expect(result.data.items.map((product) => product.slug)).toEqual([
      "plantain-chips",
      "chicken-pie",
    ]);
    expect(result.data.total).toBe(3);
    expect(result.data.totalPages).toBe(2);
  });

  it("drops draft records even if a query ever hands them over", async () => {
    stubDatabaseEnv();
    stubDatabase();
    vi.mocked(ProductModel.find).mockReturnValue(
      queryOf([dbRecord({ status: "draft" as const })]) as never,
    );
    vi.mocked(ProductModel.countDocuments).mockResolvedValue(1 as never);

    const result = await getPublishedProducts();
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.items).toEqual([]);
  });

  it("drops records that fail validation or reference a missing category", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    stubDatabaseEnv();
    stubDatabase();
    vi.mocked(ProductModel.find).mockReturnValue(
      queryOf([
        dbRecord(), // valid
        dbRecord({ name: "" } as Partial<ProductRecord>), // invalid: empty name
        dbRecord({ categoryId: "cat-unknown" as never }), // dangling category
      ]) as never,
    );
    vi.mocked(ProductModel.countDocuments).mockResolvedValue(3 as never);

    const result = await getPublishedProducts();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.items.map((product) => product.slug)).toEqual(["egusi-soup"]);
    // The invalid record is skipped WITH a server-side diagnostic.
    const logged = String(consoleSpy.mock.calls[0]?.[0] ?? "");
    expect(logged).toContain("product:egusi-soup");
    expect(logged).toContain("name");
    consoleSpy.mockRestore();
  });

  it("warns and drops only an invalid image while keeping its product", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    stubDatabaseEnv();
    vi.stubEnv("CLOUDINARY_CLOUD_NAME", "pearl-signature");
    stubDatabase();
    vi.mocked(ProductModel.find).mockReturnValue(
      queryOf([
        dbRecord({
          images: [
            {
              secureUrl: "https://res.cloudinary.com/old-cloud/image/upload/egusi.jpg",
              alt: "Egusi Soup",
              sortOrder: 0,
            },
          ] as ProductRecord["images"],
        }),
      ]) as never,
    );
    vi.mocked(ProductModel.countDocuments).mockResolvedValue(1 as never);

    const result = await getPublishedProducts();
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.items).toHaveLength(1);
      expect(result.data.items[0]?.images).toEqual([]);
    }
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("image:egusi-soup"));
    expect(errorSpy).not.toHaveBeenCalled();
    warnSpy.mockRestore();
    errorSpy.mockRestore();
  });

  it("skips querying entirely for an unknown category", async () => {
    stubDatabaseEnv();
    stubDatabase();

    const result = await getPublishedProducts({ categorySlug: "desserts" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data).toMatchObject({ total: 0, items: [] });
    expect(ProductModel.find).not.toHaveBeenCalled();
  });

  it("returns a failed read when the connection cannot be established", async () => {
    stubDatabaseEnv();
    vi.mocked(connectDatabase).mockRejectedValueOnce(new Error("getaddrinfo ENOTFOUND cluster.mongodb.net"));

    const result = await getPublishedProducts();
    expect(result).toEqual({ ok: false, reason: "unavailable" });
    expect(logDatabaseError).toHaveBeenCalledWith("getPublishedProducts", expect.any(Error));
  });

  it("returns a failed read when a query throws", async () => {
    stubDatabaseEnv();
    stubDatabase();
    vi.mocked(ProductModel.find).mockImplementation(() => {
      throw new Error("buffering timed out");
    });

    const result = await getPublishedProducts();
    expect(result).toEqual({ ok: false, reason: "unavailable" });
    expect(logDatabaseError).toHaveBeenCalled();
  });

  it("resolves a published slug, and returns null for unknown slugs", async () => {
    stubDatabaseEnv();
    stubDatabase();
    vi.mocked(ProductModel.findOne).mockReturnValue(queryOf(dbRecord()) as never);
    const found = await getPublishedProductBySlug("egusi-soup");
    expect(found.ok && found.data?.slug).toBe("egusi-soup");

    vi.mocked(ProductModel.findOne).mockReturnValue(queryOf(null) as never);
    const missing = await getPublishedProductBySlug("missing");
    expect(missing.ok && missing.data).toBeNull();
  });
});
