import { DEFAULT_PAGE_SIZE } from "@/lib/validations/catalogue";

/**
 * Canonical builders for `/menu` URLs.
 *
 * Every filter and pagination control navigates through these helpers so
 * query keys stay consistent, shareable, and Back/Forward friendly. Unknown
 * state is omitted rather than rendered as `?page=1`, keeping the default
 * view at the clean `/menu` URL.
 */

export interface MenuUrlOptions {
  /** Category slug, or null/undefined for the full menu. */
  category?: string | null;
  /** Search term, or null/undefined for no search. */
  search?: string | null;
  /** 1-based page; omitted when 1 (the default view). */
  page?: number | null;
  /** Page size; omitted when it matches the default. */
  pageSize?: number | null;
}

export function menuUrl({ category, search, page, pageSize }: MenuUrlOptions = {}): string {
  const params = new URLSearchParams();

  const slug = category?.trim();
  if (slug) params.set("category", slug);

  const term = search?.trim();
  if (term) params.set("search", term);

  if (page && page > 1) params.set("page", String(page));

  if (pageSize && pageSize !== DEFAULT_PAGE_SIZE) params.set("pageSize", String(pageSize));

  const query = params.toString();
  return query ? `/menu?${query}` : "/menu";
}
