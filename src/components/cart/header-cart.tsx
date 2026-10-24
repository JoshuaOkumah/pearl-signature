"use client";

import Link from "next/link";
import { AnimatePresence, motion } from "motion/react";
import { Check, ShoppingBag, X } from "lucide-react";
import { useSyncExternalStore, type RefObject } from "react";
import { createPortal } from "react-dom";
import { useCart } from "@/lib/cart/context";
import { cn } from "@/lib/utils";

// Portal-mount detection: false while SSR/prerendering, true in the browser.
const emptySubscribe = () => () => {};
const getClientSnapshot = () => true;
const getServerSnapshot = () => false;

interface CartButtonProps {
  triggerRef: RefObject<HTMLButtonElement | null>;
  onClick: () => void;
}

/**
 * Header cart control.
 *
 * It is a BUTTON, not a link, because its job is to open the drawer and to
 * receive focus back when the drawer closes. Navigation to `/cart` lives
 * inside the drawer. The quantity is part of the accessible name, so a screen
 * reader user hears the count without having to open anything, and the visual
 * badge is hidden from the accessibility tree to avoid announcing it twice.
 *
 * The count is withheld until the persisted cart has been read, which is what
 * stops a "0" flashing on first paint before the real value arrives.
 */
export function CartButton({ triggerRef, onClick }: CartButtonProps) {
  const { totalQuantity, hydrated } = useCart();
  const count = hydrated ? totalQuantity : 0;

  return (
    <button
      ref={triggerRef}
      type="button"
      onClick={onClick}
      aria-label={count === 0 ? "Open your cart, it is empty" : `Open your cart, ${count} items`}
      className="focus-gold relative inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-border bg-surface text-navy transition-colors hover:border-navy/40"
    >
      <ShoppingBag className="h-5 w-5" aria-hidden="true" />
      {hydrated && count > 0 ? (
        <motion.span
          key={count}
          initial={{ scale: 0.6, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ type: "spring", stiffness: 520, damping: 28 }}
          aria-hidden="true"
          className="absolute -right-0.5 -top-0.5 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-terracotta-700 px-1 text-[0.6875rem] font-bold leading-none text-cream"
        >
          {count > 99 ? "99+" : count}
        </motion.span>
      ) : null}
    </button>
  );
}

/**
 * Transient "Added to your cart" confirmation.
 *
 * Announced politely so screen reader users are told once, not on every
 * quantity tick, and dismissible without waiting. It never traps focus and
 * never covers the primary content on a phone.
 */
export function CartNotice() {
  const { notice, dismissNotice } = useCart();
  // Portal target must exist, so the notification only renders in the browser.
  const mounted = useSyncExternalStore(emptySubscribe, getClientSnapshot, getServerSnapshot);

  if (!mounted) return null;

  return createPortal(
    <AnimatePresence>
      {notice ? (
        <motion.div
          key={notice.id}
          role="status"
          aria-live="polite"
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 16 }}
          transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
          className="fixed inset-x-4 bottom-4 z-[90] mx-auto flex max-w-md items-center gap-3 rounded-2xl bg-navy px-4 py-3 text-cream shadow-lift sm:inset-x-auto sm:right-6 sm:mx-0"
        >
          <span className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-leaf">
            <Check className="h-4 w-4" aria-hidden="true" strokeWidth={3} />
          </span>
          <p className="min-w-0 flex-1 text-sm font-semibold">{notice.message}</p>
          <Link
            href="/cart"
            onClick={dismissNotice}
            className="focus-gold shrink-0 rounded-full px-2 py-1 text-sm font-semibold text-gold underline-offset-4 hover:underline"
          >
            View cart
          </Link>
          <button
            type="button"
            onClick={dismissNotice}
            aria-label="Dismiss notification"
            className={cn(
              "focus-gold inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-cream/70",
              "transition-colors hover:bg-cream/10 hover:text-cream",
            )}
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </motion.div>
      ) : null}
    </AnimatePresence>,
    document.body,
  );
}
