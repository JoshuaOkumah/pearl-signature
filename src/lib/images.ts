/**
 * Image-host safety checks for the Cloudinary delivery path.
 *
 * Phase 2 stores image REFERENCES only: MongoDB keeps metadata, Cloudinary
 * hosts the binary. Nothing may render unless it is an HTTPS Cloudinary URL
 * for the configured cloud, so arbitrary external hosts can never reach
 * `next/image`.
 *
 * ## Why the cloud name is read from a `NEXT_PUBLIC_` variable
 *
 * `next.config.ts` scopes the `next/image` remote pattern to
 * `CLOUDINARY_CLOUD_NAME` at build time. That variable is server-only, so in a
 * client component it reads as `undefined` — and this module is imported by
 * client components (the admin image manager and product table). The guard
 * therefore used to fall back to a shape-only check, accepting
 * `https://res.cloudinary.com/<any-cloud>/image/upload/...`, while the image
 * loader still only allowed the configured cloud. A photo stored in a
 * different Cloudinary account then crashed the product edit page with
 * "hostname res.cloudinary.com is not configured under images".
 *
 * The build-time cloud name is now exposed as
 * `NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME`, injected from the SAME value that
 * configures the remote pattern, so the render guard and the image loader can
 * never disagree again.
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
 * The cloud this build serves images from, or `null` when none was configured.
 * The public value is tried first because client components cannot read the
 * server-only one; the server keeps working when only `CLOUDINARY_CLOUD_NAME`
 * is set (tests, scripts, server rendering).
 */
function configuredCloudName(): string | null {
  const name =
    process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME?.trim() || process.env.CLOUDINARY_CLOUD_NAME?.trim();
  return name ? name : null;
}

/**
 * The cloud segment of a canonical Cloudinary delivery URL, or `null` when the
 * value is not one. Shape only: `/ <cloud> /image/upload/...` on
 * `res.cloudinary.com` over HTTPS. Raw and list transforms are rejected.
 */
function cloudinaryCloudOf(value: unknown): string | null {
  if (typeof value !== "string") return null;

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || url.hostname !== CLOUDINARY_HOST) return null;

  const parts = url.pathname.split("/").filter(Boolean);
  if (parts[1] !== "image" || parts[2] !== "upload") return null;
  return parts[0] ?? null;
}

/**
 * True when the value is an HTTPS Cloudinary upload URL for the configured
 * cloud. When no cloud name is configured the canonical shape is still
 * required (any cloud), never a raw host.
 */
export function isCloudinaryUrl(value: unknown): value is string {
  const cloud = cloudinaryCloudOf(value);
  if (cloud === null) return false;

  const configured = configuredCloudName();
  return configured === null || cloud === configured;
}

/**
 * Why a stored photo cannot be shown, or `null` when it can.
 *
 * Kept separate from the boolean check so the admin can explain the problem
 * instead of showing a silent "preview not available":
 *
 *  - `invalid_url`      — not a Cloudinary delivery URL at all
 *  - `delivery_disabled`— this build has no Cloudinary configuration
 *  - `wrong_cloud`      — valid URL, but a different Cloudinary account than
 *                         the one this site serves from
 */
export type ImageDeliveryIssue = "invalid_url" | "delivery_disabled" | "wrong_cloud";

export function imageDeliveryIssue(
  image: { secureUrl: string } | null | undefined,
): ImageDeliveryIssue | null {
  const cloud = cloudinaryCloudOf(image?.secureUrl);
  if (cloud === null) return "invalid_url";
  if (!isCloudinaryDeliveryEnabled()) return "delivery_disabled";

  const configured = configuredCloudName();
  if (configured !== null && cloud !== configured) return "wrong_cloud";
  return null;
}

/**
 * Whether a stored image reference may be handed to `next/image`.
 * Requires both a valid Cloudinary URL and build-time delivery configuration.
 */
export function canDeliverImage(image: { secureUrl: string } | null | undefined): image is { secureUrl: string } {
  return imageDeliveryIssue(image) === null;
}
