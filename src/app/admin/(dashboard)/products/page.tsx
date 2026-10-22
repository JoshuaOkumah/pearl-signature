import type { Metadata } from "next";
import { connection } from "next/server";
import Link from "next/link";
import { AlertTriangle, PackagePlus, SearchX } from "lucide-react";
import { listAdminCategories, listAdminProducts } from "@/lib/repositories/admin";
import { adminProductQuerySchema } from "@/lib/validations/admin";
import { ButtonLink } from "@/components/ui/button";
import { ProductFilters } from "@/components/admin/product-filters";
import { ProductTable } from "@/components/admin/product-table";
import { Pagination } from "@/components/admin/pagination";
import { FormAlert } from "@/components/admin/field";

export const metadata: Metadata = {
  title: "Products",
};

type PageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

/**
 * `/admin/products` — product management list (Phase 3).
 *
 * Server component: filters arrive validated (`.catch`-guarded schema),
 * data comes from the admin repository (drafts, archived and disabled
 * categories included), and pagination links preserve the query string.
 */
export default async function AdminProductsPage({ searchParams }: PageProps) {
  // Always render at request time: the list is live DB state, so no
  // prerender or prefetch pass may execute these queries.
  await connection();
  const params = await searchParams;
  const pick = (key: string): string | undefined => {
    const value = params[key];
    return Array.isArray(value) ? value[value.length - 1] : value;
  };

  const query = adminProductQuerySchema.parse({
    search: pick("search"),
    category: pick("category"),
    status: pick("status"),
    availability: pick("availability"),
    sort: pick("sort"),
    page: pick("page"),
  });

  const [list, categories] = await Promise.all([
    listAdminProducts(query),
    listAdminCategories(),
  ]);

  const archivedFlag = pick("archived");
  const hasActiveFilters = Boolean(
    query.search || query.category || query.status || query.availability,
  );

  function buildHref(page: number): string {
    const url = new URLSearchParams();
    if (query.search) url.set("search", query.search);
    if (query.category) url.set("category", query.category);
    if (query.status) url.set("status", query.status);
    if (query.availability) url.set("availability", query.availability);
    if (query.sort && query.sort !== "updated") url.set("sort", query.sort);
    if (page > 1) url.set("page", String(page));
    const value = url.toString();
    return value ? `/admin/products?${value}` : "/admin/products";
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-serif text-3xl font-semibold text-navy">Products</h1>
          <p className="mt-1 font-sans text-sm text-ink-muted">
            {list ? `${list.total} product${list.total === 1 ? "" : "s"}` : "Loading products…"}
          </p>
        </div>
        <ButtonLink href="/admin/products/new" variant="primary" size="sm">
          <PackagePlus className="size-4" aria-hidden="true" />
          Add product
        </ButtonLink>
      </div>

      {archivedFlag ? <FormAlert tone="success">Product archived. It no longer appears in the storefront.</FormAlert> : null}
      {pick("opError") ? (
        <FormAlert tone="error">
          That change could not be saved. Please check your connection and try again.
        </FormAlert>
      ) : null}

      {!list || !categories ? (
        <div className="rounded-2xl border border-terracotta-700/40 bg-terracotta-700/10 p-6">
          <div className="flex items-start gap-3">
            <AlertTriangle className="mt-0.5 size-5 shrink-0 text-terracotta-700" aria-hidden="true" />
            <div>
              <h2 className="font-sans text-base font-bold text-navy">Products could not be loaded</h2>
              <p className="mt-1 font-sans text-sm text-ink-muted">
                Check the database connection and reload this page. No changes were made.
              </p>
              <Link
                href="/admin/products"
                className="mt-3 inline-flex rounded-lg font-sans text-sm font-semibold text-navy underline underline-offset-2 focus-gold"
              >
                Try again
              </Link>
            </div>
          </div>
        </div>
      ) : (
        <>
          <ProductFilters
            categories={categories.map((category) => ({
              slug: category.slug,
              name: category.name,
              isActive: category.isActive,
            }))}
            initial={{
              search: query.search,
              category: query.category,
              status: query.status,
              availability: query.availability,
              sort: query.sort,
            }}
            hasActiveFilters={hasActiveFilters}
          />

          {list.rows.length === 0 ? (
            <div className="rounded-2xl border border-border bg-surface p-8 text-center">
              <SearchX className="mx-auto size-8 text-ink-muted" aria-hidden="true" />
              {hasActiveFilters ? (
                <>
                  <h2 className="mt-3 font-sans text-base font-bold text-navy">No products match these filters</h2>
                  <p className="mt-1 font-sans text-sm text-ink-muted">
                    Try a different search term, or clear the filters to see every product.
                  </p>
                  <Link
                    href="/admin/products"
                    className="mt-4 inline-flex min-h-10 items-center rounded-lg border border-navy/25 px-4 font-sans text-sm font-semibold text-navy transition-colors hover:border-navy hover:bg-navy hover:text-cream focus-gold"
                  >
                    Clear filters
                  </Link>
                </>
              ) : (
                <>
                  <h2 className="mt-3 font-sans text-base font-bold text-navy">No products yet</h2>
                  <p className="mt-1 font-sans text-sm text-ink-muted">
                    Add your first product. You can keep it as a draft until you are ready
                    to publish it.
                  </p>
                  <ButtonLink href="/admin/products/new" variant="primary" size="sm" className="mt-4">
                    Add product
                  </ButtonLink>
                </>
              )}
            </div>
          ) : (
            <>
              <ProductTable rows={list.rows} />
              <Pagination page={list.page} totalPages={list.totalPages} buildHref={buildHref} />
            </>
          )}
        </>
      )}
    </div>
  );
}
