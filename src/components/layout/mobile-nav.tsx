"use client";

import Link from "next/link";
import { AnimatePresence, motion } from "motion/react";
import { ArrowRight, X } from "lucide-react";
import { useEffect, useRef, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import type { RefObject } from "react";
import { navItems } from "@/data/navigation";
import { cn } from "@/lib/utils";
import { Wordmark } from "@/components/shared/wordmark";

interface MobileNavProps {
  open: boolean;
  onClose: () => void;
  /** Hamburger button — focus is returned here when the menu closes. */
  triggerRef: RefObject<HTMLButtonElement | null>;
  pathname: string;
}

const FOCUSABLE = 'a[href], button:not([disabled])';

/**
 * Full-screen mobile navigation, rendered through a portal into
 * `document.body`.
 *
 * Why a portal: the sticky header applies `backdrop-filter` when the menu is
 * open, and a backdrop-filter creates a containing block for fixed-position
 * descendants. Rendering the panel inside the header therefore collapsed it
 * into the 72px header box (Phase 1B bug). Portalling makes the panel a
 * direct child of <body>, so `fixed inset-0` always resolves against the
 * viewport, independent of any ancestor styling or stacking context.
 *
 * Behaviour:
 * - Visible X close button inside the panel, plus Escape, link selection
 * - Focus moves to the X on open, is trapped while open, returns to the
 *   hamburger on close
 * - Body scroll is locked while open (and released on unmount/unresize)
 * - Content scrolls internally on short (landscape) viewports
 * - Widening past the md breakpoint closes the panel and releases the lock
 */
// Client-mount detection for the portal: false while SSR/prerendering,
// true in the browser. (useSyncExternalStore is the lint-clean alternative
// to a setState-in-effect "mounted" flag.)
const emptySubscribe = () => () => {};
const getClientSnapshot = () => true;
const getServerSnapshot = () => false;

export function MobileNav({ open, onClose, triggerRef, pathname }: MobileNavProps) {
  const mounted = useSyncExternalStore(emptySubscribe, getClientSnapshot, getServerSnapshot);
  const panelRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  // Open-time lifecycle: focus, Escape, focus trap, scroll lock,
  // breakpoint guard.
  useEffect(() => {
    if (!open) return;

    const trigger = triggerRef.current;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeRef.current?.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== "Tab") return;

      // Keep keyboard focus inside the panel while it is modal.
      const panel = panelRef.current;
      if (!panel) return;
      const focusable = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE));
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;
      if (event.shiftKey && (active === first || active === panel)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    };

    // If the viewport widens past the mobile breakpoint, close the panel so
    // no invisible overlay or scroll lock survives the transition.
    const media = window.matchMedia("(min-width: 768px)");
    const onMediaChange = () => {
      if (media.matches) onClose();
    };

    document.addEventListener("keydown", onKeyDown);
    media.addEventListener("change", onMediaChange);

    return () => {
      document.removeEventListener("keydown", onKeyDown);
      media.removeEventListener("change", onMediaChange);
      document.body.style.overflow = previousOverflow;
      trigger?.focus();
    };
  }, [open, onClose, triggerRef]);

  if (!mounted) return null;

  return createPortal(
    <AnimatePresence>
      {open ? (
        <motion.div
          key="mobile-menu"
          ref={panelRef}
          id="mobile-navigation"
          role="dialog"
          aria-modal="true"
          aria-label="Site navigation"
          className="fixed inset-0 z-[70] flex flex-col bg-cream pb-[env(safe-area-inset-bottom)] pt-[env(safe-area-inset-top)] md:hidden"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
        >
          {/* Panel bar: wordmark + the visible, tappable X */}
          <div className="flex h-18 shrink-0 items-center justify-between border-b border-border px-5">
            <Wordmark />
            <button
              ref={closeRef}
              type="button"
              onClick={onClose}
              aria-label="Close menu"
              className="focus-gold inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-border bg-surface text-navy transition-colors hover:border-navy/40 hover:text-navy"
            >
              <X className="h-5 w-5" aria-hidden="true" />
            </button>
          </div>

          {/* Scrollable link list — scrolls its own content on short screens */}
          <nav aria-label="Mobile" className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5">
            <motion.ul
              className="flex flex-col gap-1 pb-4 pt-4"
              initial="closed"
              animate="open"
              exit="closed"
              variants={{
                open: { transition: { staggerChildren: 0.05, delayChildren: 0.05 } },
                closed: { transition: { staggerChildren: 0.03, staggerDirection: -1 } },
              }}
            >
              {navItems.map((item, index) => {
                const active = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
                return (
                  <motion.li
                    key={item.href}
                    variants={{
                      open: { opacity: 1, y: 0 },
                      closed: { opacity: 0, y: 12 },
                    }}
                    transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
                  >
                    <Link
                      href={item.href}
                      onClick={onClose}
                      aria-current={active ? "page" : undefined}
                      className={cn(
                        "focus-gold flex items-center justify-between gap-4 rounded-2xl px-4 py-3.5 font-display text-2xl font-medium transition-colors",
                        active
                          ? "bg-cream-100 text-navy"
                          : "text-navy-700 hover:bg-cream-100 hover:text-navy",
                      )}
                    >
                      {item.label}
                      <span aria-hidden="true" className="text-sm font-bold tracking-widest text-gold-700">
                        0{index + 1}
                      </span>
                    </Link>
                  </motion.li>
                );
              })}
            </motion.ul>
          </nav>

          <motion.div
            className="shrink-0 border-t border-sand px-5 pb-6 pt-5"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 12 }}
            transition={{ duration: 0.25, delay: 0.2 }}
          >
            <Link
              href="/menu"
              onClick={onClose}
              className="focus-gold flex h-[3.25rem] items-center justify-center gap-2 rounded-full bg-navy text-base font-semibold text-cream transition-colors hover:bg-navy-800"
            >
              Explore the Menu
              <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </Link>
            <p className="mt-3 text-center text-sm text-ink-muted">
              Authentic Nigerian cuisine, ordered online across Canada.
            </p>
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>,
    document.body,
  );
}
