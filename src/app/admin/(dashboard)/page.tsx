import type { Metadata } from "next";
import { connection } from "next/server";
import Link from "next/link";
import { AlertTriangle, FolderTree, PackagePlus } from "lucide-react";
import { getAdminInsights, getDashboardStats } from "@/lib/repositories/admin";
import { ButtonLink } from "@/components/ui/button";
import { AdminViewSwitch, type AdminDashboardView } from "@/components/admin/admin-view-switch";
import { AnalyticsDashboard, SimpleDashboard } from "@/components/admin/dashboard-views";

export const metadata: Metadata = {
  title: "Dashboard",
};

type PageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

/**
 * `/admin` — the owner's home screen (Phase 3; refreshed in Phase 8).
 *
 * Two views over the same live data:
 *
 *  - **Simple** (default) answers "what needs me today": orders to accept,
 *    work in progress, cash to collect, today's orders, and whether the
 *    menu is actually sellable.
 *  - **Analytics** answers "how is the week going": a seven-day bar chart,
 *    a completion ring, status bars, best sellers and collected money.
 *
 * The view is a URL parameter, so it survives reloads and can be
 * bookmarked. Every number comes from a real aggregate; nothing is
 * estimated, and no target or trend is invented.
 */
export default async function AdminDashboardPage({ searchParams }: PageProps) {
  // Always render at request time: the stats are live counts, so no
  // prerender or prefetch pass may execute them.
  await connection();

  const params = await searchParams;
  const raw = params.view;
  const requested = Array.isArray(raw) ? raw[raw.length - 1] : raw;
  const view: AdminDashboardView = requested === "analytics" ? "analytics" : "simple";

  const [stats, insights] = await Promise.all([getDashboardStats(), getAdminInsights()]);

  if (!stats || !insights) {
    return (
      <div className="space-y-4">
        <h1 className="font-serif text-3xl font-semibold text-navy">Dashboard</h1>
        <div className="rounded-2xl border border-terracotta-700/40 bg-terracotta-700/10 p-6">
          <div className="flex items-start gap-3">
            <AlertTriangle className="mt-0.5 size-5 shrink-0 text-terracotta-700" aria-hidden="true" />
            <div>
              <h2 className="font-sans text-base font-bold text-navy">
                Your dashboard could not be loaded
              </h2>
              <p className="mt-1 font-sans text-sm text-ink-muted">
                The store data is unavailable right now. Check the database connection and reload this
                page. No changes were made.
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
  const today = new Date().toLocaleDateString("en-CA", {
    weekday: "long",
    month: "long",
    day: "numeric",
  });

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="font-sans text-xs font-semibold uppercase tracking-wide text-ink-muted">
            {today}
          </p>
          <h1 className="mt-1 font-serif text-3xl font-semibold text-navy">Dashboard</h1>
          <p className="mt-1 font-sans text-sm text-ink-muted">
            {view === "simple"
              ? "Here is what needs you today."
              : "Here is how the store is doing."}
          </p>
        </div>
        <AdminViewSwitch view={view} />
      </div>

      {isEmpty ? (
        <div className="rounded-2xl border border-border bg-surface p-8 text-center">
          <h2 className="font-serif text-xl font-semibold text-navy">Welcome to your dashboard</h2>
          <p className="mx-auto mt-2 max-w-md font-sans text-sm text-ink-muted">
            Nothing has been set up yet. Add your categories first, then create your first dish. You
            can save a dish as a draft until you are ready to publish it.
          </p>
          <div className="mt-5 flex flex-wrap justify-center gap-2">
            <ButtonLink href="/admin/categories" variant="primary" size="sm">
              <FolderTree className="size-4" aria-hidden="true" />
              Manage categories
            </ButtonLink>
            <ButtonLink href="/admin/products/new" variant="outline" size="sm">
              <PackagePlus className="size-4" aria-hidden="true" />
              Add a dish
            </ButtonLink>
          </div>
        </div>
      ) : view === "analytics" ? (
        <AnalyticsDashboard stats={stats} insights={insights} />
      ) : (
        <SimpleDashboard stats={stats} insights={insights} />
      )}
    </div>
  );
}
