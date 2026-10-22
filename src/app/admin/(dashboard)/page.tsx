import type { Metadata } from "next";
import { connection } from "next/server";
import Link from "next/link";
import { AlertTriangle, FolderTree, Package, PackagePlus } from "lucide-react";
import { getDashboardStats } from "@/lib/repositories/admin";
import { Badge, type BadgeTone } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";

export const metadata: Metadata = {
  title: "Dashboard",
};

/**
 * `/admin` — operational dashboard (Phase 3).
 *
 * Every number comes from live MongoDB counts; nothing is estimated or
 * invented. Sales, revenue and order metrics do not exist in this phase
 * and are not teased anywhere.
 */

const STATUS_TONE: Record<string, BadgeTone> = {
  published: "leaf",
  draft: "neutral",
  archived: "terracotta",
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
  value: number;
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
          <ButtonLink href="/admin/products/new" variant="primary" size="sm">
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
    </div>
  );
}
