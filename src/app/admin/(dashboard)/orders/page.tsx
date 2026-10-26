import type { Metadata } from "next";
import { connection } from "next/server";
import Link from "next/link";
import { AlertTriangle, ClipboardList, SearchX } from "lucide-react";
import { listAdminOrders } from "@/lib/repositories/admin";
import { adminOrderQuerySchema } from "@/lib/validations/admin";
import { OrderFilters } from "@/components/admin/order-filters";
import { OrderList } from "@/components/admin/order-list";
import { Pagination } from "@/components/admin/pagination";

export const metadata: Metadata = {
  title: "Orders",
};

type PageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

/**
 * `/admin/orders` — order management list (Phase 5, Milestone D).
 *
 * Server component: filters arrive validated (`.catch`-guarded schema),
 * every filter and the pagination count execute inside MongoDB, and the
 * whole route sits behind the admin session guard (see the layout), with
 * each mutation independently re-authorized inside its Server Action.
 */
export default async function AdminOrdersPage({ searchParams }: PageProps) {
  // Always render at request time: the list is live DB state, so no
  // prerender or prefetch pass may execute these queries.
  await connection();
  const params = await searchParams;
  const pick = (key: string): string | undefined => {
    const value = params[key];
    return Array.isArray(value) ? value[value.length - 1] : value;
  };

  const query = adminOrderQuerySchema.parse({
    search: pick("search"),
    status: pick("status"),
    payment: pick("payment"),
    page: pick("page"),
  });

  const list = await listAdminOrders(query);
  const hasActiveFilters = Boolean(query.search || query.status || query.payment);

  function buildHref(page: number): string {
    const url = new URLSearchParams();
    if (query.search) url.set("search", query.search);
    if (query.status) url.set("status", query.status);
    if (query.payment) url.set("payment", query.payment);
    if (page > 1) url.set("page", String(page));
    const value = url.toString();
    return value ? `/admin/orders?${value}` : "/admin/orders";
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-serif text-3xl font-semibold text-navy">Orders</h1>
          <p className="mt-1 font-sans text-sm text-ink-muted">
            {list
              ? `${list.total} order${list.total === 1 ? "" : "s"}${hasActiveFilters ? " matching these filters" : ""}`
              : "Loading orders…"}
          </p>
        </div>
      </div>

      {!list ? (
        <div className="rounded-2xl border border-terracotta-700/40 bg-terracotta-700/10 p-6">
          <div className="flex items-start gap-3">
            <AlertTriangle className="mt-0.5 size-5 shrink-0 text-terracotta-700" aria-hidden="true" />
            <div>
              <h2 className="font-sans text-base font-bold text-navy">Orders could not be loaded</h2>
              <p className="mt-1 font-sans text-sm text-ink-muted">
                Check the database connection and reload this page. No changes were made.
              </p>
              <Link
                href="/admin/orders"
                className="mt-3 inline-flex rounded-lg font-sans text-sm font-semibold text-navy underline underline-offset-2 focus-gold"
              >
                Try again
              </Link>
            </div>
          </div>
        </div>
      ) : (
        <>
          <OrderFilters
            initial={{
              search: query.search,
              status: query.status,
              payment: query.payment,
            }}
            hasActiveFilters={hasActiveFilters}
          />

          {list.rows.length === 0 ? (
            <div className="rounded-2xl border border-border bg-surface p-8 text-center">
              {hasActiveFilters ? (
                <>
                  <SearchX className="mx-auto size-8 text-ink-muted" aria-hidden="true" />
                  <h2 className="mt-3 font-sans text-base font-bold text-navy">No orders match these filters</h2>
                  <p className="mt-1 font-sans text-sm text-ink-muted">
                    Try a different search term, or clear the filters to see every order.
                  </p>
                  <Link
                    href="/admin/orders"
                    className="mt-4 inline-flex min-h-10 items-center rounded-lg border border-navy/25 px-4 font-sans text-sm font-semibold text-navy transition-colors hover:border-navy hover:bg-navy hover:text-cream focus-gold"
                  >
                    Clear filters
                  </Link>
                </>
              ) : (
                <>
                  <ClipboardList className="mx-auto size-8 text-ink-muted" aria-hidden="true" />
                  <h2 className="mt-3 font-sans text-base font-bold text-navy">No orders yet</h2>
                  <p className="mt-1 font-sans text-sm text-ink-muted">
                    Orders appear here as soon as a customer places one at checkout.
                  </p>
                </>
              )}
            </div>
          ) : (
            <>
              <OrderList rows={list.rows} />
              <Pagination page={list.page} totalPages={list.totalPages} buildHref={buildHref} />
            </>
          )}
        </>
      )}
    </div>
  );
}
