import { NextResponse, type NextRequest } from "next/server";
import { resolvePublicProductSlug } from "@/lib/repositories/catalogue";
import { slugSchema } from "@/lib/validations/catalogue";

/**
 * Proxy: real 404s for product pages (Next 16 / Cache Components).
 *
 * `/menu/[slug]` renders from the database at request time, and its static
 * shell flushes with `200` before the page resolves — so a page-level
 * `notFound()` alone would produce a soft 404 (correct UI, wrong status,
 * patched with `noindex`). The framework's prescribed fix is to check the
 * slug in Proxy, which runs before any response starts:
 * https://nextjs.org/docs/messages/blocking-prerender-client-hook
 *
 * Rules (kept identical to the page layer, which stays authoritative):
 *
 * - Malformed slugs 404 without touching the database.
 * - Unknown slugs, unpublished (draft/archived) products and products in
 *   a disabled category 404.
 * - FORMER slugs (Phase 3 admin renames) get a 308 HERE, before any
 *   response starts. In production the postponed static shell commits a
 *   `200` before the page body resolves, so a page-level `permanentRedirect`
 *   would fire too late and corrupt the response into a soft 404 (the page
 *   keeps its redirect as a fallback for `next dev` and proxy-bypassed
 *   requests).
 * - Database trouble NEVER 404s: the request passes through so the page can
 *   render its honest "temporarily unavailable" retry state.
 * - Fixtures mode and "catalogue unavailable" (production without
 *   MONGODB_URI) resolve through the same repository function as the pages,
 *   so there is one implementation of every visibility rule.
 */

/** Only product detail pages are checked; `/menu` itself is untouched. */
export const config = {
  matcher: ["/menu/:slug"],
};

/** Rewrite to an unmatched path: Next renders the app's designed not-found
 * page there with a genuine 404 status. */
const NOT_FOUND_REWRITE = "/__pearl-not-found__";

export async function proxy(request: NextRequest) {
  const segment = request.nextUrl.pathname.slice("/menu/".length);

  // 1. Format gate — no database roundtrip for junk paths.
  if (!slugSchema.safeParse(segment).success) {
    return NextResponse.rewrite(new URL(NOT_FOUND_REWRITE, request.url));
  }

  // 2. Visibility gate — same resolution function the page uses.
  const result = await resolvePublicProductSlug(segment);
  if (!result.ok) {
    // Infrastructure trouble: pass through untouched. The page renders its
    // retry state; a customer must never see a 404 because the database
    // hiccuped.
    return NextResponse.next();
  }
  if (result.data.kind === "missing") {
    // Unknown, draft, archived or disabled-category slug: 404 before any
    // shell flushes.
    return NextResponse.rewrite(new URL(NOT_FOUND_REWRITE, request.url));
  }
  if (result.data.kind === "previous") {
    // Former address of a renamed product: permanent redirect to the
    // canonical URL while the response can still carry a status code.
    // Relative URL on this origin only (canonical comes from the database's
    // slug field, which is pattern-validated, so no open redirect).
    return NextResponse.redirect(new URL(`/menu/${result.data.canonical}`, request.url), 308);
  }

  return NextResponse.next();
}
