import type { Metadata } from "next";
import type { ReactNode } from "react";

/**
 * Admin root layout (Phase 3).
 *
 * - Never indexed: `robots: { index: false }` on every admin route via
 *   template, and the routes themselves are cookie-gated server-side.
 * - No storefront chrome: the root layout's `SiteChrome` suppresses the
 *   marketing Header/Footer for `/admin/**` (see
 *   src/components/layout/site-chrome.tsx).
 * - No caching: admin pages read cookies, so Next renders them per
 *   request; nothing here is ever statically generated or shared.
 *
 * `instant = false` (Next 16 Cache Components) opts the whole admin tree
 * out of static-shell prerendering and instant-navigation validation:
 * every route below resolves the session cookie against MongoDB at
 * request time, so a prerendered shell would be empty at best and a leak
 * risk at worst. Blocking per request is the correct behaviour here, and
 * the same pattern the `/menu/[slug]` page uses (see that page's comment).
 */
export const instant = false;

export const metadata: Metadata = {
  title: {
    default: "Admin · PEARL Signature",
    template: "%s · PEARL Signature Admin",
  },
  robots: { index: false, follow: false },
};

export default function AdminLayout({ children }: { children: ReactNode }) {
  return children;
}
