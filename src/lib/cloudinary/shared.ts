/**
 * Cloudinary constants shared by server signing/verification code and the
 * admin upload UI (Phase 3).
 *
 * This module must stay free of `server-only` imports and secrets: it is
 * safe to include in client bundles. API keys and secrets never appear
 * here.
 */

export const UPLOAD_FOLDER = "pearl-signature/products";
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024; // 5 MB per image
export const MAX_IMAGE_DIMENSION = 10_000; // pixels, per side
export const ALLOWED_IMAGE_FORMATS = ["jpg", "jpeg", "png", "webp"] as const;
