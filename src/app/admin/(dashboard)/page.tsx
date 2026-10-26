import type { Metadata } from "next";
import { connection } from "next/server";
import Link from "next/link";
import { AlertTriangle, ClipboardList, FolderTree, Package, PackagePlus } from "lucide-react";
import { getDashboardStats } from "@/lib/repositories/admin";
import { formatCad } from "@/lib/format";
import { ORDER_STATUS_LABELS, PAYMENT_STATUS_LABELS } from "@/lib/orders/lifecycle";
import { Badge, type BadgeTone } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";

export const metadata: Metadata = {
  title: "Dashboard",
};

/**
 * `/admin` — operational dashboard (Phase 3, extended in Phase 5).
 *
 * Every number comes from live MongoDB counts; nothing is estimated or
 * invented. Order metrics are real aggregates over `orders` records, and
 * collected revenue counts ONLY orders marked `paid` — an unpaid Cash on
 * Arrival order is outstanding money, never revenue in hand.
 */

const STATUS_TONE: Record<string, BadgeTone> = {
  published: "leaf",
  draft: "neutral",
  archived: "terracotta",
};

const ORDER_TONE: Record<string, BadgeTone> = {
  placed: "gold",
  confirmed: "navy",
  preparing: "navy",
  ready_for_pickup: "leaf",
  out_for_delivery: "leaf",
  completed: "neutral",
  cancelled: "terracotta",
};

const PAYMENT_TONE: Record<string, BadgeTone> = {
  unpaid: "terracotta",
  paid: "leaf",
};

function formatDate(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime())
    ? ""
    : date.toLocaleDateString("en-CA", { month: "short", day: "numeric", year: "numeric" });
}

function StatCard({
  label,
  value,
  hint,
}: {
  label: string;
  value: number | string;
  hint?: string;
}) {
  return (
    <div className="rounded-2xl border border-border bg-surface p-5">
      <p className="font-sans text-sm font-semibold text-ink-muted">{label}</p>
      <p className="mt-1 font-serif text-3xl font-semibold text-navy">{value}</p>
      {hint ? <p className="mt-1 font-sans text-xs text-ink-muted">{hint}</p> : null}
    </div>
  );
}

export default async function AdminDashboardPage() {
  // Always render at request time: the stats are live counts, so no
  // prerender or prefetch pass may execute them (they read current DB
  // state, which trips the blocking current-time guard).
  await connection();
  const stats = await getDashboardStats();

  if (!stats) {
    return (
      <div className="space-y-4">
        <h1 className="font-serif text-3xl font-semibold text-navy">Dashboard</h1>
        <div className="rounded-2xl border border-terracotta-700/40 bg-terracotta-700/10 p-6">
          <div className="flex items-start gap-3">
            <AlertTriangle className="mt-0.5 size-5 shrink-0 text-terracotta-700" aria-hidden="true" />
            <div>
              <h2 className="font-sans text-base font-bold text-navy">
                Catalogue data is unavailable right now
              </h2>
              <p className="mt-1 font-sans text-sm text-ink-muted">
                Check the database connection and reload this page. No changes were made.
              </p>
              <Link
                href="/admin"
                className="mt-3 inline-flex rounded-lg font-sans text-sm font-semibold text-navy underline underline-offset-2 focus-gold"
              >
                Try again
              </Link>
            </div>
          </div>
        </div>
      </div>
    );
  }

  const isEmpty = stats.totalProducts === 0 && stats.totalCategories === 0;

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-serif text-3xl font-semibold text-navy">Dashboard</h1>
          <p className="mt-1 font-sans text-sm text-ink-muted">
            Your catalogue at a glance.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <ButtonLink href="/admin/orders" variant="primary" size="sm">
            <ClipboardList className="size-4" aria-hidden="true" />
            View orders
          </ButtonLink>
          <ButtonLink href="/admin/products/new" variant="outline" size="sm">
            <PackagePlus className="size-4" aria-hidden="true" />
            Add product
          </ButtonLink>
          <ButtonLink href="/admin/products" variant="outline" size="sm">
            <Package className="size-4" aria-hidden="true" />
            View products
          </ButtonLink>
          <ButtonLink href="/admin/categories" variant="outline" size="sm">
            <FolderTree className="size-4" aria-hidden="true" />
            Manage categories
          </ButtonLink>
        </div>
      </div>

      {isEmpty ? (
        <div className="rounded-2xl border border-border bg-surface p-8 text-center">
          <h2 className="font-serif text-xl font-semibold text-navy">Welcome to your dashboard</h2>
          <p className="mx-auto mt-2 max-w-md font-sans text-sm text-ink-muted">
            Nothing has been set up yet. Add your categories first, then create your
            first product. You can save a product as a draft until you are ready to
            publish it.
          </p>
          <div className="mt-5 flex flex-wrap justify-center gap-2">
            <ButtonLink href="/admin/categories" variant="primary" size="sm">
              Manage categories
            </ButtonLink>
            <ButtonLink href="/admin/products/new" variant="outline" size="sm">
              Add product
            </ButtonLink>
          </div>
        </div>
      ) : null}

      <section aria-label="Catalogue statistics" className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-5">
        <StatCard label="Total products" value={stats.totalProducts} />
        <StatCard label="Published" value={stats.publishedProducts} hint="Visible to customers" />
        <StatCard label="Drafts" value={stats.draftProducts} hint="Hidden from customers" />
        <StatCard label="Unavailable" value={stats.unavailableProducts} hint="Shown as sold out" />
        <StatCard
          label="Categories"
          value={stats.totalCategories}
          hint={`${stats.activeCategories} active`}
        />
      </section>

      <section aria-label="Order statistics" className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-5">
        <StatCard label="Orders" value={stats.orders.total} hint="All time" />
        <StatCard label="In progress" value={stats.orders.inProgress} hint="Awaiting completion" />
        <StatCard label="Awaiting payment" value={stats.orders.awaitingPayment} hint="Cash on Arrival" />
        <StatCard
          label="Outstanding"
          value={formatCad(stats.orders.unpaidCents) ?? "-"}
          hint="Unpaid Cash on Arrival"
        />
        <StatCard
          label="Collected"
          value={formatCad(stats.orders.collectedCents) ?? "-"}
          hint="Payments recorded"
        />
      </section>

      <section aria-label="Recently updated products" className="rounded-2xl border border-border bg-surface">
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <h2 className="font-sans text-base font-bold text-navy">Recently updated</h2>
          <Link
            href="/admin/products?sort=updated"
            className="font-sans text-sm font-semibold text-navy underline underline-offset-2 focus-gold rounded"
          >
            All products
          </Link>
        </div>
        {stats.recentProducts.length === 0 ? (
          <p className="px-5 py-8 text-center font-sans text-sm text-ink-muted">
            No products yet. Add your first product to see it here.
          </p>
        ) : (
          <ul className="divide-y divide-border">
            {stats.recentProducts.map((product) => (
              <li key={product.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-5 py-3.5">
                <Link
                  href={`/admin/products/${product.id}/edit`}
                  className="font-sans text-sm font-semibold text-navy underline-offset-2 hover:underline focus-gold rounded"
                >
                  {product.name}
                </Link>
                <Badge tone={STATUS_TONE[product.status] ?? "neutral"}>{product.status}</Badge>
                {product.availability === "unavailable" ? (
                  <Badge tone="terracotta">Unavailable</Badge>
                ) : null}
                <span className="ml-auto font-sans text-xs text-ink-muted">
                  Updated {formatDate(product.updatedAt)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-label="Recent orders" className="rounded-2xl border border-border bg-surface">
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <h2 className="font-sans text-base font-bold text-navy">Recent orders</h2>
          <Link
            href="/admin/orders"
            className="rounded font-sans text-sm font-semibold text-navy underline-offset-2 hover:underline focus-gold"
          >
            All orders
          </Link>
        </div>
        {stats.recentOrders.length === 0 ? (
          <p className="px-5 py-8 text-center font-sans text-sm text-ink-muted">
            No orders yet. Orders appear here as soon as a customer places one.
          </p>
        ) : (
          <ul className="divide-y divide-border">
            {stats.recentOrders.map((order) => (
              <li key={order.reference} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-5 py-3.5">
                <Link
                  href={`/admin/orders/${order.reference}`}
                  className="font-sans text-sm font-semibold text-navy underline-offset-2 hover:underline focus-gold rounded"
                >
                  {order.reference}
                </Link>
                <span className="font-sans text-sm text-navy-700">{order.customerName}</span>
                <Badge tone={ORDER_TONE[order.status] ?? "neutral"}>
                  {ORDER_STATUS_LABELS[order.status]}
                </Badge>
                <Badge tone={PAYMENT_TONE[order.paymentStatus] ?? "neutral"}>
                  {PAYMENT_STATUS_LABELS[order.paymentStatus]}
                </Badge>
                <span className="ml-auto font-sans text-xs text-ink-muted">
                  {formatCad(order.totalCents)} · {formatDate(order.placedAtIso)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
