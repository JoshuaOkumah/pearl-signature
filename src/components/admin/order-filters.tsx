"use client";

import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { Search } from "lucide-react";
import { ORDER_STATUSES, PAYMENT_STATUSES } from "@/lib/validations/order";
import { ORDER_STATUS_LABELS, PAYMENT_STATUS_LABELS } from "@/lib/orders/lifecycle";

/**
 * Admin order filters (Phase 5).
 *
 * All state lives in the URL, so a filtered list is shareable and
 * Back/Forward work. Select changes apply immediately; the search box
 * applies on submit to avoid one request per keystroke. The actual
 * filtering is executed server-side by `listAdminOrders`.
 */

const selectClasses =
  "h-11 rounded-lg border border-navy/20 bg-surface px-3 font-sans text-sm text-navy transition-colors hover:border-navy/35 focus-gold";

export interface OrderFilterState {
  search?: string | undefined;
  status?: string | undefined;
  payment?: string | undefined;
}

export function OrderFilters({
  initial,
  hasActiveFilters,
}: {
  initial: OrderFilterState;
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
      aria-label="Filter orders"
      onSubmit={onSearchSubmit}
      className="flex flex-wrap items-end gap-3"
    >
      <div className="min-w-60 flex-1">
        <label htmlFor="admin-order-search" className="mb-1.5 block font-sans text-sm font-semibold text-navy">
          Search orders
        </label>
        <div className="relative">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 size-4.5 -translate-y-1/2 text-ink-muted"
            aria-hidden="true"
          />
          <input
            id="admin-order-search"
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Reference, customer name or email"
            className="h-11 w-full rounded-lg border border-navy/20 bg-surface pl-10 pr-3 font-sans text-sm text-navy placeholder:text-ink-muted/70 transition-colors hover:border-navy/35 focus-gold"
          />
        </div>
      </div>

      <div>
        <label htmlFor="admin-order-status" className="mb-1.5 block font-sans text-sm font-semibold text-navy">
          Status
        </label>
        <select
          id="admin-order-status"
          value={initial.status ?? ""}
          onChange={(event) => apply({ status: event.target.value || undefined })}
          className={selectClasses}
        >
          <option value="">All statuses</option>
          {ORDER_STATUSES.map((status) => (
            <option key={status} value={status}>
              {ORDER_STATUS_LABELS[status]}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label htmlFor="admin-order-payment" className="mb-1.5 block font-sans text-sm font-semibold text-navy">
          Payment
        </label>
        <select
          id="admin-order-payment"
          value={initial.payment ?? ""}
          onChange={(event) => apply({ payment: event.target.value || undefined })}
          className={selectClasses}
        >
          <option value="">Any payment state</option>
          {PAYMENT_STATUSES.map((status) => (
            <option key={status} value={status}>
              {PAYMENT_STATUS_LABELS[status]}
            </option>
          ))}
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
          Clear filters
        </button>
      ) : null}
    </form>
  );
}
