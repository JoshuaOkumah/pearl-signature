import "server-only";
import { cache } from "react";
import { io } from "next/cache";
import {
  getActiveCategories,
  getCategoryCounts,
  getHomepageShowcase,
  getPublishedProductBySlug,
  getPublishedProducts,
  getRelatedProducts,
  type ReadResult,
} from "@/lib/repositories/catalogue";
import type { MenuSearchParams } from "@/lib/validations/catalogue";
import type { CatalogueCategory, Product } from "@/types";

/**
 * Server-side page-data loaders for the dynamic catalogue.
 *
 * Caching decisions (Next.js 16 Cache Components / PPR):
 *
 * - `await io()` before every database read marks it as request-time work, so
 *   prerendering suspends at this boundary and NO database call ever runs at
 *   build time. At request time `io()` resolves immediately (no overhead).
 * - No `"use cache"` on catalogue reads: prices, availability and publication
 *   changes must appear without a redeploy or revalidation wait.
 * - `cache()` dedupes within a single render pass, so `page.tsx` and
 *   `generateMetadata` share one query per request instead of two.
 * - Queries stay small (bounded pages, indexed filters); M0 connection reuse
 *   keeps repeated requests cheap.
 *
 * Failures surface as `ReadResult.ok = false` — pages render a customer-safe
 * error state instead of crashing.
 */

export interface MenuPageData {
  categories: ReadResult<CatalogueCategory[]>;
  products: ReadResult<{
    items: Product[];
    total: number;
    page: number;
    pageSize: number;
    totalPages: number;
  }>;
  counts: ReadResult<Record<string, number>>;
}

export const loadMenuPageData = cache(async (params: MenuSearchParams): Promise<MenuPageData> => {
  await io();
  const [categories, products, counts] = await Promise.all([
    getActiveCategories(),
    getPublishedProducts({
      categorySlug: params.category,
      search: params.search,
      page: params.page,
      pageSize: params.pageSize,
    }),
    getCategoryCounts(),
  ]);
  return { categories, products, counts };
});

export interface ProductPageData {
  product: ReadResult<Product | null>;
  related: ReadResult<Product[]> | null;
}

export const loadProductPageData = cache(async (slug: string): Promise<ProductPageData> => {
  await io();
  const product = await getPublishedProductBySlug(slug);
  if (!product.ok || !product.data) return { product, related: null };

  const related = await getRelatedProducts({
    categorySlug: product.data.category,
    excludeSlug: product.data.slug,
    limit: 4,
  });
  return { product, related };
});

export const loadHomepageShowcase = cache(async () => {
  await io();
  return getHomepageShowcase();
});
