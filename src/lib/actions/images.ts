"use server";

import { recordAudit } from "@/lib/auth/audit";
import { requireActionAdmin } from "@/lib/auth/guard";
import {
  MAX_IMAGE_BYTES,
  destroyAsset,
  isUploadConfigured,
  signUpload,
  verifyUploadedAsset,
  type UploadSignature,
} from "@/lib/cloudinary/server";
import { connectDatabase, logDatabaseError } from "@/lib/db/mongoose";
import { ProductModel } from "@/models/product";
import { invalidateCatalogue } from "@/lib/server/invalidate";
import {
  cloudinaryPublicIdSchema,
  imageAltSchema,
} from "@/lib/validations/admin";
import { Types } from "mongoose";

/**
 * Product image actions (Phase 3).
 *
 * Trust model:
 * - `requestUploadSignature` requires a live session; parameters are fixed
 *   server-side (folder, no overwrite, unique filename, fresh timestamp).
 * - `attachImageAction` NEVER trusts client metadata: the asset is
 *   re-fetched from Cloudinary's Admin API and validated (folder, format,
 *   ≤5 MB, dimensions, delivery URL) before the image DTO is built from
 *   THAT response. A forged client reply cannot attach foreign assets.
 * - `saveImagesAction` can only permute/annotate images already on the
 *   product (publicId sets must match exactly), so it cannot smuggle in
 *   unverified URLs.
 * - `removeImageAction` pulls the reference first, then destroys the
 *   Cloudinary asset only when no OTHER product references it.
 */

export interface ImageActionResult {
  ok: boolean;
  error?: string;
  fieldErrors?: Record<string, string>;
}

const UNAUTHORIZED: ImageActionResult = {
  ok: false,
  error: "Your session has expired. Please sign in again.",
};

const NOT_CONFIGURED: ImageActionResult = {
  ok: false,
  error: "Image uploads are not configured on this deployment yet.",
};

/** Issue short-lived signed upload parameters (session-guarded). */
export async function requestUploadSignatureAction(): Promise<
  { ok: true; signature: UploadSignature } | ImageActionResult
> {
  const guard = await requireActionAdmin();
  if (!guard.ok) return UNAUTHORIZED;
  if (!isUploadConfigured()) return NOT_CONFIGURED;
  try {
    return { ok: true, signature: signUpload() };
  } catch {
    return NOT_CONFIGURED;
  }
}

/**
 * Verify a freshly uploaded asset and attach it to a product.
 * formData: productId, publicId, alt.
 */
export async function attachImageAction(formData: FormData): Promise<ImageActionResult> {
  const guard = await requireActionAdmin();
  if (!guard.ok) return UNAUTHORIZED;
  if (!isUploadConfigured()) return NOT_CONFIGURED;

  const productId = String(formData.get("productId") ?? "");
  const publicId = cloudinaryPublicIdSchema.safeParse(formData.get("publicId"));
  const alt = imageAltSchema.safeParse(formData.get("alt") ?? "");

  if (!/^[0-9a-fA-F]{24}$/.test(productId)) {
    return { ok: false, error: "That product could not be found." };
  }
  if (!publicId.success) {
    return { ok: false, fieldErrors: { alt: "The uploaded image could not be verified." } };
  }
  if (!alt.success) {
    return {
      ok: false,
      fieldErrors: { alt: alt.error.issues[0]?.message ?? "Alt text is required." },
    };
  }

  try {
    const verified = await verifyUploadedAsset(publicId.data);
    if (verified === "not_configured") return NOT_CONFIGURED;
    if (verified !== "not_found" && verified !== "network") {
      // Invalid asset (wrong folder/format/size): clean it up so failed
      // uploads cannot accumulate. Never destroy a referenced asset.
      if (await isUnreferenced(publicId.data)) void destroyAsset(publicId.data);
    }
    if (typeof verified === "string") {
      return {
        ok: false,
        error:
          verified === "not_found"
            ? "The upload could not be found on the image service. Please try again."
            : verified === "too_large"
              ? `Images must be ${Math.round(MAX_IMAGE_BYTES / (1024 * 1024))} MB or smaller.`
              : verified === "invalid_type"
                ? "Upload a JPEG, PNG or WebP image."
                : verified === "wrong_folder"
                  ? "That image is outside the allowed upload area."
                  : "The image could not be verified. Please try again.",
      };
    }

    await connectDatabase();
    const product = await ProductModel.findById(productId).select({ _id: 1, name: 1 }).lean();
    if (!product) return { ok: false, error: "That product could not be found." };

    // Atomic size guard: never exceed 10 images even under concurrent saves.
    const update = await ProductModel.updateOne(
      { _id: product._id, $expr: { $lt: [{ $size: { $ifNull: ["$images", []] } }, 10] } },
      {
        $push: {
          images: {
            secureUrl: verified.secureUrl,
            publicId: verified.publicId,
            alt: alt.data,
            sortOrder: 9999, // normalised below to append at the end
            width: verified.width,
            height: verified.height,
          },
        },
      },
    );
    if (update.matchedCount === 0) {
      // Either the product vanished or it already has 10 images.
      if (await isUnreferenced(verified.publicId)) void destroyAsset(verified.publicId);
      return { ok: false, error: "This product already has the maximum of 10 images." };
    }

    await normaliseOrder(product._id);
    await recordAudit({
      event: "image.attached",
      outcome: "success",
      adminId: String(guard.admin._id),
      email: guard.admin.email,
      target: { type: "product", id: String(product._id), label: product.name },
      detail: "Image verified and attached",
    });
    invalidateCatalogue();
    return { ok: true };
  } catch (error) {
    logDatabaseError("admin-image-attach", error);
    return { ok: false, error: "The image could not be attached. Please try again." };
  }
}

/**
 * Replace the image list for a product: reorder, renumber, edit alt text,
 * set the primary image (index 0), remove entries. The submitted publicId
 * SET must equal the stored set exactly, so nothing unverified can enter.
 * formData: productId, plus repeated publicId[i] / alt[i] fields in order.
 */
export async function saveImagesAction(formData: FormData): Promise<ImageActionResult> {
  const guard = await requireActionAdmin();
  if (!guard.ok) return UNAUTHORIZED;

  const productId = String(formData.get("productId") ?? "");
  if (!/^[0-9a-fA-F]{24}$/.test(productId)) {
    return { ok: false, error: "That product could not be found." };
  }

  const publicIds = formData.getAll("publicId").map(String);
  const alts = formData.getAll("alt").map(String);
  if (publicIds.length !== alts.length || publicIds.length > 10) {
    return { ok: false, error: "The image list could not be saved. Reload and try again." };
  }

  const parsedAlts: string[] = [];
  for (const alt of alts) {
    const parsed = imageAltSchema.safeParse(alt);
    if (!parsed.success) {
      return {
        ok: false,
        fieldErrors: {
          alt: parsed.error.issues[0]?.message ?? "Each image needs alt text.",
        },
      };
    }
    parsedAlts.push(parsed.data);
  }

  try {
    await connectDatabase();
    const product = await ProductModel.findById(productId).select({ images: 1, name: 1 }).lean();
    if (!product) return { ok: false, error: "That product could not be found." };

    const stored = new Set(product.images.map((image) => image.publicId).filter(Boolean));
    const submitted = new Set(publicIds);
    if (stored.size !== submitted.size || [...submitted].some((id) => !stored.has(id))) {
      return { ok: false, error: "The images changed elsewhere. Reload and try again." };
    }

    const byPublicId = new Map(product.images.map((image) => [image.publicId ?? "", image]));
    const ordered = publicIds.map((publicId, index) => {
      const existing = byPublicId.get(publicId);
      if (!existing) return null;
      return {
        secureUrl: existing.secureUrl,
        ...(existing.publicId ? { publicId: existing.publicId } : {}),
        alt: parsedAlts[index],
        sortOrder: index,
        ...(existing.width ? { width: existing.width } : {}),
        ...(existing.height ? { height: existing.height } : {}),
      };
    });
    if (ordered.some((entry) => entry === null)) {
      return { ok: false, error: "The images changed elsewhere. Reload and try again." };
    }

    await ProductModel.updateOne({ _id: product._id }, { $set: { images: ordered } }).exec();

    await recordAudit({
      event: "image.updated",
      outcome: "success",
      adminId: String(guard.admin._id),
      email: guard.admin.email,
      target: { type: "product", id: String(product._id), label: product.name },
      detail: `Saved ${ordered.length} image${ordered.length === 1 ? "" : "s"} (order and alt text)`,
    });
    invalidateCatalogue();
    return { ok: true };
  } catch (error) {
    logDatabaseError("admin-images-save", error);
    return { ok: false, error: "The images could not be saved. Please try again." };
  }
}

/** Detach an image from a product; destroy the asset only when orphaned. */
export async function removeImageAction(formData: FormData): Promise<ImageActionResult> {
  const guard = await requireActionAdmin();
  if (!guard.ok) return UNAUTHORIZED;

  const productId = String(formData.get("productId") ?? "");
  const publicId = String(formData.get("publicId") ?? "");
  if (!/^[0-9a-fA-F]{24}$/.test(productId) || !publicId) {
    return { ok: false, error: "That image could not be found." };
  }

  try {
    await connectDatabase();
    const product = await ProductModel.findById(productId).select({ name: 1, images: 1 }).lean();
    if (!product) return { ok: false, error: "That product could not be found." };

    const result = await ProductModel.updateOne(
      { _id: product._id },
      { $pull: { images: { publicId } } },
    );
    if (result.matchedCount === 0) return { ok: false, error: "That image could not be found." };

    // Destroy the Cloudinary asset only when nothing references it.
    let cleanup: "destroyed" | "deferred" | "shared" = "shared";
    if (publicId) {
      const shared = await ProductModel.exists({
        "images.publicId": publicId,
        _id: { $ne: product._id },
      });
      if (!shared) {
        cleanup = (await destroyAsset(publicId)) ? "destroyed" : "deferred";
      }
    }

    await recordAudit({
      event: "image.removed",
      outcome: "success",
      adminId: String(guard.admin._id),
      email: guard.admin.email,
      target: { type: "product", id: String(product._id), label: product.name },
      detail:
        cleanup === "deferred"
          ? "Detached; asset cleanup deferred (no other references)"
          : cleanup === "destroyed"
            ? "Detached and asset deleted"
            : "Detached; asset kept (referenced elsewhere)",
    });
    invalidateCatalogue();
    return { ok: true };
  } catch (error) {
    logDatabaseError("admin-image-remove", error);
    return { ok: false, error: "The image could not be removed. Please try again." };
  }
}

/* ── internals ──────────────────────────────────────────────────────── */

async function isUnreferenced(publicId: string): Promise<boolean> {
  try {
    const referenced = await ProductModel.exists({ "images.publicId": publicId });
    return referenced === null;
  } catch {
    // On doubt, keep the asset (never destroy something possibly in use).
    return false;
  }
}

/** Rewrite sortOrder to array position after an append. */
async function normaliseOrder(productId: Types.ObjectId): Promise<void> {
  const product = await ProductModel.findById(productId).select({ images: 1 }).lean();
  if (!product) return;
  const ordered = [...product.images]
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((image, index) => ({
      secureUrl: image.secureUrl,
      ...(image.publicId ? { publicId: image.publicId } : {}),
      alt: image.alt,
      sortOrder: index,
      ...(image.width ? { width: image.width } : {}),
      ...(image.height ? { height: image.height } : {}),
    }));
  await ProductModel.updateOne({ _id: productId }, { $set: { images: ordered } }).exec();
}
