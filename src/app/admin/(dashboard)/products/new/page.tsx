import type { Metadata } from "next";
import { connection } from "next/server";
import Link from "next/link";
import { AlertTriangle, FolderTree } from "lucide-react";
import { listCategoryOptions } from "@/lib/repositories/admin";
import { createProductAction } from "@/lib/actions/products";
import { ButtonLink } from "@/components/ui/button";
import { ProductForm } from "@/components/admin/product-form";

export const metadata: Metadata = {
  title: "Add product",
};

/**
 * `/admin/products/new` — product creation (Phase 3).
 *
 * Nothing is pre-filled with invented data: the owner provides every
 * value, and a product can be saved as a draft without a price.
 */
export default async function NewProductPage() {
  // Always render at request time: the category list is live DB state, so
  // no prerender or prefetch pass may execute this query.
  await connection();
  const categories = await listCategoryOptions();

  if (!categories) {
    return (
      <div className="space-y-4">
        <h1 className="font-serif text-3xl font-semibold text-navy">Add product</h1>
        <div className="rounded-2xl border border-terracotta-700/40 bg-terracotta-700/10 p-6">
          <div className="flex items-start gap-3">
            <AlertTriangle className="mt-0.5 size-5 shrink-0 text-terracotta-700" aria-hidden="true" />
            <div>
              <h2 className="font-sans text-base font-bold text-navy">Categories could not be loaded</h2>
              <p className="mt-1 font-sans text-sm text-ink-muted">
                Check the database connection and reload this page. Nothing was saved.
              </p>
              <Link
                href="/admin/products/new"
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

  if (categories.length === 0) {
    return (
      <div className="space-y-4">
        <h1 className="font-serif text-3xl font-semibold text-navy">Add product</h1>
        <div className="rounded-2xl border border-border bg-surface p-8 text-center">
          <FolderTree className="mx-auto size-8 text-ink-muted" aria-hidden="true" />
          <h2 className="mt-3 font-sans text-base font-bold text-navy">
            Create a category first
          </h2>
          <p className="mx-auto mt-1 max-w-md font-sans text-sm text-ink-muted">
            Every product belongs to a category. Add one, then come back to create your
            product.
          </p>
          <ButtonLink href="/admin/categories" variant="primary" size="sm" className="mt-4">
            Manage categories
          </ButtonLink>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-serif text-3xl font-semibold text-navy">Add product</h1>
        <p className="mt-1 font-sans text-sm text-ink-muted">
          Save as a draft any time. Nothing appears to customers until you publish.
        </p>
      </div>
      <div className="rounded-2xl border border-border bg-surface p-5 md:p-7">
        <ProductForm mode="create" action={createProductAction} categories={categories} />
      </div>
    </div>
  );
}
