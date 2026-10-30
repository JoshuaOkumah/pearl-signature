"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  ClipboardList,
  ExternalLink,
  LayoutDashboard,
  LogOut,
  Mail,
  Menu,
  Package,
  Settings,
  Tags,
  X,
} from "lucide-react";
import { logoutAction } from "@/lib/actions/auth";
import { cn } from "@/lib/utils";

/**
 * Admin application shell (Phase 3).
 *
 * Desktop: fixed sidebar with clear active state. Mobile: a top bar with
 * a navigation drawer — full-height panel, always-visible close button,
 * Escape-to-close, focus moved into the panel on open, background scroll
 * locked while open, and automatic close on navigation. (Phase 1's
 * original mobile nav problems are not repeated here.)
 */

const NAV_ITEMS = [
  { href: "/admin", label: "Dashboard", icon: LayoutDashboard, exact: true },
  { href: "/admin/orders", label: "Orders", icon: ClipboardList, exact: false },
  { href: "/admin/products", label: "Products", icon: Package, exact: false },
  { href: "/admin/categories", label: "Categories", icon: Tags, exact: false },
  { href: "/admin/notifications", label: "Notifications", icon: Mail, exact: false },
  { href: "/admin/settings", label: "Settings", icon: Settings, exact: false },
] as const;

function isActive(pathname: string, href: string, exact: boolean): boolean {
  return exact ? pathname === href : pathname === href || pathname.startsWith(`${href}/`);
}

function NavLinks({
  pathname,
  onNavigate,
  variant,
}: {
  pathname: string;
  onNavigate?: () => void;
  variant: "sidebar" | "drawer";
}) {
  return (
    <nav aria-label="Admin sections" className="flex flex-col gap-1">
      {NAV_ITEMS.map((item) => {
        const active = isActive(pathname, item.href, item.exact);
        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={onNavigate}
            aria-current={active ? "page" : undefined}
            className={cn(
              "flex items-center gap-3 rounded-lg px-3 py-2.5 font-sans text-[15px] font-semibold transition-colors focus-gold",
              variant === "drawer" && "min-h-12 text-base",
              active
                ? "bg-navy-700 text-cream shadow-[inset_3px_0_0_0_var(--color-gold)]"
                : "text-cream/75 hover:bg-navy-800 hover:text-cream",
            )}
          >
            <item.icon className="size-5 shrink-0" aria-hidden="true" />
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}

function AccountBlock({ email, variant }: { email: string; variant: "sidebar" | "drawer" }) {
  return (
    <div className={cn("border-t border-cream/10 pt-4", variant === "drawer" && "pb-2")}>
      <p className="truncate font-sans text-[13px] text-cream/60" title={email}>
        {email}
      </p>
      <form action={logoutAction} className="mt-2">
        <button
          type="submit"
          className="flex min-h-11 w-full items-center gap-3 rounded-lg px-3 font-sans text-sm font-semibold text-cream/80 transition-colors hover:bg-navy-800 hover:text-cream focus-gold"
        >
          <LogOut className="size-4.5" aria-hidden="true" />
          Sign out
        </button>
      </form>
    </div>
  );
}

export function AdminShell({ email, children }: { email: string; children: ReactNode }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  // Move focus into the drawer when it opens; restore scroll when it closes.
  useEffect(() => {
    if (!open) return;
    closeButtonRef.current?.focus();
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
        return;
      }
      // Minimal focus containment: Tab cycles within the drawer panel.
      if (event.key !== "Tab" || !panelRef.current) return;
      const focusables = panelRef.current.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input, select, textarea, [tabindex]:not([tabindex="-1"])',
      );
      if (focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      const active = document.activeElement;
      if (event.shiftKey && (active === first || !panelRef.current.contains(active))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [open]);

  // Close the drawer whenever navigation happens (adjust-during-render:
  // the pathname acts as the external signal, no effect needed).
  const [prevPathname, setPrevPathname] = useState(pathname);
  if (prevPathname !== pathname) {
    setPrevPathname(pathname);
    if (open) setOpen(false);
  }

  return (
    <div className="min-h-dvh bg-cream">
      {/* Desktop sidebar */}
      <aside className="fixed inset-y-0 left-0 z-40 hidden w-64 flex-col bg-navy px-4 py-6 lg:flex">
        <Link href="/admin" className="mb-8 block rounded px-1 focus-gold">
          <span className="font-serif text-xl font-semibold tracking-[0.08em] text-cream">
            PEARL
          </span>
          <span className="ml-2 rounded-full bg-gold px-2 py-0.5 font-sans text-[11px] font-bold uppercase tracking-wider text-navy-900">
            Admin
          </span>
        </Link>
        <NavLinks pathname={pathname} variant="sidebar" />
        <div className="mt-auto space-y-1">
          <Link
            href="/"
            className="flex min-h-11 items-center gap-3 rounded-lg px-3 font-sans text-sm font-semibold text-cream/60 transition-colors hover:bg-navy-800 hover:text-cream focus-gold"
          >
            <ExternalLink className="size-4.5" aria-hidden="true" />
            View storefront
          </Link>
          <AccountBlock email={email} variant="sidebar" />
        </div>
      </aside>

      {/* Mobile top bar */}
      <header className="sticky top-0 z-40 flex h-14 items-center gap-3 bg-navy px-4 lg:hidden">
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-expanded={open}
          aria-controls="admin-drawer"
          aria-label="Open navigation menu"
          className="flex size-11 items-center justify-center rounded-lg text-cream transition-colors hover:bg-navy-800 focus-gold"
        >
          <Menu className="size-5" aria-hidden="true" />
        </button>
        <Link href="/admin" className="flex items-baseline gap-2 rounded px-1 focus-gold">
          <span className="font-serif text-lg font-semibold tracking-[0.08em] text-cream">
            PEARL
          </span>
          <span className="font-sans text-[11px] font-bold uppercase tracking-wider text-gold">
            Admin
          </span>
        </Link>
      </header>

      {/* Mobile drawer */}
      {open ? (
        <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true" aria-label="Admin navigation">
          <button
            type="button"
            tabIndex={-1}
            aria-label="Close navigation menu"
            onClick={() => setOpen(false)}
            className="absolute inset-0 bg-navy-900/60"
          />
          <div
            id="admin-drawer"
            ref={panelRef}
            className="absolute inset-y-0 left-0 flex w-[min(20rem,88vw)] flex-col bg-navy px-4 py-5 shadow-2xl"
          >
            <div className="mb-6 flex items-center justify-between">
              <span className="flex items-baseline gap-2">
                <span className="font-serif text-xl font-semibold tracking-[0.08em] text-cream">
                  PEARL
                </span>
                <span className="rounded-full bg-gold px-2 py-0.5 font-sans text-[11px] font-bold uppercase tracking-wider text-navy-900">
                  Admin
                </span>
              </span>
              <button
                ref={closeButtonRef}
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Close navigation menu"
                className="flex size-11 items-center justify-center rounded-lg text-cream transition-colors hover:bg-navy-800 focus-gold"
              >
                <X className="size-5" aria-hidden="true" />
              </button>
            </div>
            <NavLinks pathname={pathname} onNavigate={() => setOpen(false)} variant="drawer" />
            <div className="mt-auto space-y-1">
              <Link
                href="/"
                onClick={() => setOpen(false)}
                className="flex min-h-12 items-center gap-3 rounded-lg px-3 font-sans text-base font-semibold text-cream/70 transition-colors hover:bg-navy-800 hover:text-cream focus-gold"
              >
                <ExternalLink className="size-5" aria-hidden="true" />
                View storefront
              </Link>
              <AccountBlock email={email} variant="drawer" />
            </div>
          </div>
        </div>
      ) : null}

      {/* Content */}
      <div className="lg:pl-64">
        <main id="main-content" className="mx-auto w-full max-w-6xl px-4 py-6 md:px-8 md:py-8">
          {children}
        </main>
      </div>
    </div>
  );
}
