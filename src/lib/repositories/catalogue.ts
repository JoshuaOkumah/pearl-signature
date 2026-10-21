import "server-only";
import type { QueryFilter, Types } from "mongoose";
import { categories as fixtureCategories } from "@/data/categories";
import { products as fixtureProducts } from "@/data/products";
import { connectDatabase, logDatabaseError } from "@/lib/db/mongoose";
import { placeholderThemeFor } from "@/lib/placeholder-themes";
import { CategoryModel } from "@/models/category";
import { ProductModel, type ProductRecord } from "@/models/product";
import {
  DEFAULT_PAGE_SIZE,
  MAX_PAGE,
  MAX_PAGE_SIZE,
  MAX_SEARCH_LENGTH,
  categoryDTOSchema,
  productDTOSchema,
  productImageSchema,
} from "@/lib/validations/catalogue";
import type { CatalogueCategory, Product } from "@/types";

/**
 * Catalogue data-access layer (Phase 2).
 *
 * Every public read funnels through this module. Guarantees:
 *
 * - Only `status: "published"` products in active categories ever leave here.
 * - Search input is length-bounded and regex-escaped before touching a query
 *   (literal substring match, no pathological patterns, no paid Atlas Search).
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

export function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function normalizeSearch(search?: string): string | null {
  const term = search?.trim().slice(0, MAX_SEARCH_LENGTH) ?? "";
  return term ? term : null;
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

/**
 * Map a lean database record to the public DTO. Returns null when the record
 * fails validation or is not published (defence in depth on top of the query
 * filter). Invalid image entries are dropped individually so one bad image
 * never hides an otherwise valid product.
 */
function recordToProduct(record: ProductRecord, category: CategoryEntry): Product | null {
  if (record.status !== "published") return null;

  const images: Product["images"] = [];
  for (const image of record.images ?? []) {
    const parsed = productImageSchema.safeParse({
      secureUrl: image.secureUrl,
      publicId: image.publicId,
      alt: image.alt,
      sortOrder: image.sortOrder ?? 0,
      width: image.width,
      height: image.height,
    });
    if (parsed.success) {
      images.push(parsed.data);
    } else {
      logSkipped(
        `image:${record.slug}`,
        parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; "),
      );
    }
  }

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
  const parsed = productDTOSchema.safeParse(product);
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
    // Escaped literal substring match: no regex metacharacters survive, so
    // user input can never build a pathological pattern.
    const pattern = new RegExp(escapeRegExp(term), "i");
    filter.$or = [{ name: pattern }, { shortDescription: pattern }, { description: pattern }];
  }

  return filter;
}

async function databasePagedProducts(query: ProductQuery): Promise<PagedProducts> {
  const page = clampPage(query.page);
  const pageSize = clampPageSize(query.pageSize);

  const active = await loadActiveCategoryIndex();
  const filter = buildFilter(query, active);
  if (!filter) {
    return { items: [], total: 0, page, pageSize, totalPages: 1 };
  }

  const [records, total] = await Promise.all([
    ProductModel.find(filter)
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

  return { items, total, page, pageSize, totalPages: totalPagesFor(total, pageSize) };
}

/* ── fixture internals ──────────────────────────────────────────────── */

function fixtureQueryFilter(query: ProductQuery): (product: Product) => boolean {
  const term = normalizeSearch(query.search)?.toLowerCase();
  return (product) => {
    if (product.status !== "published") return false;
    if (query.categorySlug && product.category !== query.categorySlug) return false;
    if (query.featured && !product.featured) return false;
    if (query.excludeSlug && product.slug === query.excludeSlug) return false;
    if (term) {
      const haystack = `${product.name}\n${product.shortDescription ?? ""}\n${product.description}`.toLowerCase();
      if (!haystack.includes(term)) return false;
    }
    return true;
  };
}

function fixturePagedProducts(query: ProductQuery): PagedProducts {
  const page = clampPage(query.page);
  const pageSize = clampPageSize(query.pageSize);

  const matched = fixtureProducts
    .filter(fixtureQueryFilter(query))
    .sort((a, b) => a.sortOrder - b.sortOrder);

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

/** 4. Search published products by name and descriptions. */
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
