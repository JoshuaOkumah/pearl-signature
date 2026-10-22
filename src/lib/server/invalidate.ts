import "server-only";
import { revalidatePath } from "next/cache";

/**
 * Storefront invalidation after admin mutations (Phase 3).
 *
 * Architecture recap: catalogue reads carry NO server-side data cache
 * (no `"use cache"` anywhere) and run at request time, so the database is
 * always read fresh and prices/lists can never be served stale from the
 * server. What CAN hold stale public data is the per-visitor Next.js
 * Router Cache (prefetched RSC payloads for links, seconds to minutes) and
 * any prerendered PPR shell. `revalidatePath` purges exactly that: the
 * acting admin's client cache for the public surfaces plus any stored
 * shell output, so their very next navigation shows the new data — and
 * other visitors converge within their router-cache window.
 *
 * Admin pages themselves are cookie-dependent (dynamically rendered) and
 * are never written into shared caches, so no admin invalidation exists
 * by design.
 */
export function invalidateCatalogue(): void {
  revalidatePath("/", "layout");
}
