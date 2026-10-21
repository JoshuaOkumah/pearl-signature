/**
 * Production site origin for canonical URLs and Open Graph metadata.
 *
 * Returns `null` when `NEXT_PUBLIC_SITE_URL` is not configured so metadata
 * never advertises a fabricated domain.
 */
export function siteUrl(): string | null {
  const raw = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  if (!raw) return null;

  try {
    const url = new URL(raw);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    return url.origin;
  } catch {
    return null;
  }
}

/** Absolute URL for a site-relative path, or null when no site URL is configured. */
export function absoluteUrl(path: string): string | null {
  const origin = siteUrl();
  if (!origin) return null;
  return `${origin}${path.startsWith("/") ? path : `/${path}`}`;
}
