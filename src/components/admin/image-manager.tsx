"use client";

import Image from "next/image";
import { useRouter } from "next/navigation";
import { useCallback, useRef, useState, useTransition } from "react";
import { AlertTriangle, ArrowDown, ArrowUp, CheckCircle2, ImagePlus, Loader2, Star, Trash2 } from "lucide-react";
import {
  attachImageAction,
  removeImageAction,
  requestUploadSignatureAction,
  saveImagesAction,
} from "@/lib/actions/images";
import { MAX_IMAGE_BYTES } from "@/lib/cloudinary/shared";
import { FormAlert } from "@/components/admin/field";

/**
 * Product image manager (Phase 3).
 *
 * Works from phone or computer: choose photos, watch upload progress,
 * preview, reorder with explicit Up/Down buttons (never drag-only), edit
 * alt text, mark the primary image (first position) and remove photos
 * with a two-step confirmation.
 *
 * Trust flow: the browser uploads straight to Cloudinary with
 * short-lived server-signed parameters, then the server VERIFIES the
 * asset before attaching it (see src/lib/actions/images.ts). Nothing the
 * client reports about the file is trusted.
 */

const MAX_IMAGES = 10;
const ACCEPTED_TYPES = ["image/jpeg", "image/png", "image/webp"];

interface ImageRow {
  secureUrl: string;
  publicId: string;
  alt: string;
}

interface UploadState {
  fileName: string;
  percent: number;
}

function isTooLarge(file: File): boolean {
  return file.size > MAX_IMAGE_BYTES;
}

function isAcceptedType(file: File): boolean {
  return ACCEPTED_TYPES.includes(file.type);
}

export function ImageManager({
  productId,
  productName,
  images,
  uploadsConfigured,
}: {
  productId: string;
  productName: string;
  images: Array<{ secureUrl: string; publicId?: string; alt: string }>;
  uploadsConfigured: boolean;
}) {
  const router = useRouter();
  const [rows, setRows] = useState<ImageRow[]>(() =>
    images.map((image) => ({
      secureUrl: image.secureUrl,
      publicId: image.publicId ?? "",
      alt: image.alt,
    })),
  );
  const [syncedImages, setSyncedImages] = useState(images);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [upload, setUpload] = useState<UploadState | null>(null);
  const [removeArmed, setRemoveArmed] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Re-sync with the server copy after each refresh (adjust-during-render
  // pattern: state is reset when props change, without an effect).
  if (syncedImages !== images) {
    setSyncedImages(images);
    setRows(
      images.map((image) => ({
        secureUrl: image.secureUrl,
        publicId: image.publicId ?? "",
        alt: image.alt,
      })),
    );
  }

  const move = useCallback((index: number, direction: -1 | 1) => {
    setRows((current) => {
      const target = index + direction;
      if (target < 0 || target >= current.length) return current;
      const next = [...current];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  }, []);

  function saveChanges() {
    setError(null);
    setNotice(null);
    const formData = new FormData();
    formData.append("productId", productId);
    for (const row of rows) {
      formData.append("publicId", row.publicId);
      formData.append("alt", row.alt);
    }
    startTransition(async () => {
      const result = await saveImagesAction(formData);
      if (result.ok) {
        setNotice("Images saved.");
        router.refresh();
      } else {
        setError(result.error ?? "The images could not be saved.");
      }
    });
  }

  function removeImage(publicId: string) {
    setError(null);
    setNotice(null);
    const formData = new FormData();
    formData.append("productId", productId);
    formData.append("publicId", publicId);
    startTransition(async () => {
      const result = await removeImageAction(formData);
      setRemoveArmed(null);
      if (result.ok) {
        setNotice("Image removed.");
        router.refresh();
      } else {
        setError(result.error ?? "The image could not be removed.");
      }
    });
  }

  async function uploadFiles(files: FileList) {
    setError(null);
    setNotice(null);

    for (const file of Array.from(files)) {
      if (rows.length >= MAX_IMAGES) {
        setError(`Products can have at most ${MAX_IMAGES} images.`);
        return;
      }
      if (!isAcceptedType(file)) {
        setError(`“${file.name}” is not a JPEG, PNG or WebP image.`);
        continue;
      }
      if (isTooLarge(file)) {
        setError(`“${file.name}” is larger than ${Math.round(MAX_IMAGE_BYTES / (1024 * 1024))} MB.`);
        continue;
      }

      setUpload({ fileName: file.name, percent: 0 });
      try {
        const signature = await requestUploadSignatureAction();
        if (!("signature" in signature)) {
          setError(signature.error ?? "Uploads are not available right now.");
          return;
        }

        const publicId = await sendToCloudinary(file, signature.signature);
        if (!publicId) {
          setError(`“${file.name}” could not be uploaded. Please try again.`);
          continue;
        }

        const formData = new FormData();
        formData.append("productId", productId);
        formData.append("publicId", publicId);
        formData.append("alt", productName);
        const attached = await attachImageAction(formData);
        if (!attached.ok) {
          setError(attached.error ?? "The image could not be attached to this product.");
          continue;
        }
        setNotice(`“${file.name}” uploaded. The description is pre-filled with the product name; edit it below if needed.`);
        router.refresh();
      } catch {
        setError(`“${file.name}” could not be uploaded. Check your connection and try again.`);
      } finally {
        setUpload(null);
        if (fileInputRef.current) fileInputRef.current.value = "";
      }
    }
  }

  function sendToCloudinary(
    file: File,
    signature: { uploadUrl: string; apiKey: string; timestamp: number; signature: string; folder: string; signatureAlgorithm: string },
  ): Promise<string | null> {
    return new Promise((resolve) => {
      const body = new FormData();
      body.append("file", file);
      body.append("api_key", signature.apiKey);
      body.append("timestamp", String(signature.timestamp));
      body.append("signature", signature.signature);
      body.append("folder", signature.folder);
      body.append("unique_filename", "true");
      body.append("overwrite", "false");
      body.append("signature_algorithm", signature.signatureAlgorithm);

      const xhr = new XMLHttpRequest();
      xhr.open("POST", signature.uploadUrl);
      xhr.upload.addEventListener("progress", (event) => {
        if (event.lengthComputable) {
          setUpload({ fileName: file.name, percent: Math.round((event.loaded / event.total) * 100) });
        }
      });
      xhr.addEventListener("load", () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          try {
            const parsed = JSON.parse(xhr.responseText) as { public_id?: string };
            resolve(parsed.public_id ?? null);
          } catch {
            resolve(null);
          }
        } else {
          resolve(null);
        }
      });
      xhr.addEventListener("error", () => resolve(null));
      xhr.addEventListener("abort", () => resolve(null));
      xhr.send(body);
    });
  }

  const full = rows.length >= MAX_IMAGES;

  return (
    <section aria-labelledby="images-heading" className="space-y-4">
      <div>
        <h2 id="images-heading" className="font-serif text-xl font-semibold text-navy">
          Photos
        </h2>
        <p className="mt-1 font-sans text-[13px] text-ink-muted">
          The first photo is used as the main image. Use the arrows to reorder. JPEG, PNG
          or WebP, up to {Math.round(MAX_IMAGE_BYTES / (1024 * 1024))} MB each, maximum{" "}
          {MAX_IMAGES} photos.
        </p>
      </div>

      {error ? <FormAlert tone="error">{error}</FormAlert> : null}
      {notice ? (
        <p role="status" className="flex items-start gap-2 rounded-lg border border-leaf/40 bg-leaf/10 px-4 py-3 font-sans text-sm text-navy-900">
          <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-leaf-700" aria-hidden="true" />
          {notice}
        </p>
      ) : null}

      {!uploadsConfigured ? (
        <div className="flex items-start gap-3 rounded-xl border border-border bg-cream-100 px-4 py-3">
          <AlertTriangle className="mt-0.5 size-4.5 shrink-0 text-gold-700" aria-hidden="true" />
          <p className="font-sans text-sm text-ink-muted">
            Photo uploads are not configured on this deployment yet. Existing photos can
            still be reordered, described and removed.
          </p>
        </div>
      ) : (
        <div>
          <label
            htmlFor="product-photo-input"
            className="inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-full border border-navy/25 px-5 font-sans text-sm font-semibold text-navy transition-colors hover:border-navy hover:bg-navy hover:text-cream focus-gold"
          >
            <ImagePlus className="size-4" aria-hidden="true" />
            Choose photos
          </label>
          <input
            ref={fileInputRef}
            id="product-photo-input"
            type="file"
            accept={ACCEPTED_TYPES.join(",")}
            multiple
            className="sr-only"
            disabled={full || pending || upload !== null}
            onChange={(event) => {
              if (event.target.files && event.target.files.length > 0) {
                void uploadFiles(event.target.files);
              }
            }}
          />
          {full ? (
            <p className="mt-2 font-sans text-[13px] text-ink-muted">
              This product already has {MAX_IMAGES} photos.
            </p>
          ) : null}
          {upload ? (
            <div className="mt-3" role="status">
              <p className="font-sans text-sm font-semibold text-navy">
                Uploading {upload.fileName}… {upload.percent}%
              </p>
              <div
                className="mt-1.5 h-2 overflow-hidden rounded-full bg-cream-200"
                role="progressbar"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={upload.percent}
                aria-label={`Uploading ${upload.fileName}`}
              >
                <div
                  className="h-full rounded-full bg-leaf transition-[width] duration-200"
                  style={{ width: `${upload.percent}%` }}
                />
              </div>
            </div>
          ) : null}
        </div>
      )}

      {rows.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border px-4 py-8 text-center font-sans text-sm text-ink-muted">
          No photos yet.
          {uploadsConfigured ? " Choose one or more photos to add them to this product." : ""}
        </p>
      ) : (
        <ul className="space-y-3">
          {rows.map((row, index) => (
            <li
              key={row.publicId || index}
              className="rounded-2xl border border-border bg-surface p-3 sm:p-4"
            >
              <div className="flex flex-col gap-3 sm:flex-row">
                <div className="relative aspect-square w-full shrink-0 overflow-hidden rounded-xl bg-cream-200 sm:size-28">
                  <Image
                    src={row.secureUrl}
                    alt=""
                    fill
                    sizes="(max-width: 640px) 100vw, 112px"
                    className="object-cover"
                  />
                </div>
                <div className="min-w-0 flex-1 space-y-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-sans text-xs font-bold uppercase tracking-wide text-ink-muted">
                      Photo {index + 1}
                    </span>
                    {index === 0 ? (
                      <span className="inline-flex items-center gap-1 rounded-full bg-gold-100 px-2.5 py-0.5 font-sans text-[11px] font-bold uppercase tracking-wide text-gold-700">
                        <Star className="size-3" aria-hidden="true" />
                        Main image
                      </span>
                    ) : null}
                  </div>
                  <div>
                    <label
                      htmlFor={`image-alt-${index}`}
                      className="mb-1.5 block font-sans text-sm font-semibold text-navy"
                    >
                      Description (alt text)
                    </label>
                    <input
                      id={`image-alt-${index}`}
                      type="text"
                      value={row.alt}
                      maxLength={300}
                      onChange={(event) => {
                        const value = event.target.value;
                        setRows((current) =>
                          current.map((entry, position) =>
                            position === index ? { ...entry, alt: value } : entry,
                          ),
                        );
                      }}
                      className="w-full rounded-lg border border-navy/20 bg-cream px-3.5 py-2.5 font-sans text-[15px] text-navy transition-colors hover:border-navy/35 focus-gold"
                    />
                    <p className="mt-1 font-sans text-xs text-ink-muted">
                      Describe the photo for customers using screen readers.
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() => move(index, -1)}
                      disabled={index === 0 || pending}
                      aria-label={`Move photo ${index + 1} earlier`}
                      className="inline-flex min-h-10 items-center gap-1.5 rounded-lg border border-navy/25 px-3 font-sans text-xs font-bold text-navy transition-colors hover:border-navy hover:bg-navy hover:text-cream focus-gold disabled:pointer-events-none disabled:opacity-40"
                    >
                      <ArrowUp className="size-4" aria-hidden="true" />
                      Earlier
                    </button>
                    <button
                      type="button"
                      onClick={() => move(index, 1)}
                      disabled={index === rows.length - 1 || pending}
                      aria-label={`Move photo ${index + 1} later`}
                      className="inline-flex min-h-10 items-center gap-1.5 rounded-lg border border-navy/25 px-3 font-sans text-xs font-bold text-navy transition-colors hover:border-navy hover:bg-navy hover:text-cream focus-gold disabled:pointer-events-none disabled:opacity-40"
                    >
                      <ArrowDown className="size-4" aria-hidden="true" />
                      Later
                    </button>
                    <button
                      type="button"
                      onClick={() => removeArmed === row.publicId ? removeImage(row.publicId) : setRemoveArmed(row.publicId)}
                      onBlur={(event) => {
                        if (!event.currentTarget.parentElement?.contains(event.relatedTarget as Node)) {
                          setRemoveArmed(null);
                        }
                      }}
                      aria-label={
                        removeArmed === row.publicId
                          ? `Confirm removing photo ${index + 1}`
                          : `Remove photo ${index + 1}`
                      }
                      className={
                        removeArmed === row.publicId
                          ? "inline-flex min-h-10 items-center gap-1.5 rounded-lg bg-terracotta-700 px-3 font-sans text-xs font-bold text-cream transition-colors hover:bg-terracotta-800 focus-gold"
                          : "inline-flex min-h-10 items-center gap-1.5 rounded-lg border border-navy/25 px-3 font-sans text-xs font-bold text-navy transition-colors hover:border-terracotta-700 hover:text-terracotta-700 focus-gold"
                      }
                    >
                      <Trash2 className="size-4" aria-hidden="true" />
                      {removeArmed === row.publicId ? "Confirm remove" : "Remove"}
                    </button>
                  </div>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}

      {rows.length > 0 ? (
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={saveChanges}
            disabled={pending}
            className="inline-flex min-h-11 items-center gap-2 rounded-full bg-navy px-6 font-sans text-sm font-semibold text-cream transition-colors hover:bg-navy-800 focus-gold disabled:pointer-events-none disabled:opacity-50"
          >
            {pending ? (
              <>
                <Loader2 className="size-4 motion-safe:animate-spin" aria-hidden="true" />
                Saving…
              </>
            ) : (
              "Save photo changes"
            )}
          </button>
          <p className="font-sans text-[13px] text-ink-muted">
            Saves the order and descriptions.
          </p>
        </div>
      ) : null}
    </section>
  );
}
