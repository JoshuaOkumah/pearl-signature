"use client";

import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { Search, X } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Admin product filters (Phase 3).
 *
 * All state lives in the URL, so filtered lists are shareable and the
 * browser's Back/Forward buttons work. Select changes apply immediately;
 * the search box applies on submit (Enter or the search button) to avoid
 * one request per keystroke.
 */

const selectClasses =
  "h-11 rounded-lg border border-navy/20 bg-surface px-3 font-sans text-sm text-navy transition-colors hover:border-navy/35 focus-gold";

export interface ProductFilterState {
  search?: string | undefined;
  category?: string | undefined;
  status?: string | undefined;
  availability?: string | undefined;
  sort?: string | undefined;
}

export function ProductFilters({
  categories,
  initial,
  hasActiveFilters,
}: {
  categories: Array<{ slug: string; name: string; isActive: boolean }>;
  initial: ProductFilterState;
  hasActiveFilters: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [search, setSearch] = useState(initial.search ?? "");
  const firstRender = useRef(true);

  function apply(patch: Record<string, string | undefined>) {
    const params = new URLSearchParams(searchParams.toString());
    for (const [key, value] of Object.entries(patch)) {
      if (value) params.set(key, value);
      else params.delete(key);
    }
    // Any filter change returns to page 1.
    if (!("page" in patch)) params.delete("page");
    const query = params.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
  }

  // Keep the box in sync when the URL changes elsewhere (back/forward).
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    setSearch(searchParams.get("search") ?? "");
  }, [searchParams]);

  function onSearchSubmit(event: FormEvent) {
    event.preventDefault();
    apply({ search: search.trim() || undefined });
  }

  return (
    <form
      role="search"
      aria-label="Filter products"
      onSubmit={onSearchSubmit}
      className="flex flex-wrap items-end gap-3"
    >
      <div className="min-w-56 flex-1">
        <label htmlFor="admin-product-search" className="mb-1.5 block font-sans text-sm font-semibold text-navy">
          Search by name
        </label>
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4.5 -translate-y-1/2 text-ink-muted" aria-hidden="true" />
          <input
            id="admin-product-search"
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Product name"
            className="h-11 w-full rounded-lg border border-navy/20 bg-surface pl-10 pr-3 font-sans text-sm text-navy placeholder:text-ink-muted/70 transition-colors hover:border-navy/35 focus-gold"
          />
        </div>
      </div>

      <div>
        <label htmlFor="admin-filter-category" className="mb-1.5 block font-sans text-sm font-semibold text-navy">
          Category
        </label>
        <select
          id="admin-filter-category"
          value={initial.category ?? ""}
          onChange={(event) => apply({ category: event.target.value || undefined })}
          className={cn(selectClasses, "max-w-56")}
        >
          <option value="">All categories</option>
          {categories.map((category) => (
            <option key={category.slug} value={category.slug}>
              {category.name}
              {category.isActive ? "" : " (disabled)"}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label htmlFor="admin-filter-status" className="mb-1.5 block font-sans text-sm font-semibold text-navy">
          Status
        </label>
        <select
          id="admin-filter-status"
          value={initial.status ?? ""}
          onChange={(event) => apply({ status: event.target.value || undefined })}
          className={selectClasses}
        >
          <option value="">All statuses</option>
          <option value="published">Published</option>
          <option value="draft">Draft</option>
          <option value="archived">Archived</option>
        </select>
      </div>

      <div>
        <label htmlFor="admin-filter-availability" className="mb-1.5 block font-sans text-sm font-semibold text-navy">
          Availability
        </label>
        <select
          id="admin-filter-availability"
          value={initial.availability ?? ""}
          onChange={(event) => apply({ availability: event.target.value || undefined })}
          className={selectClasses}
        >
          <option value="">Any</option>
          <option value="available">Available</option>
          <option value="unavailable">Unavailable</option>
        </select>
      </div>

      <div>
        <label htmlFor="admin-filter-sort" className="mb-1.5 block font-sans text-sm font-semibold text-navy">
          Sort by
        </label>
        <select
          id="admin-filter-sort"
          value={initial.sort ?? "updated"}
          onChange={(event) => apply({ sort: event.target.value || undefined })}
          className={selectClasses}
        >
          <option value="updated">Recently updated</option>
          <option value="created">Recently added</option>
          <option value="name">Name (A to Z)</option>
          <option value="price">Price (low to high)</option>
        </select>
      </div>

      <button type="submit" className="sr-only">
        Apply search
      </button>

      {hasActiveFilters ? (
        <button
          type="button"
          onClick={() => {
            setSearch("");
            router.replace(pathname, { scroll: false });
          }}
          className="inline-flex h-11 items-center gap-1.5 rounded-lg border border-navy/25 px-4 font-sans text-sm font-semibold text-navy transition-colors hover:border-navy hover:bg-navy hover:text-cream focus-gold"
        >
          <X className="size-4" aria-hidden="true" />
          Clear filters
        </button>
      ) : null}
    </form>
  );
}
