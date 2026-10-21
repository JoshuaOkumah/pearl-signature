/**
 * Image-host safety checks for the Cloudinary delivery path.
 *
 * Phase 2 stores image REFERENCES only: MongoDB keeps metadata, Cloudinary
 * hosts the binary. Nothing may render unless it is an HTTPS Cloudinary URL
 * for the configured cloud, so arbitrary external hosts can never reach
 * `next/image`.
 */

const CLOUDINARY_HOST = "res.cloudinary.com";

/**
 * Build-time flag injected by next.config.ts. It is `1` only when
 * `CLOUDINARY_CLOUD_NAME` was present at build time, which is also when the
 * `next/image` remote-pattern for Cloudinary was configured. Checking this
 * (instead of the runtime env) guarantees the render path and the image
 * loader configuration can never disagree.
 */
export function isCloudinaryDeliveryEnabled(): boolean {
  return process.env.NEXT_PUBLIC_CLOUDINARY_ENABLED === "1";
}

/**
 * True when the value is an HTTPS Cloudinary upload URL. When a cloud name is
 * configured at runtime, the URL must belong to that exact cloud.
 */
export function isCloudinaryUrl(value: unknown): value is string {
  if (typeof value !== "string") return false;

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.protocol !== "https:" || url.hostname !== CLOUDINARY_HOST) return false;

  const parts = url.pathname.split("/").filter(Boolean);
  const cloudName = process.env.CLOUDINARY_CLOUD_NAME?.trim();

  if (cloudName) {
    // /<cloud>/image/upload/...
    return parts[0] === cloudName && parts[1] === "image" && parts[2] === "upload";
  }
  // Cloud name unknown at runtime: still require the canonical
  // /<cloud>/image/upload/... shape (any cloud), never raw/list transforms.
  return parts[1] === "image" && parts[2] === "upload";
}

/**
 * Whether a stored image reference may be handed to `next/image`.
 * Requires both a valid Cloudinary URL and build-time delivery configuration.
 */
export function canDeliverImage(image: { secureUrl: string } | null | undefined): image is { secureUrl: string } {
  if (!image) return false;
  return isCloudinaryDeliveryEnabled() && isCloudinaryUrl(image.secureUrl);
}
