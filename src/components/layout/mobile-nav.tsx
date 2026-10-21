"use client";

import Link from "next/link";
import { AnimatePresence, motion } from "motion/react";
import { ArrowRight } from "lucide-react";
import { useEffect, useRef } from "react";
import type { RefObject } from "react";
import { navItems } from "@/data/navigation";
import { cn } from "@/lib/utils";

interface MobileNavProps {
  open: boolean;
  onClose: () => void;
  /** Hamburger button — focus is returned here when the menu closes. */
  triggerRef: RefObject<HTMLButtonElement | null>;
  pathname: string;
}

/**
 * Full-screen mobile navigation.
 * - Smooth open/close with staggered links
 * - Closes on link selection (handled in the Header via pathname, plus
 *   onClose here for same-page anchors) and on Escape
 * - Moves focus into the menu on open and returns it on close
 * - Locks body scroll while open and fully unmounts when closed
 */
export function MobileNav({ open, onClose, triggerRef, pathname }: MobileNavProps) {
  const firstLinkRef = useRef<HTMLAnchorElement>(null);

  useEffect(() => {
    if (!open) return;

    const trigger = triggerRef.current;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };

    document.addEventListener("keydown", onKeyDown);
    document.body.style.overflow = "hidden";
    firstLinkRef.current?.focus();

    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = "";
      trigger?.focus();
    };
  }, [open, onClose, triggerRef]);

  return (
    <AnimatePresence>
      {open ? (
        <motion.nav
          id="mobile-navigation"
          aria-label="Mobile"
          className="fixed inset-0 z-40 flex flex-col bg-cream md:hidden"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
        >
          {/* Spacer keeps content clear of the sticky header bar */}
          <div aria-hidden="true" className="h-18 shrink-0" />

          <motion.ul
            className="flex flex-col gap-1 px-6 pt-4"
            initial="closed"
            animate="open"
            exit="closed"
            variants={{
              open: { transition: { staggerChildren: 0.055, delayChildren: 0.05 } },
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
                    ref={index === 0 ? firstLinkRef : undefined}
                    href={item.href}
                    onClick={onClose}
                    aria-current={active ? "page" : undefined}
                    className={cn(
                      "focus-gold flex items-center justify-between rounded-2xl px-4 py-4 font-display text-2xl font-medium transition-colors",
                      active ? "bg-cream-100 text-navy" : "text-navy-700 hover:bg-cream-100 hover:text-navy",
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

          <motion.div
            className="mx-6 mb-10 mt-auto"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 12 }}
            transition={{ duration: 0.25, delay: 0.25 }}
          >
            <Link
              href="/menu"
              onClick={onClose}
              className="focus-gold flex h-[3.25rem] items-center justify-center gap-2 rounded-full bg-navy text-base font-semibold text-cream transition-colors hover:bg-navy-800"
            >
              Explore the Menu
              <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </Link>
            <p className="mt-4 text-center text-sm text-ink-muted">
              Authentic Nigerian cuisine · Online across Canada
            </p>
          </motion.div>
        </motion.nav>
      ) : null}
    </AnimatePresence>
  );
}
