"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { recordAudit } from "@/lib/auth/audit";
import { requireActionAdmin } from "@/lib/auth/guard";
import { connectDatabase, logDatabaseError } from "@/lib/db/mongoose";
import { CategoryModel } from "@/models/category";
import { ProductModel } from "@/models/product";
import { invalidateCatalogue } from "@/lib/server/invalidate";
import { categoryFormSchema, type CategoryFormInput } from "@/lib/validations/admin";
import { slugify } from "@/lib/utils";

/**
 * Category management server actions (Phase 3).
 *
 * Policy decisions encoded here:
 * - Slugs are created once (from the name, or an explicit value) and are
 *   NOT changed on rename: public filter URLs and chips stay stable while
 *   display names evolve.
 * - Categories are disabled (`isActive: false`), never deleted: products
 *   keep their references, and public reads already constrain listings to
 *   active categories (see src/lib/repositories/catalogue.ts).
 * - Duplicate names/slugs are rejected gracefully (pre-checked, plus the
 *   unique index as the concurrency backstop).
 */

export interface CategoryActionResult {
  ok: boolean;
  error?: string;
  fieldErrors?: Record<string, string>;
}

const UNAUTHORIZED: CategoryActionResult = {
  ok: false,
  error: "Your session has expired. Please sign in again.",
};

function parseForm(formData: FormData): CategoryFormInput | { fieldErrors: Record<string, string> } {
  const parsed = categoryFormSchema.safeParse({
    name: formData.get("name"),
    slug: formData.get("slug") ?? "",
    description: formData.get("description") ?? "",
    sortOrder: formData.get("sortOrder") ?? "0",
    isActive: formData.get("isActive") === "on" || formData.get("isActive") === "true",
  });
  if (parsed.success) return parsed.data;
  const fieldErrors: Record<string, string> = {};
  for (const issue of parsed.error.issues) {
    fieldErrors[String(issue.path[0] ?? "form")] ??= issue.message;
  }
  return { fieldErrors };
}

export async function createCategoryAction(
  _previous: CategoryActionResult,
  formData: FormData,
): Promise<CategoryActionResult> {
  const guard = await requireActionAdmin();
  if (!guard.ok) return UNAUTHORIZED;

  const parsed = parseForm(formData);
  if ("fieldErrors" in parsed) return { ok: false, fieldErrors: parsed.fieldErrors };

  const slug = parsed.slug || slugify(parsed.name);
  if (!slug) {
    return { ok: false, fieldErrors: { name: "Could not derive a slug from this name." } };
  }

  try {
    await connectDatabase();

    const [nameClash, slugClash] = await Promise.all([
      CategoryModel.exists({ name: parsed.name }),
      CategoryModel.exists({ slug }),
    ]);
    if (nameClash || slugClash) {
      return {
        ok: false,
        fieldErrors: { name: "A category with this name already exists." },
      };
    }

    const record = await CategoryModel.create({
      name: parsed.name,
      slug,
      description: parsed.description,
      sortOrder: parsed.sortOrder,
      isActive: parsed.isActive,
    });

    await recordAudit({
      event: "category.created",
      outcome: "success",
      adminId: String(guard.admin._id),
      email: guard.admin.email,
      target: { type: "category", id: String(record._id), label: record.name },
      detail: `Slug ${slug}`,
    });
    invalidateCatalogue();
    revalidatePath("/admin/categories");
    redirect("/admin/categories?created=1");
  } catch (error) {
    if (isRedirect(error)) throw error;
    logDatabaseError("admin-category-create", error);
    if (isDuplicateKey(error)) {
      return { ok: false, fieldErrors: { name: "A category with this name already exists." } };
    }
    return { ok: false, error: "The category could not be saved. Please try again." };
  }
}

export async function updateCategoryAction(
  _previous: CategoryActionResult,
  formData: FormData,
): Promise<CategoryActionResult> {
  const guard = await requireActionAdmin();
  if (!guard.ok) return UNAUTHORIZED;

  const id = String(formData.get("id") ?? "");
  if (!/^[0-9a-fA-F]{24}$/.test(id)) {
    return { ok: false, error: "That category could not be found." };
  }

  const parsed = parseForm(formData);
  if ("fieldErrors" in parsed) return { ok: false, fieldErrors: parsed.fieldErrors };

  try {
    await connectDatabase();
    const existing = await CategoryModel.findById(id).lean();
    if (!existing) return { ok: false, error: "That category could not be found." };

    const nameClash = await CategoryModel.exists({ name: parsed.name, _id: { $ne: existing._id } });
    if (nameClash) {
      return { ok: false, fieldErrors: { name: "A category with this name already exists." } };
    }

    const visibilityChanged = existing.isActive !== parsed.isActive;

    await CategoryModel.updateOne(
      { _id: existing._id },
      {
        $set: {
          name: parsed.name,
          // Slug intentionally untouched: public URLs stay stable.
          description: parsed.description,
          sortOrder: parsed.sortOrder,
          isActive: parsed.isActive,
        },
      },
    ).exec();

    await recordAudit({
      event: visibilityChanged ? "category.visibility_changed" : "category.updated",
      outcome: "success",
      adminId: String(guard.admin._id),
      email: guard.admin.email,
      target: { type: "category", id: String(existing._id), label: parsed.name },
      detail: visibilityChanged
        ? `Visibility ${existing.isActive ? "on" : "off"} → ${parsed.isActive ? "on" : "off"}`
        : "Updated",
    });
    invalidateCatalogue();
    revalidatePath("/admin/categories");
    redirect("/admin/categories?saved=1");
  } catch (error) {
    if (isRedirect(error)) throw error;
    logDatabaseError("admin-category-update", error);
    return { ok: false, error: "The category could not be saved. Please try again." };
  }
}

/**
 * Count products currently assigned to a category (for the disable
 * confirmation copy). Read is guarded by the caller's action/page context.
 */
export async function countProductsInCategory(categoryId: string): Promise<number | null> {
  const guard = await requireActionAdmin();
  if (!guard.ok || !/^[0-9a-fA-F]{24}$/.test(categoryId)) return null;
  try {
    await connectDatabase();
    return await ProductModel.countDocuments({ categoryId });
  } catch (error) {
    logDatabaseError("admin-category-count", error);
    return null;
  }
}

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
