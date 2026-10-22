"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { recordAudit } from "@/lib/auth/audit";
import { requireActionAdmin } from "@/lib/auth/guard";
import { connectDatabase, logDatabaseError } from "@/lib/db/mongoose";
import { CategoryModel } from "@/models/category";
import { ProductModel } from "@/models/product";
import { invalidateCatalogue } from "@/lib/server/invalidate";
import { productFormSchema, type ProductFormInput } from "@/lib/validations/admin";
import { slugify } from "@/lib/utils";
import type { ProductStatus } from "@/types";

/**
 * Product management server actions (Phase 3).
 *
 * Contract applied by every mutation:
 *   authenticate (independent guard) → Zod-validate → allowlisted fields
 *   only → business rules (category exists, slug unique, optimistic
 *   concurrency) → atomic write → audit → storefront invalidation → safe
 *   feedback.
 *
 * Money arrives already converted to integer cents by `moneyInputSchema`;
 * raw form prices never reach the model. Status transitions supported:
 * draft ⇄ published, archive, restore (archived → draft). Products are
 * never deleted, so future order history keeps its references.
 */

export interface ProductActionResult {
  ok: boolean;
  error?: string;
  fieldErrors?: Record<string, string>;
  /** True when a concurrent edit was detected (caller should reload). */
  conflict?: boolean;
}

const UNAUTHORIZED: ProductActionResult = {
  ok: false,
  error: "Your session has expired. Please sign in again.",
};

function parseForm(formData: FormData): { input: ProductFormInput } | { fieldErrors: Record<string, string> } {
  const parsed = productFormSchema.safeParse({
    name: formData.get("name"),
    slug: formData.get("slug") ?? "",
    categoryId: formData.get("categoryId"),
    shortDescription: formData.get("shortDescription") ?? "",
    description: formData.get("description"),
    price: formData.get("price") ?? "",
    variants: readVariants(formData),
    status: formData.get("status"),
    availability: formData.get("availability"),
    featured: formData.get("featured") === "on" || formData.get("featured") === "true",
    sortOrder: formData.get("sortOrder") ?? "0",
    tags: formData.get("tags") ?? "",
    expectedUpdatedAt: formData.get("expectedUpdatedAt") ?? undefined,
  });
  if (parsed.success) return { input: parsed.data };
  const fieldErrors: Record<string, string> = {};
  for (const issue of parsed.error.issues) {
    fieldErrors[String(issue.path[0] ?? "form")] ??= issue.message;
  }
  return { fieldErrors };
}

/** Repeatable `variants[i].name` / `variants[i].price` rows. */
function readVariants(formData: FormData): Array<{ name: string; price: string }> {
  const names = formData.getAll("variantName").map(String);
  const prices = formData.getAll("variantPrice").map(String);
  return names
    .map((name, index) => ({ name, price: prices[index] ?? "" }))
    .filter((variant) => variant.name.trim() !== "");
}

async function ensureCategoryExists(id: string): Promise<boolean> {
  await connectDatabase();
  return (await CategoryModel.exists({ _id: id })) !== null;
}

export async function createProductAction(
  _previous: ProductActionResult,
  formData: FormData,
): Promise<ProductActionResult> {
  const guard = await requireActionAdmin();
  if (!guard.ok) return UNAUTHORIZED;

  const parsed = parseForm(formData);
  if ("fieldErrors" in parsed) return { ok: false, fieldErrors: parsed.fieldErrors };
  const input = parsed.input;

  try {
    await connectDatabase();

    if (!(await ensureCategoryExists(input.categoryId))) {
      return { ok: false, fieldErrors: { categoryId: "Choose an existing category." } };
    }

    const slug = input.slug || slugify(input.name);
    if (!slug) {
      return { ok: false, fieldErrors: { slug: "Could not derive a slug from this name." } };
    }
    if (await ProductModel.exists({ slug })) {
      return { ok: false, fieldErrors: { slug: "This address is already used by another product." } };
    }

    const record = await ProductModel.create({
      name: input.name,
      slug,
      categoryId: input.categoryId,
      shortDescription: input.shortDescription,
      description: input.description,
      priceCents: input.price,
      variants: input.variants.map((variant) => ({
        name: variant.name,
        priceCents: variant.price,
      })),
      status: input.status,
      availability: input.availability,
      featured: input.featured,
      sortOrder: input.sortOrder,
      tags: input.tags,
    });

    await recordAudit({
      event: "product.created",
      outcome: "success",
      adminId: String(guard.admin._id),
      email: guard.admin.email,
      target: { type: "product", id: String(record._id), label: record.name },
      detail: `Created as ${record.status}`,
    });
    invalidateCatalogue();
    redirect(`/admin/products/${String(record._id)}/edit?created=1`);
  } catch (error) {
    if (isRedirect(error)) throw error;
    logDatabaseError("admin-product-create", error);
    if (isDuplicateKey(error)) {
      return { ok: false, fieldErrors: { slug: "This address is already used by another product." } };
    }
    return { ok: false, error: "The product could not be saved. Please try again." };
  }
}

export async function updateProductAction(
  _previous: ProductActionResult,
  formData: FormData,
): Promise<ProductActionResult> {
  const guard = await requireActionAdmin();
  if (!guard.ok) return UNAUTHORIZED;

  const id = String(formData.get("id") ?? "");
  if (!/^[0-9a-fA-F]{24}$/.test(id)) {
    return { ok: false, error: "That product could not be found." };
  }

  const parsed = parseForm(formData);
  if ("fieldErrors" in parsed) return { ok: false, fieldErrors: parsed.fieldErrors };
  const input = parsed.input;
  const expectedRaw = input.expectedUpdatedAt;
  if (!expectedRaw) return { ok: false, conflict: true };

  try {
    await connectDatabase();

    const existing = await ProductModel.findById(id).lean();
    if (!existing) return { ok: false, error: "That product could not be found." };

    // Optimistic concurrency: refuse to overwrite a newer save.
    const expected = new Date(expectedRaw);
    if (Number.isNaN(expected.getTime()) || existing.updatedAt?.getTime() !== expected.getTime()) {
      return { ok: false, conflict: true };
    }

    if (!(await ensureCategoryExists(input.categoryId))) {
      return { ok: false, fieldErrors: { categoryId: "Choose an existing category." } };
    }

    // Slug policy: blank keeps the current address (stable public URLs);
    // an explicit change is validated, unique, and records a redirect.
    let nextSlug = existing.slug;
    if (input.slug && input.slug !== existing.slug) {
      nextSlug = input.slug;
      if (await ProductModel.exists({ slug: nextSlug, _id: { $ne: existing._id } })) {
        return { ok: false, fieldErrors: { slug: "This address is already used by another product." } };
      }
    }

    const slugHistory =
      nextSlug === existing.slug
        ? existing.previousSlugs
        : [
            ...[...new Set([...(existing.previousSlugs ?? []), existing.slug])].slice(-5),
          ];

    const statusChanged = existing.status !== input.status;

    const result = await ProductModel.updateOne(
      // Concurrent-edit guard lives in the filter itself.
      { _id: existing._id, updatedAt: existing.updatedAt },
      {
        $set: {
          name: input.name,
          slug: nextSlug,
          previousSlugs: slugHistory,
          categoryId: input.categoryId,
          shortDescription: input.shortDescription,
          description: input.description,
          priceCents: input.price,
          variants: input.variants.map((variant) => ({
            name: variant.name,
            priceCents: variant.price,
          })),
          status: input.status,
          availability: input.availability,
          featured: input.featured,
          sortOrder: input.sortOrder,
          tags: input.tags,
        },
      },
    );

    if (result.matchedCount === 0) return { ok: false, conflict: true };

    await recordAudit({
      event: statusChanged ? "product.status_changed" : "product.updated",
      outcome: "success",
      adminId: String(guard.admin._id),
      email: guard.admin.email,
      target: { type: "product", id: String(existing._id), label: input.name },
      detail: statusChanged
        ? `${existing.status} → ${input.status}`
        : nextSlug !== existing.slug
          ? "Updated (slug changed, old address redirects)"
          : "Updated",
    });
    invalidateCatalogue();
    redirect(`/admin/products/${String(existing._id)}/edit?saved=1`);
  } catch (error) {
    if (isRedirect(error)) throw error;
    logDatabaseError("admin-product-update", error);
    if (isDuplicateKey(error)) {
      return { ok: false, fieldErrors: { slug: "This address is already used by another product." } };
    }
    return { ok: false, error: "Your changes could not be saved. Please try again." };
  }
}

/**
 * Quick status transitions used by direct `<form action>` bindings, so
 * they return void and communicate failures through a `?opError=1` query
 * flag (POST-redirect-GET) that the receiving page renders as a banner.
 */
export async function archiveProductAction(formData: FormData): Promise<void> {
  return changeStatus(formData, {
    to: "archived",
    event: "product.archived",
    successPath: (id) => `/admin/products?archived=${encodeURIComponent(id)}`,
    errorPath: () => "/admin/products?opError=1",
    label: "Product archived.",
  });
}

export async function restoreProductAction(formData: FormData): Promise<void> {
  return changeStatus(formData, {
    to: "draft",
    event: "product.status_changed",
    successPath: (id) => `/admin/products/${id}/edit?restored=1`,
    errorPath: (id) => `/admin/products/${id}/edit?opError=1`,
    label: "Product restored as a draft.",
  });
}

async function changeStatus(
  formData: FormData,
  options: {
    to: Exclude<ProductStatus, "published"> | "draft";
    event: "product.archived" | "product.status_changed";
    successPath: (id: string) => string;
    errorPath: (id: string) => string;
    label: string;
  },
): Promise<void> {
  const guard = await requireActionAdmin();
  const rawId = String(formData.get("id") ?? "");
  if (!guard.ok) redirect("/admin/login");
  if (!/^[0-9a-fA-F]{24}$/.test(rawId)) redirect(options.errorPath(rawId));

  try {
    await connectDatabase();
    const existing = await ProductModel.findById(rawId).select({ name: 1, status: 1 }).lean();
    if (!existing) redirect(options.errorPath(rawId));
    if (existing.status === options.to) {
      // Idempotent: nothing to change, but feedback stays honest.
      redirect(options.successPath(String(existing._id)));
    }

    await ProductModel.updateOne(
      { _id: existing._id, status: { $ne: options.to } },
      { $set: { status: options.to } },
    ).exec();

    await recordAudit({
      event: options.event,
      outcome: "success",
      adminId: String(guard.admin._id),
      email: guard.admin.email,
      target: { type: "product", id: String(existing._id), label: existing.name },
      detail: `${existing.status} → ${options.to}`,
    });
    invalidateCatalogue();
    redirect(options.successPath(String(existing._id)));
  } catch (error) {
    if (isRedirect(error)) throw error;
    logDatabaseError("admin-product-status", error);
    redirect(options.errorPath(rawId));
  }
}

/** Quick availability toggle from the product list. */
export async function setAvailabilityAction(formData: FormData): Promise<void> {
  const guard = await requireActionAdmin();
  const rawId = String(formData.get("id") ?? "");
  const availability = formData.get("availability") === "available" ? "available" : "unavailable";
  if (!guard.ok) redirect("/admin/login");
  if (!/^[0-9a-fA-F]{24}$/.test(rawId)) redirect("/admin/products?opError=1");

  try {
    await connectDatabase();
    const existing = await ProductModel.findById(rawId).select({ name: 1, availability: 1 }).lean();
    if (!existing) redirect("/admin/products?opError=1");

    await ProductModel.updateOne({ _id: existing._id }, { $set: { availability } }).exec();
    await recordAudit({
      event: "product.updated",
      outcome: "success",
      adminId: String(guard.admin._id),
      email: guard.admin.email,
      target: { type: "product", id: String(existing._id), label: existing.name },
      detail: `${existing.availability} → ${availability}`,
    });
    invalidateCatalogue();
    revalidatePath("/admin/products");
  } catch (error) {
    if (isRedirect(error)) throw error;
    logDatabaseError("admin-product-availability", error);
    redirect("/admin/products?opError=1");
  }
}

/* ── shared error helpers ───────────────────────────────────────────── */

function isDuplicateKey(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === 11000
  );
}

function isRedirect(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "digest" in error &&
    typeof (error as { digest?: unknown }).digest === "string" &&
    (error as { digest: string }).digest.startsWith("NEXT_REDIRECT")
  );
}
