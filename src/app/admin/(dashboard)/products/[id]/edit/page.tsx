import type { Metadata } from "next";
import { connection } from "next/server";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AlertTriangle, Archive, ArchiveRestore, ChevronLeft } from "lucide-react";
import { getAdminProduct, listCategoryOptions } from "@/lib/repositories/admin";
import { archiveProductAction, restoreProductAction, updateProductAction } from "@/lib/actions/products";
import { isUploadConfigured } from "@/lib/cloudinary/server";
import { Badge } from "@/components/ui/badge";
import { ProductForm } from "@/components/admin/product-form";
import { ImageManager } from "@/components/admin/image-manager";
import { FormAlert } from "@/components/admin/field";
import { ConfirmSubmit } from "@/components/admin/confirm-submit";

export const metadata: Metadata = {
  title: "Edit product",
};

type PageProps = {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

const STATUS_TONE = {
  published: "leaf",
  draft: "neutral",
  archived: "terracotta",
} as const;

/**
 * `/admin/products/[id]/edit` — product editing (Phase 3).
 *
 * Saved data is loaded as the form's baseline (previous values survive a
 * failed save), `expectedUpdatedAt` enables optimistic concurrency, and
 * archived products are read-only until restored. Photos are managed by
 * the separate ImageManager (outside this form — HTML forms never nest).
 */
export default async function EditProductPage({ params, searchParams }: PageProps) {
  // Always render at request time: the saved product is live DB state, so
  // no prerender or prefetch pass may execute these queries.
  await connection();
  const { id } = await params;
  const query = await searchParams;
  const flag = (key: string): boolean => {
    const value = query[key];
    return (Array.isArray(value) ? value[0] : value) === "1";
  };

  const [product, categories] = await Promise.all([
    getAdminProduct(id),
    listCategoryOptions(),
  ]);
  if (!product || !categories) notFound();

  const archived = product.status === "archived";

  return (
    <div className="space-y-6">
      <div>
        <Link
          href="/admin/products"
          className="inline-flex items-center gap-1 rounded font-sans text-sm font-semibold text-ink-muted transition-colors hover:text-navy focus-gold"
        >
          <ChevronLeft className="size-4" aria-hidden="true" />
          All products
        </Link>
        <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="font-serif text-3xl font-semibold text-navy">{product.name}</h1>
            <span className="inline-flex flex-wrap gap-1.5">
              <Badge tone={STATUS_TONE[product.status] ?? "neutral"}>{product.status}</Badge>
              {product.availability === "unavailable" && !archived ? (
                <Badge tone="terracotta">Unavailable</Badge>
              ) : null}
            </span>
          </div>
          {!archived ? (
            <ConfirmSubmit
              action={archiveProductAction}
              fields={{ id: product.id }}
              buttonLabel="Archive product"
              confirmLabel="Confirm archive"
            >
              <Archive className="size-3.5" aria-hidden="true" />
            </ConfirmSubmit>
          ) : null}
        </div>
      </div>

      {flag("created") ? <FormAlert tone="success">Product created. It is currently {product.status}.</FormAlert> : null}
      {flag("saved") ? <FormAlert tone="success">Changes saved.</FormAlert> : null}
      {flag("restored") ? <FormAlert tone="success">Product restored as a draft. Publish it when you are ready.</FormAlert> : null}
      {flag("opError") ? (
        <FormAlert tone="error">
          That change could not be saved. Please check your connection and try again.
        </FormAlert>
      ) : null}

      {archived ? (
        <div className="rounded-2xl border border-terracotta-700/40 bg-terracotta-700/10 p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-start gap-3">
              <AlertTriangle className="mt-0.5 size-5 shrink-0 text-terracotta-700" aria-hidden="true" />
              <div>
                <h2 className="font-sans text-base font-bold text-navy">This product is archived</h2>
                <p className="mt-1 font-sans text-sm text-ink-muted">
                  Archived products are hidden everywhere on the storefront and cannot be
                  edited. Restore it as a draft to make changes.
                </p>
              </div>
            </div>
            <form action={restoreProductAction}>
              <input type="hidden" name="id" value={product.id} />
              <button
                type="submit"
                className="inline-flex min-h-11 items-center gap-2 rounded-full bg-navy px-5 font-sans text-sm font-semibold text-cream transition-colors hover:bg-navy-800 focus-gold"
              >
                <ArchiveRestore className="size-4" aria-hidden="true" />
                Restore as draft
              </button>
            </form>
          </div>
        </div>
      ) : null}

      <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <div className="rounded-2xl border border-border bg-surface p-5 md:p-7">
          <ProductForm
            mode="edit"
            action={updateProductAction}
            categories={categories}
            product={product}
            disabled={archived}
          />
        </div>
        <div className="rounded-2xl border border-border bg-surface p-5 md:p-7">
          <ImageManager
            productId={product.id}
            productName={product.name}
            images={product.images}
            uploadsConfigured={isUploadConfigured()}
          />
        </div>
      </div>
    </div>
  );
}
