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

  it("searches names and descriptions, case-insensitively", async () => {
    const egusi = await getPublishedProducts({ search: "egusi" });
    expect(egusi.ok && egusi.data.items.map((product) => product.slug)).toEqual(["egusi-soup"]);

    const soups = await getPublishedProducts({ search: "SOUP" });
    expect(soups.ok).toBe(true);
    if (soups.ok) expect(soups.data.total).toBe(3); // egusi, bitterleaf, vegetable

    // Regex metacharacters are harmless input.
    const weird = await getPublishedProducts({ search: "([" });
    expect(weird.ok).toBe(true);
    if (weird.ok) expect(weird.data.total).toBe(0);
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

  it("escapes search input into literal case-insensitive patterns", async () => {
    stubDatabaseEnv();
    stubDatabase();
    vi.mocked(ProductModel.find).mockReturnValue(queryOf([]) as never);
    vi.mocked(ProductModel.countDocuments).mockResolvedValue(0 as never);

    await getPublishedProducts({ search: "a.*b(c" });

    const filter = vi.mocked(ProductModel.find).mock.calls[0][0] as unknown as {
      $or?: Array<Record<string, RegExp>>;
    };
    expect(filter.$or).toHaveLength(3);
    for (const clause of filter.$or ?? []) {
      const [pattern] = Object.values(clause);
      expect(pattern).toBeInstanceOf(RegExp);
      expect(pattern.flags).toBe("i");
      expect(pattern.source).toBe("a\\.\\*b\\(c"); // fully escaped literal
    }
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
