"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { motion } from "motion/react";
import { Loader2, Search, X } from "lucide-react";
import { menuUrl } from "@/lib/menu-url";
import { cn, pluralize } from "@/lib/utils";
import type { CatalogueCategory, Product } from "@/types";
import { Badge } from "@/components/ui/badge";
import { Chip } from "@/components/ui/chip";
import { ProductCard } from "@/components/shared/product-card";
import { MenuEmpty, MenuPastEnd, MenuPreparing } from "./menu-states";

const SEARCH_DEBOUNCE_MS = 350;

/**
 * Visible pagination window: every page up to 7, otherwise first/last with
 * the neighbourhood of the current page and ellipsis gaps.
 */
export function pageWindow(page: number, totalPages: number): Array<number | "gap"> {
  if (totalPages <= 7) {
    return Array.from({ length: totalPages }, (_, index) => index + 1);
  }
  const pages = [...new Set([1, totalPages, page - 1, page, page + 1])].filter(
    (value) => value >= 1 && value <= totalPages,
  );
  const sorted = pages.sort((a, b) => a - b);
  const window: Array<number | "gap"> = [];
  let previous = 0;
  for (const value of sorted) {
    if (previous && value - previous > 1) window.push("gap");
    window.push(value);
    previous = value;
  }
  return window;
}

export interface MenuExplorerProps {
  categories: CatalogueCategory[];
  /** Published-product count per category slug (chips). */
  counts: Record<string, number>;
  /** Current page of results (server-fetched). */
  products: Product[];
  activeCategory: string | null;
  search: string;
  page: number;
  pageSize: number;
  /** Total matches for the current filters (across all pages). */
  total: number;
  totalPages: number;
  /** "fixtures" renders the honest preview-data badge. */
  source: "database" | "fixtures";
}

/**
 * Catalogue surface for `/menu`.
 *
 * The server owns fetching and filtering; this component owns URL-driven
 * controls (chips, debounced search, pagination) so category selection and
 * search stay shareable and Back/Forward friendly. All navigation goes
 * through `menuUrl` to keep query keys consistent.
 */
export function MenuExplorer({
  categories,
  counts,
  products,
  activeCategory,
  search,
  page,
  pageSize,
  total,
  totalPages,
  source,
}: MenuExplorerProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const [draft, setDraft] = useState(search);
  const [prevSearch, setPrevSearch] = useState(search);
  const committedRef = useRef(search);

  // Re-sync the input when the URL search changes from outside (Back/Forward).
  if (prevSearch !== search) {
    setPrevSearch(search);
    setDraft(search);
  }

  useEffect(() => {
    committedRef.current = search;
  }, [search]);

  const commitSearch = useCallback(
    (rawTerm: string) => {
      // Fold before comparing: "pie " and "pie" are the same search, so a
      // trailing space can never trigger a redundant server round-trip.
      const term = rawTerm.trim();
      if (term === committedRef.current) return;
      committedRef.current = term;
      startTransition(() => {
        router.replace(menuUrl({ category: activeCategory, search: term, pageSize }));
      });
    },
    [router, activeCategory, pageSize],
  );

  // Debounced live search: bounded to one server round-trip per pause.
  useEffect(() => {
    if (draft === search) return;
    const timer = setTimeout(() => commitSearch(draft), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [draft, search, commitSearch]);

  const clearSearch = () => {
    setDraft("");
    // Clearing restores the catalogue within the selected category
    // immediately (no debounce on an intentional action).
    commitSearch("");
  };

  const selectCategory = (slug: string | null) => {
    // Re-selecting the active chip is a no-op: no redundant navigation.
    if (slug === activeCategory) return;
    startTransition(() => {
      router.push(menuUrl({ category: slug, search, pageSize }));
    });
  };

  const resetAll = () => {
    startTransition(() => {
      router.push(menuUrl({ pageSize }));
    });
  };

  const resetToFirstPage = () => {
    startTransition(() => {
      router.push(menuUrl({ category: activeCategory, search, pageSize }));
    });
  };

  const handleSearchSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    commitSearch(draft);
  };

  const category = activeCategory
    ? categories.find((item) => item.slug === activeCategory)?.name ?? activeCategory
    : null;
  const noun = pluralize(total, "dish", "dishes");
  const summary = search
    ? category
      ? `Showing ${total} ${noun} for “${search}” in ${category}`
      : `Showing ${total} ${noun} for “${search}”`
    : category
      ? `Showing ${total} ${noun} in ${category}`
      : `Showing all ${total} ${noun}`;

  const countValues = Object.values(counts);
  const allCount = countValues.length > 0 ? countValues.reduce((sum, value) => sum + value, 0) : undefined;

  const pastEnd = total > 0 && page > totalPages;
  const empty = total === 0;

  return (
    <div>
      <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
        <div role="group" aria-label="Filter menu by category" className="flex flex-wrap gap-2.5">
          <Chip label="All" count={allCount} active={activeCategory === null} onSelect={() => selectCategory(null)} />
          {categories.map((item) => (
            <Chip
              key={item.slug}
              label={item.name}
              count={counts[item.slug]}
              active={activeCategory === item.slug}
              onSelect={() => selectCategory(item.slug)}
            />
          ))}
        </div>

        <form
          role="search"
          aria-label="Search the menu"
          onSubmit={handleSearchSubmit}
          className="w-full lg:w-72 lg:shrink-0"
        >
          <label htmlFor="menu-search" className="sr-only">
            Search dishes by name
          </label>
          <div className="relative">
            <Search
              className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-muted"
              aria-hidden="true"
            />
            <input
              id="menu-search"
              type="search"
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              placeholder="Search by dish name"
              autoComplete="off"
              className="focus-gold w-full rounded-full border border-border bg-surface py-3 pl-11 pr-11 text-sm text-navy placeholder:text-ink-muted [&::-webkit-search-cancel-button]:hidden"
            />
            {draft ? (
              <button
                type="button"
                onClick={clearSearch}
                aria-label="Clear search"
                className="focus-gold absolute right-2 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full text-ink-muted transition-colors hover:bg-cream-200 hover:text-navy"
              >
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            ) : null}
          </div>
        </form>
      </div>

      <div className="mt-6 flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <p aria-live="polite" className="text-sm font-semibold text-ink-muted">
          {summary}
        </p>
        <div className="flex items-center gap-3">
          {isPending ? (
            <span
              className="flex items-center gap-1.5 text-xs font-semibold text-ink-muted"
              aria-hidden="true"
            >
              <Loader2 className="h-3.5 w-3.5 motion-safe:animate-spin" />
              Updating results…
            </span>
          ) : null}
          {source === "fixtures" ? (
            <Badge tone="neutral" className="border border-sand bg-transparent">
              Preview catalogue
            </Badge>
          ) : null}
        </div>
      </div>

      <div aria-busy={isPending}>
        {empty ? (
          <div className="mt-6">
            {category || search ? <MenuEmpty onReset={resetAll} search={search || undefined} /> : <MenuPreparing />}
          </div>
        ) : pastEnd ? (
          <div className="mt-6">
            <MenuPastEnd page={page} onReset={resetToFirstPage} />
          </div>
        ) : (
          <ul
            className={cn(
              "mt-6 grid gap-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4",
              isPending && "opacity-70 transition-opacity duration-200",
            )}
          >
            {products.map((product, index) => (
              <motion.li
                key={product.slug}
                initial={{ opacity: 0, scale: 0.96 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{
                  duration: 0.25,
                  delay: Math.min(index * 0.03, 0.15),
                  ease: [0.22, 1, 0.36, 1],
                }}
                className="h-full"
              >
                <ProductCard product={product} className="h-full" />
              </motion.li>
            ))}
          </ul>
        )}
      </div>

      {totalPages > 1 && !empty && !pastEnd ? (
        <nav aria-label="Pagination" className="mt-10 flex flex-wrap items-center justify-center gap-2">
          {page > 1 ? (
            <Link
              href={menuUrl({ category: activeCategory, search, page: page - 1, pageSize })}
              className="focus-gold rounded-full border border-border bg-surface px-4 py-2 text-sm font-semibold text-navy transition-colors hover:border-navy/40"
            >
              ← Previous
            </Link>
          ) : (
            <span aria-disabled="true" className="rounded-full border border-sand px-4 py-2 text-sm font-semibold text-ink-muted opacity-60">
              ← Previous
            </span>
          )}

          {pageWindow(page, totalPages).map((entry, index) =>
            entry === "gap" ? (
              <span key={`gap-${index}`} aria-hidden="true" className="px-1 text-ink-muted">
                …
              </span>
            ) : (
              <Link
                key={entry}
                href={menuUrl({ category: activeCategory, search, page: entry, pageSize })}
                aria-current={entry === page ? "page" : undefined}
                className={cn(
                  "focus-gold rounded-full px-3.5 py-2 text-sm font-semibold transition-colors",
                  entry === page
                    ? "bg-navy text-cream"
                    : "border border-border bg-surface text-navy hover:border-navy/40",
                )}
              >
                {entry}
              </Link>
            ),
          )}

          {page < totalPages ? (
            <Link
              href={menuUrl({ category: activeCategory, search, page: page + 1, pageSize })}
              className="focus-gold rounded-full border border-border bg-surface px-4 py-2 text-sm font-semibold text-navy transition-colors hover:border-navy/40"
            >
              Next →
            </Link>
          ) : (
            <span aria-disabled="true" className="rounded-full border border-sand px-4 py-2 text-sm font-semibold text-ink-muted opacity-60">
              Next →
            </span>
          )}
        </nav>
      ) : null}
    </div>
  );
}
