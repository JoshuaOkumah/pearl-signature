"use client";

import { AnimatePresence, motion } from "motion/react";
import { AlertCircle, ArrowRight, RefreshCw, ShoppingBag, X } from "lucide-react";
import { useEffect, useRef, useSyncExternalStore, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";
import { formatCad } from "@/lib/format";
import { isCartEmpty } from "@/lib/cart/core";
import { useCart } from "@/lib/cart/context";
import { cn } from "@/lib/utils";
import { Button, ButtonLink } from "@/components/ui/button";
import { CartLineRow } from "./cart-line-row";

const FOCUSABLE = 'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])';

// Portal-mount detection: false while SSR/prerendering, true in the browser.
const emptySubscribe = () => () => {};
const getClientSnapshot = () => true;
const getServerSnapshot = () => false;

interface CartDrawerProps {
  open: boolean;
  onClose: () => void;
  /** Cart button in the header — focus returns here on close. */
  triggerRef: RefObject<HTMLButtonElement | null>;
}

/**
 * Quick-access cart drawer.
 *
 * Portalled into `document.body` for the same reason as the mobile nav: the
 * sticky header applies `backdrop-filter`, which creates a containing block
 * that would collapse any fixed-position descendant. Rendering the panel as a
 * body child keeps `fixed` resolving against the viewport at every width.
 *
 * Modal behaviour: focus moves to the close button on open, is trapped while
 * open, and returns to the cart button on close; Escape and backdrop clicks
 * dismiss it; body scroll is locked; the panel scrolls its own content on
 * short screens so the close button and the checkout action never scroll out
 * of reach.
 *
 * Every navigation inside the drawer is a plain `<Link>`, so the browser's own
 * handling (prefetch, modifier-clicks, middle-click) keeps working; the drawer
 * simply closes itself on the way out.
 */
export function CartDrawer({ open, onClose, triggerRef }: CartDrawerProps) {
  const mounted = useSyncExternalStore(emptySubscribe, getClientSnapshot, getServerSnapshot);
  const panelRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

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

    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
      trigger?.focus();
    };
  }, [open, onClose, triggerRef]);

  if (!mounted) return null;

  return createPortal(
    <AnimatePresence>
      {open ? (
        <motion.div
          key="cart-drawer-backdrop"
          className="fixed inset-0 z-[80] flex justify-end"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
        >
          {/* Backdrop: click outside dismisses. It is a sibling of the panel,
              so clicks inside the panel never bubble through it. */}
          <button
            type="button"
            aria-label="Close cart"
            onClick={onClose}
            tabIndex={-1}
            className="absolute inset-0 cursor-default bg-navy-900/45"
          />

          <motion.div
            key="cart-drawer-panel"
            ref={panelRef}
            role="dialog"
            aria-modal="true"
            aria-label="Shopping cart"
            className="relative flex h-full w-full max-w-md flex-col bg-cream pb-[env(safe-area-inset-bottom)] shadow-lift"
            initial={{ x: "100%" }}
            animate={{ x: 0 }}
            exit={{ x: "100%" }}
            transition={{ type: "spring", stiffness: 380, damping: 38 }}
          >
            <DrawerHeader closeRef={closeRef} onClose={onClose} />
            <DrawerBody onClose={onClose} />
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>,
    document.body,
  );
}

function DrawerHeader({
  closeRef,
  onClose,
}: {
  closeRef: RefObject<HTMLButtonElement | null>;
  onClose: () => void;
}) {
  const { totalQuantity, hydrated } = useCart();

  return (
    <div className="flex h-18 shrink-0 items-center justify-between gap-3 border-b border-border px-5 pt-[env(safe-area-inset-top)]">
      <h2 className="flex items-baseline gap-2 font-display text-xl font-semibold text-navy">
        Your cart
        {hydrated && totalQuantity > 0 ? (
          <span className="font-sans text-sm font-semibold text-ink-muted">
            {totalQuantity} {totalQuantity === 1 ? "item" : "items"}
          </span>
        ) : null}
      </h2>
      <button
        ref={closeRef}
        type="button"
        onClick={onClose}
        aria-label="Close cart"
        className="focus-gold inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-border bg-surface text-navy transition-colors hover:border-navy/40 hover:text-navy"
      >
        <X className="h-5 w-5" aria-hidden="true" />
      </button>
    </div>
  );
}

function DrawerBody({ onClose }: { onClose: () => void }) {
  const cart = useCart();
  const empty = !cart.hydrated || isCartEmpty(cart.state);

  return (
    <>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5">
        {empty ? (
          <EmptyCart onDismiss={onClose} />
        ) : (
          <>
            <CartNotices />
            <ul>
              {cart.lines.map((line) => (
                <CartLineRow
                  key={line.key}
                  line={line}
                  state={cart.state}
                  density="drawer"
                  onQuantityChange={cart.setQuantity}
                  onRemove={cart.remove}
                />
              ))}
            </ul>
            {cart.storageAvailable === false ? <StorageNotice /> : null}
          </>
        )}
      </div>

      {!empty ? <DrawerFooter onDismiss={onClose} /> : null}
    </>
  );
}

/** Honest empty state — no invented products, one clear way forward. */
export function EmptyCart({ onDismiss, compact = false }: { onDismiss?: () => void; compact?: boolean }) {
  return (
    <div className={cn("flex flex-col items-center text-center", compact ? "py-10" : "py-16 md:py-20")}>
      <span className="mb-5 inline-flex h-16 w-16 items-center justify-center rounded-full bg-cream-200 text-navy-700">
        <ShoppingBag className="h-7 w-7" aria-hidden="true" />
      </span>
      <p className="max-w-xs font-display text-2xl font-semibold leading-snug text-navy">
        Your cart is waiting for something delicious.
      </p>
      <p className="mt-3 max-w-sm text-sm leading-relaxed text-ink-muted">
        Browse the menu to add Nigerian classics, pastries and traditional drinks.
      </p>
      <ButtonLink href="/menu" variant="primary" className="mt-6" onClick={onDismiss}>
        Explore the Menu
        <ArrowRight className="h-4 w-4" aria-hidden="true" />
      </ButtonLink>
    </div>
  );
}

/** Reconciliation problems, grouped so nothing is missed. */
function CartNotices() {
  const { quoteStatus, lines, refresh } = useCart();
  const blockedCount = lines.filter((line) => line.quote?.issue != null).length;

  if (quoteStatus !== "error" && blockedCount === 0) return null;

  return (
    <div className="flex flex-col gap-2 pt-4">
      {quoteStatus === "error" ? (
        <div className="flex items-start gap-2.5 rounded-xl bg-terracotta-100 px-3.5 py-3">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-terracotta-700" aria-hidden="true" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-terracotta-700">We couldn&apos;t verify prices</p>
            <p className="mt-0.5 text-xs leading-relaxed text-terracotta-700">
              Your items are saved. Check your connection and try again.
            </p>
            <Button type="button" variant="ghost" size="sm" className="mt-2 text-terracotta-700" onClick={refresh}>
              <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
              Try again
            </Button>
          </div>
        </div>
      ) : null}

      {blockedCount > 0 ? (
        <p className="rounded-xl bg-cream-200 px-3.5 py-2.5 text-xs font-medium leading-relaxed text-navy-700">
          {blockedCount} {blockedCount === 1 ? "item needs" : "items need"} your attention before checkout.
        </p>
      ) : null}
    </div>
  );
}

function StorageNotice() {
  return (
    <p className="mt-4 rounded-xl bg-gold-100 px-3.5 py-2.5 text-xs font-medium leading-relaxed text-gold-700">
      This browser is blocking saved carts, so your selections will be lost when you leave this page.
    </p>
  );
}

function DrawerFooter({ onDismiss }: { onDismiss: () => void }) {
  const { subtotalCents, quoteStatus, quoteStale, lines } = useCart();
  const hasBlocking = lines.some((line) => line.quote?.issue != null);

  return (
    <div className="shrink-0 border-t border-sand bg-cream-100 px-5 pb-6 pt-4">
      <div className="flex items-baseline justify-between gap-4">
        <span className="text-sm font-medium text-ink-muted">Subtotal</span>
        <span className="text-right">
          {subtotalCents === null ? (
            quoteStatus === "error" ? (
              <span className="text-base font-semibold text-ink-muted">Could not be verified</span>
            ) : quoteStatus === "ready" && !quoteStale ? (
              <span className="text-base font-semibold text-ink-muted">No verified items</span>
            ) : (
              <span className="text-base font-semibold text-ink-muted">Updating…</span>
            )
          ) : (
            <span className="text-xl font-semibold tabular-nums text-navy">{formatCad(subtotalCents)}</span>
          )}
        </span>
      </div>

      <p className="mt-1 text-xs leading-relaxed text-ink-muted">
        {quoteStatus === "error"
          ? "Prices could not be verified. Delivery and taxes are confirmed at checkout."
          : quoteStale
            ? "Updating prices… Delivery and taxes are confirmed at checkout."
            : "Delivery and taxes are confirmed at checkout."}
      </p>

      <div className="mt-4 flex flex-col gap-2">
        {hasBlocking ? (
          <span
            aria-disabled="true"
            className="inline-flex h-[3.25rem] w-full cursor-not-allowed items-center justify-center gap-2 rounded-full bg-navy/40 font-sans text-base font-semibold tracking-[0.01em] text-cream"
          >
            Proceed to Checkout
            <ArrowRight className="h-4 w-4" aria-hidden="true" />
          </span>
        ) : (
          <ButtonLink href="/checkout" variant="primary" className="h-[3.25rem] w-full" onClick={onDismiss}>
            Proceed to Checkout
            <ArrowRight className="h-4 w-4" aria-hidden="true" />
          </ButtonLink>
        )}
        <ButtonLink href="/cart" variant="outline" className="h-12 w-full" onClick={onDismiss}>
          View Cart
        </ButtonLink>
      </div>

      {hasBlocking ? (
        <p className="mt-3 text-center text-xs font-medium text-terracotta-700">
          Resolve the highlighted items to continue.
        </p>
      ) : null}

      <button
        type="button"
        onClick={onDismiss}
        className="focus-gold mx-auto mt-3 block rounded-full px-3 py-1.5 text-sm font-semibold text-navy-700 hover:text-navy"
      >
        Continue shopping
      </button>
    </div>
  );
}

/** Shared shell so `/cart` frames the same list with the same empty state. */
export function CartPanel({ children, footer }: { children: ReactNode; footer?: ReactNode }) {
  return (
    <div className="rounded-3xl border border-border bg-surface shadow-card">
      <div className="px-5 sm:px-7">{children}</div>
      {footer}
    </div>
  );
}
