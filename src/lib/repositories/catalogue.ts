import "server-only";
import type { QueryFilter, Types } from "mongoose";
import { categories as fixtureCategories } from "@/data/categories";
import { products as fixtureProducts } from "@/data/products";
import { connectDatabase, logDatabaseError } from "@/lib/db/mongoose";
import { placeholderThemeFor } from "@/lib/placeholder-themes";
import { CategoryModel } from "@/models/category";
import { ProductModel, type ProductRecord } from "@/models/product";
import {
  compareSearchRelevance,
  escapeRegExp,
  nameMatchTier,
  normalizeSearchTerm,
  searchCandidateRegex,
} from "@/lib/search";
import {
  DEFAULT_PAGE_SIZE,
  MAX_PAGE,
  MAX_PAGE_SIZE,
  categoryDTOSchema,
  productDTOSchema,
  productImageSchema,
} from "@/lib/validations/catalogue";
import type { CatalogueCategory, Product } from "@/types";

export { escapeRegExp };

/**
 * Catalogue data-access layer (Phase 2).
 *
 * Every public read funnels through this module. Guarantees:
 *
 * - Only `status: "published"` products in active categories ever leave here.
 * - Search is title-first (product names only, tiered relevance, see
 *   `src/lib/search.ts`): input is length-bounded and regex-escaped before
 *   touching a query, so no pathological patterns are possible. Descriptions,
 *   category names and tags are deliberately not searched.
 * - Pagination is server-side with defaults and hard upper bounds.
 * - Database documents are parsed with Zod; invalid records are dropped and
 *   logged instead of crashing a page.
 * - Failures return `{ ok: false }` for a customer-safe error state. A failed
 *   database call NEVER silently falls back to preview fixtures.
 * - Development/test preview fixtures are used only by explicit configuration
 *   (see resolveCatalogueSource) and are always labelled by the UI.
 */

/* ── shared result shapes ───────────────────────────────────────────── */

export type CatalogueSource = "database" | "fixtures" | "unavailable";

export type ReadResult<T> =
  | { ok: true; source: "database" | "fixtures"; data: T }
  | { ok: false; reason: "unavailable" };

export interface ProductQuery {
  categorySlug?: string;
  search?: string;
  featured?: boolean;
  /** Excludes one slug (used by related-products lists). */
  excludeSlug?: string;
  page?: number;
  pageSize?: number;
}

export interface PagedProducts {
  items: Product[];
  /** Total matching the current filters (not just this page). */
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

/* ── source resolution ──────────────────────────────────────────────── */

/**
 * Which data source this request should use:
 *
 * 1. `MONGODB_URI` present → the database (production behaviour).
 * 2. `CATALOGUE_SOURCE=fixtures` → preview fixtures (explicit dev/test mode).
 * 3. Non-production without a URI → preview fixtures (local convenience).
 * 4. Production without a URI → `unavailable` → honest customer error state.
 *
 * A configured database that fails does NOT fall back to fixtures.
 */
export function resolveCatalogueSource(): CatalogueSource {
  if (process.env.MONGODB_URI?.trim()) return "database";

  const explicit = process.env.CATALOGUE_SOURCE?.trim().toLowerCase();
  if (explicit === "fixtures") return "fixtures";
  if (explicit === "database") return "unavailable";
  if (process.env.NODE_ENV !== "production") return "fixtures";

  return "unavailable";
}

/* ── query helpers ──────────────────────────────────────────────────── */

/**
 * Search terms are folded by `normalizeSearchTerm` (trim, collapse
 * whitespace, case-fold, length-bound). Matching and ranking live in
 * `src/lib/search.ts` and are shared with the fixtures path so both
 * sources behave identically.
 */
function normalizeSearch(search?: string): string | null {
  return normalizeSearchTerm(search);
}

function clampPage(page?: number): number {
  if (!Number.isFinite(page)) return 1;
  return Math.min(Math.max(Math.floor(page as number), 1), MAX_PAGE);
}

function clampPageSize(pageSize?: number): number {
  if (!Number.isFinite(pageSize)) return DEFAULT_PAGE_SIZE;
  return Math.min(Math.max(Math.floor(pageSize as number), 1), MAX_PAGE_SIZE);
}

export function totalPagesFor(total: number, pageSize: number): number {
  return Math.max(1, Math.ceil(total / pageSize));
}

/* ── category index (active categories by id and slug) ──────────────── */

interface CategoryEntry {
  id: string;
  slug: string;
  name: string;
}

interface CategoryIndex {
  byId: Map<string, CategoryEntry>;
  bySlug: Map<string, CategoryEntry>;
}

function emptyIndex(): CategoryIndex {
  return { byId: new Map(), bySlug: new Map() };
}

function toCatalogueCategory(record: {
  slug?: string;
  name?: string;
  description?: string;
  sortOrder?: number;
}): CatalogueCategory | null {
  const parsed = categoryDTOSchema.safeParse({
    slug: record.slug,
    name: record.name,
    description: record.description ?? "",
    sortOrder: record.sortOrder ?? 0,
  });
  return parsed.success ? parsed.data : null;
}

function fixtureCategoryList(): CatalogueCategory[] {
  const list: CatalogueCategory[] = [];
  fixtureCategories.forEach((category, index) => {
    const parsed = toCatalogueCategory({
      slug: category.slug,
      name: category.name,
      description: category.description,
      sortOrder: index * 10,
    });
    if (parsed) list.push(parsed);
  });
  return list;
}

/* ── record → DTO mapping ───────────────────────────────────────────── */

function logSkipped(scope: string, detail: string): void {
  console.error(`[catalogue] ${scope}: ${detail}`);
}

function logSkippedImage(scope: string, detail: string): void {
  // An unusable image is an expected recoverable data condition: the product
  // remains visible with FoodMedia's placeholder, so do not trigger Next's
  // development error overlay for it.
  console.warn(`[catalogue] ${scope}: ${detail}`);
}

/** Loose image shape accepted from database records and fixtures alike. */
interface RawProductImage {
  secureUrl?: unknown;
  publicId?: unknown;
  alt?: unknown;
  sortOrder?: unknown;
  width?: unknown;
  height?: unknown;
}

/**
 * Validate image entries one at a time, dropping (and logging) the invalid
 * ones so a single bad image never hides an otherwise valid product. Shared
 * by the database and fixture paths so both sources behave identically.
 */
function validProductImages(slug: string, images: readonly RawProductImage[]): Product["images"] {
  const valid: Product["images"] = [];
  for (const image of images) {
    const parsed = productImageSchema.safeParse({
      secureUrl: image.secureUrl,
      publicId: image.publicId,
      alt: image.alt,
      sortOrder: image.sortOrder ?? 0,
      width: image.width,
      height: image.height,
    });
    if (parsed.success) {
      valid.push(parsed.data);
    } else {
      logSkippedImage(
        `image:${slug}`,
        parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; "),
      );
    }
  }
  return valid;
}

/**
 * Map a lean database record to the public DTO. Returns null when the record
 * fails validation or is not published (defence in depth on top of the query
 * filter). Invalid image entries are dropped individually so one bad image
 * never hides an otherwise valid product.
 */
function recordToProduct(record: ProductRecord, category: CategoryEntry): Product | null {
  if (record.status !== "published") return null;

  const images = validProductImages(record.slug, record.images ?? []);

  const parsed = productDTOSchema.safeParse({
    slug: record.slug,
    name: record.name,
    category: category.slug,
    categoryName: category.name,
    description: record.description,
    shortDescription: record.shortDescription ?? null,
    featured: Boolean(record.featured),
    theme: placeholderThemeFor(category.slug),
    status: record.status,
    availability: record.availability,
    currency: record.currency,
    priceCents: record.priceCents ?? null,
    variants: (record.variants ?? []).map((variant) => ({
      name: variant.name,
      priceCents: variant.priceCents ?? null,
    })),
    images,
    tags: record.tags ?? [],
    sortOrder: record.sortOrder ?? 0,
  });

  if (!parsed.success) {
    logSkipped(
      `product:${record.slug ?? String(record._id)}`,
      parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; "),
    );
    return null;
  }
  return parsed.data;
}

function fixtureToProduct(product: Product): Product | null {
  // Same image policy as the database path: one preview media slot with a
  // stale cloud reference must not hide the dish itself. Only invalid
  // images are dropped; the product is validated without them.
  const parsed = productDTOSchema.safeParse({
    ...product,
    images: validProductImages(product.slug, product.images),
  });
  if (!parsed.success) {
    logSkipped(
      `fixture:${product.slug}`,
      parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; "),
    );
    return null;
  }
  return parsed.data;
}

/* ── database internals ─────────────────────────────────────────────── */

async function loadActiveCategoryIndex(): Promise<CategoryIndex> {
  const records = await CategoryModel.find({ isActive: true })
    .sort({ sortOrder: 1 })
    .lean();

  const index = emptyIndex();
  for (const record of records) {
    const parsed = toCatalogueCategory(record);
    if (!parsed) {
      logSkipped(`category:${String(record._id)}`, "failed category validation; skipped");
      continue;
    }
    const entry: CategoryEntry = { id: String(record._id), slug: parsed.slug, name: parsed.name };
    index.byId.set(entry.id, entry);
    index.bySlug.set(entry.slug, entry);
  }
  return index;
}

function buildFilter(query: ProductQuery, active: CategoryIndex): QueryFilter<ProductRecord> | null {
  const filter: QueryFilter<ProductRecord> = { status: "published" };

  if (query.categorySlug) {
    const category = active.bySlug.get(query.categorySlug);
    // Unknown category: an honest empty result, not an error.
    if (!category) return null;
    filter.categoryId = { $in: [category.id] } as QueryFilter<ProductRecord>["categoryId"];
  } else {
    const ids = [...active.byId.values()].map((entry) => entry.id);
    filter.categoryId = { $in: ids } as QueryFilter<ProductRecord>["categoryId"];
  }

  if (query.featured) filter.featured = true;
  if (query.excludeSlug) filter.slug = { $ne: query.excludeSlug };

  const term = normalizeSearch(query.search);
  if (term) {
    // Title-first search (Phase 2B): candidates are matched against the
    // product NAME only, with an anchored, escaped, length-aware pattern
    // (see src/lib/search.ts). Descriptions, categories and tags are not
    // searched. The candidate set equals the tier-match set exactly, so
    // `countDocuments` totals are true matches and `nameMatchTier` can
    // rank the fetched candidates deterministically in memory.
    filter.name = searchCandidateRegex(term) as QueryFilter<ProductRecord>["name"];
  }

  return filter;
}

async function databasePagedProducts(query: ProductQuery): Promise<PagedProducts> {
  const page = clampPage(query.page);
  const pageSize = clampPageSize(query.pageSize);
  const term = normalizeSearch(query.search);

  const active = await loadActiveCategoryIndex();
  const filter = buildFilter(query, active);
  if (!filter) {
    return { items: [], total: 0, page, pageSize, totalPages: 1 };
  }

  // Without a search term, pagination pushes straight into the database
  // (skip/limit over the indexed sort). With a search term, relevance
  // ranking must run before slicing, so all matches are fetched (bounded
  // by the name-only, escaped query — fine at M0 catalogue scale), ranked
  // deterministically, and only then sliced for the requested page.
  const [records, total] = await Promise.all([
    term
      ? ProductModel.find(filter).sort({ sortOrder: 1, slug: 1 }).lean()
      : ProductModel.find(filter)
          .sort({ sortOrder: 1, slug: 1 })
          .skip((page - 1) * pageSize)
          .limit(pageSize)
          .lean(),
    ProductModel.countDocuments(filter),
  ]);

  const items: Product[] = [];
  for (const record of records) {
    const category = active.byId.get(String(record.categoryId));
    if (!category) continue; // dangling or inactive category reference
    const product = recordToProduct(record, category);
    if (product) items.push(product);
  }

  const ranked = term ? [...items].sort((a, b) => compareSearchRelevance(a, b, term)) : items;
  const paged = term ? ranked.slice((page - 1) * pageSize, (page - 1) * pageSize + pageSize) : items;

  return { items: paged, total, page, pageSize, totalPages: totalPagesFor(total, pageSize) };
}

/* ── fixture internals ──────────────────────────────────────────────── */

function fixtureQueryFilter(query: ProductQuery): (product: Product) => boolean {
  return (product) => {
    if (product.status !== "published") return false;
    if (query.categorySlug && product.category !== query.categorySlug) return false;
    if (query.featured && !product.featured) return false;
    if (query.excludeSlug && product.slug === query.excludeSlug) return false;
    return true;
  };
}

function fixturePagedProducts(query: ProductQuery): PagedProducts {
  const page = clampPage(query.page);
  const pageSize = clampPageSize(query.pageSize);
  const term = normalizeSearch(query.search);

  let matched = fixtureProducts.filter(fixtureQueryFilter(query));
  if (term) {
    // Same title-first rules as the database path (src/lib/search.ts):
    // names only, tiered relevance, deterministic tiebreaks.
    matched = matched
      .filter((product) => nameMatchTier(product.name, term) > 0)
      .sort((a, b) => compareSearchRelevance(a, b, term));
  } else {
    matched = matched.sort((a, b) => a.sortOrder - b.sortOrder);
  }

  const items: Product[] = [];
  for (const product of matched.slice((page - 1) * pageSize, (page - 1) * pageSize + pageSize)) {
    const parsed = fixtureToProduct(product);
    if (parsed) items.push(parsed);
  }

  return {
    items,
    total: matched.length,
    page,
    pageSize,
    totalPages: totalPagesFor(matched.length, pageSize),
  };
}

/* ── public read operations ─────────────────────────────────────────── */

/** 1. Active categories (menu chips, breadcrumbs). */
export async function getActiveCategories(): Promise<ReadResult<CatalogueCategory[]>> {
  const source = resolveCatalogueSource();
  if (source === "fixtures") {
    return { ok: true, source: "fixtures", data: fixtureCategoryList() };
  }
  if (source === "unavailable") return { ok: false, reason: "unavailable" };

  try {
    await connectDatabase();
    const records = await CategoryModel.find({ isActive: true }).sort({ sortOrder: 1 }).lean();
    const list: CatalogueCategory[] = [];
    for (const record of records) {
      const parsed = toCatalogueCategory(record);
      if (parsed) list.push(parsed);
      else logSkipped(`category:${String(record._id)}`, "failed category validation; skipped");
    }
    return { ok: true, source: "database", data: list };
  } catch (error) {
    logDatabaseError("getActiveCategories", error);
    return { ok: false, reason: "unavailable" };
  }
}

/** 2. Published products (filters, search, pagination in one safe read). */
export async function getPublishedProducts(query: ProductQuery = {}): Promise<ReadResult<PagedProducts>> {
  const source = resolveCatalogueSource();
  if (source === "fixtures") {
    return { ok: true, source: "fixtures", data: fixturePagedProducts(query) };
  }
  if (source === "unavailable") return { ok: false, reason: "unavailable" };

  try {
    await connectDatabase();
    return { ok: true, source: "database", data: await databasePagedProducts(query) };
  } catch (error) {
    logDatabaseError("getPublishedProducts", error);
    return { ok: false, reason: "unavailable" };
  }
}

/** 3. Products within one category. */
export async function getProductsByCategory(
  categorySlug: string,
  options: Omit<ProductQuery, "categorySlug"> = {},
): Promise<ReadResult<PagedProducts>> {
  return getPublishedProducts({ ...options, categorySlug });
}

/** 4. Search published products by name (title-first relevance ordering). */
export async function searchPublishedProducts(
  search: string,
  options: Omit<ProductQuery, "search"> = {},
): Promise<ReadResult<PagedProducts>> {
  return getPublishedProducts({ ...options, search });
}

/** 5. One published product by slug (drafts and unknown slugs → null). */
export async function getPublishedProductBySlug(slug: string): Promise<ReadResult<Product | null>> {
  const source = resolveCatalogueSource();
  if (source === "fixtures") {
    const found = fixtureProducts.find((product) => product.slug === slug);
    if (!found || found.status !== "published") return { ok: true, source: "fixtures", data: null };
    const parsed = fixtureToProduct(found);
    return { ok: true, source: "fixtures", data: parsed };
  }
  if (source === "unavailable") return { ok: false, reason: "unavailable" };

  try {
    await connectDatabase();
    const active = await loadActiveCategoryIndex();
    const record = await ProductModel.findOne({ slug, status: "published" }).lean();
    if (!record) return { ok: true, source: "database", data: null };

    const category = active.byId.get(String(record.categoryId));
    if (!category) return { ok: true, source: "database", data: null };

    return { ok: true, source: "database", data: recordToProduct(record, category) };
  } catch (error) {
    logDatabaseError("getPublishedProductBySlug", error);
    return { ok: false, reason: "unavailable" };
  }
}

/* ── slug resolution (Phase 3: stable URLs across admin renames) ────── */

export type SlugResolution =
  /** The slug is the product's current address: serve normally. */
  | { kind: "current" }
  /** The slug is a former address; `canonical` is where to redirect. */
  | { kind: "previous"; canonical: string }
  /** No publicly visible product owns this slug (unknown, draft, archived,
   * or its category is disabled). */
  | { kind: "missing" };

/**
 * Resolve a requested product slug against current AND previous slugs.
 *
 * Phase 3 lets owners change a product's address; the old slug is kept in
 * `previousSlugs`, so existing links (bookmarks, messages, search results)
 * redirect to the canonical URL instead of breaking. Drafts, archived
 * products and products in a disabled category resolve to `missing` exactly
 * like unknown slugs, matching the page layer's visibility rules so
 * unpublished content never leaks through the redirect path.
 *
 * Returns `{ ok: false }` on infrastructure trouble so callers can fall
 * back to the honest unavailable state instead of 404ing valid URLs.
 */
export async function resolvePublicProductSlug(
  slug: string,
): Promise<ReadResult<SlugResolution>> {
  const source = resolveCatalogueSource();
  if (source === "fixtures") {
    // Fixture slugs never change; only exact published matches exist.
    const found = fixtureProducts.find((product) => product.slug === slug);
    return {
      ok: true,
      source: "fixtures",
      data: found && found.status === "published" ? { kind: "current" } : { kind: "missing" },
    };
  }
  if (source === "unavailable") return { ok: false, reason: "unavailable" };

  try {
    await connectDatabase();
    const record = await ProductModel.findOne({
      status: "published",
      $or: [{ slug }, { previousSlugs: slug }],
    })
      .select({ slug: 1, categoryId: 1 })
      .lean();
    if (!record) return { ok: true, source: "database", data: { kind: "missing" } };
    // Same visibility rule as the page layer (getPublishedProductBySlug):
    // a published product in a DISABLED category is not publicly visible.
    // Without this check the proxy would pass the request through and the
    // page would end in notFound() — a soft 404 (200 status) in production,
    // because the postponed shell commits the status before the page runs.
    const active = await loadActiveCategoryIndex();
    if (!active.byId.has(String(record.categoryId))) {
      return { ok: true, source: "database", data: { kind: "missing" } };
    }
    if (record.slug === slug) return { ok: true, source: "database", data: { kind: "current" } };
    return { ok: true, source: "database", data: { kind: "previous", canonical: record.slug } };
  } catch (error) {
    logDatabaseError("resolvePublicProductSlug", error);
    return { ok: false, reason: "unavailable" };
  }
}

/** 6. Featured published products (homepage showcase). */
export async function getFeaturedProducts(limit = 7): Promise<ReadResult<Product[]>> {
  const result = await getPublishedProducts({ featured: true, page: 1, pageSize: clampPageSize(limit) });
  if (!result.ok) return result;
  return { ok: true, source: result.source, data: result.data.items };
}

/** 7. Paginated results (explicit wrapper over getPublishedProducts). */
export async function getPaginatedProducts(
  page: number,
  pageSize: number,
  filters: Omit<ProductQuery, "page" | "pageSize"> = {},
): Promise<ReadResult<PagedProducts>> {
  return getPublishedProducts({ ...filters, page, pageSize });
}

/** Published-product count per active category slug (menu chip counts). */
export async function getCategoryCounts(): Promise<ReadResult<Record<string, number>>> {
  const source = resolveCatalogueSource();
  if (source === "fixtures") {
    const counts: Record<string, number> = {};
    for (const category of fixtureCategoryList()) counts[category.slug] = 0;
    for (const product of fixtureProducts) {
      if (product.status === "published" && counts[product.category] !== undefined) {
        counts[product.category] += 1;
      }
    }
    return { ok: true, source: "fixtures", data: counts };
  }
  if (source === "unavailable") return { ok: false, reason: "unavailable" };

  try {
    await connectDatabase();
    const active = await loadActiveCategoryIndex();
    const counts: Record<string, number> = {};
    for (const entry of active.bySlug.values()) counts[entry.slug] = 0;

    const rows = await ProductModel.aggregate<{ _id: Types.ObjectId; count: number }>([
      { $match: { status: "published" } },
      { $group: { _id: "$categoryId", count: { $sum: 1 } } },
    ]);

    for (const row of rows) {
      const entry = active.byId.get(String(row._id));
      if (entry) counts[entry.slug] = row.count;
    }
    return { ok: true, source: "database", data: counts };
  } catch (error) {
    logDatabaseError("getCategoryCounts", error);
    return { ok: false, reason: "unavailable" };
  }
}

/** Total published products (homepage tile count). */
export async function countPublishedProducts(): Promise<ReadResult<number>> {
  const source = resolveCatalogueSource();
  if (source === "fixtures") {
    return { ok: true, source: "fixtures", data: fixtureProducts.filter((p) => p.status === "published").length };
  }
  if (source === "unavailable") return { ok: false, reason: "unavailable" };

  try {
    await connectDatabase();
    const active = await loadActiveCategoryIndex();
    const ids = [...active.byId.values()].map((entry) => entry.id);
    const total = await ProductModel.countDocuments({ status: "published", categoryId: { $in: ids } });
    return { ok: true, source: "database", data: total };
  } catch (error) {
    logDatabaseError("countPublishedProducts", error);
    return { ok: false, reason: "unavailable" };
  }
}

/** Same-category published products, excluding the current one. */
export async function getRelatedProducts(options: {
  categorySlug: string;
  excludeSlug: string;
  limit?: number;
}): Promise<ReadResult<Product[]>> {
  const result = await getPublishedProducts({
    categorySlug: options.categorySlug,
    excludeSlug: options.excludeSlug,
    page: 1,
    pageSize: clampPageSize(options.limit ?? 4),
  });
  if (!result.ok) return result;
  return { ok: true, source: result.source, data: result.data.items };
}

/** Homepage showcase: featured products plus the honest published total. */
export async function getHomepageShowcase(): Promise<
  ReadResult<{ featured: Product[]; total: number }>
> {
  const [featured, total] = await Promise.all([getFeaturedProducts(), countPublishedProducts()]);
  if (!featured.ok) return featured;
  if (!total.ok) return total;
  return { ok: true, source: featured.source, data: { featured: featured.data, total: total.data } };
}
