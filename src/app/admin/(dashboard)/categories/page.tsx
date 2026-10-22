import type { Metadata } from "next";
import { connection } from "next/server";
import Link from "next/link";
import { AlertTriangle } from "lucide-react";
import { listAdminCategories } from "@/lib/repositories/admin";
import { CategoryManager } from "@/components/admin/category-manager";
import { FormAlert } from "@/components/admin/field";

export const metadata: Metadata = {
  title: "Categories",
};

type PageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

/**
 * `/admin/categories` — category management (Phase 3).
 *
 * Live data with product counts; creation and edits run through guarded
 * Server Actions inside the client manager. Renames keep the slug so
 * public filter URLs never break; deletion is intentionally absent —
 * categories are disabled instead.
 */
export default async function AdminCategoriesPage({ searchParams }: PageProps) {
  // Always render at request time: the manager shows live DB state, so no
  // prerender or prefetch pass may execute these queries.
  await connection();
  const query = await searchParams;
  const pick = (key: string): string | undefined => {
    const value = query[key];
    return Array.isArray(value) ? value[0] : value;
  };

  const categories = await listAdminCategories();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-serif text-3xl font-semibold text-navy">Categories</h1>
        <p className="mt-1 font-sans text-sm text-ink-muted">
          {categories
            ? `${categories.length} categor${categories.length === 1 ? "y" : "ies"}`
            : "Loading categories…"}
        </p>
      </div>

      {pick("created") ? <FormAlert tone="success">Category created and added to the storefront filters.</FormAlert> : null}
      {pick("saved") ? <FormAlert tone="success">Category changes saved.</FormAlert> : null}

      {!categories ? (
        <div className="rounded-2xl border border-terracotta-700/40 bg-terracotta-700/10 p-6">
          <div className="flex items-start gap-3">
            <AlertTriangle className="mt-0.5 size-5 shrink-0 text-terracotta-700" aria-hidden="true" />
            <div>
              <h2 className="font-sans text-base font-bold text-navy">Categories could not be loaded</h2>
              <p className="mt-1 font-sans text-sm text-ink-muted">
                Check the database connection and reload this page. No changes were made.
              </p>
              <Link
                href="/admin/categories"
                className="mt-3 inline-flex rounded-lg font-sans text-sm font-semibold text-navy underline underline-offset-2 focus-gold"
              >
                Try again
              </Link>
            </div>
          </div>
        </div>
      ) : (
        <CategoryManager categories={categories} />
      )}
    </div>
  );
}
