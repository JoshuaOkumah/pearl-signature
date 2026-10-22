"use client";

import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

/**
 * Storefront chrome switcher (Phase 3).
 *
 * The root layout stays the single place that owns fonts, the motion
 * provider and the skip link, but only CUSTOMER-facing routes receive the
 * marketing Header and Footer. Admin routes (`/admin/...`) render their
 * own operational shell instead, and the 404 page keeps its full
 * storefront chrome because it lives outside `/admin`.
 *
 * Header and Footer are passed in as elements from the server layout, so
 * they keep their current component graphs (Footer stays a server
 * component). `usePathname` is available during prerender for each route,
 * so this does not force dynamic rendering on the storefront.
 */
export function SiteChrome({
  header,
  footer,
  children,
}: {
  header: ReactNode;
  footer: ReactNode;
  children: ReactNode;
}) {
  const pathname = usePathname();
  const isAdmin = pathname === "/admin" || pathname.startsWith("/admin/");

  if (isAdmin) return <>{children}</>;

  return (
    <>
      {header}
      {children}
      {footer}
    </>
  );
}
