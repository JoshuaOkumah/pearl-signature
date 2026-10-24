"use client";

import Link from "next/link";
import { AlertCircle, ArrowRight, RefreshCw, Trash2 } from "lucide-react";
import { useState } from "react";
import { isCartEmpty } from "@/lib/cart/core";
import { useCart } from "@/lib/cart/context";
import { Button, ButtonLink } from "@/components/ui/button";
import { CartLineRow } from "./cart-line-row";
import { CartSummary } from "./cart-summary";
import { EmptyCart } from "./cart-drawer";

/**
 * `/cart` — the spacious, dedicated cart page.
 *
 * Same data source as the drawer (the cart context), so the two surfaces can
 * never disagree. Editing here is instant and local; verification against the
 * catalogue happens through the same coalesced server quote.
 */
export function CartPageClient() {
  const cart = useCart();
  const [confirmingClear, setConfirmingClear] = useState(false);

  if (!cart.hydrated || isCartEmpty(cart.state)) {
    return (
      <div className="rounded-3xl border border-border bg-surface px-5 shadow-card sm:px-8">
        <EmptyCart compact />
      </div>
    );
  }

  const blockedCount = cart.lines.filter((line) => line.quote?.issue != null).length;
  const hasBlocking = blockedCount > 0;

  return (
    <div className="flex flex-col gap-8 lg:flex-row lg:items-start lg:gap-10">
      {/* Lines */}
      <div className="min-w-0 flex-1">
        <div className="rounded-3xl border border-border bg-surface px-5 shadow-card sm:px-7">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-sand py-5">
            <h2 className="text-sm font-bold uppercase tracking-[0.14em] text-gold-700">
              {cart.totalQuantity} {cart.totalQuantity === 1 ? "item" : "items"}
            </h2>
            <ClearCartControl
              confirming={confirmingClear}
              onConfirm={() => {
                cart.clear();
                setConfirmingClear(false);
              }}
              onCancel={() => setConfirmingClear(false)}
              onArm={() => setConfirmingClear(true)}
            />
          </div>

          <CartNotices />

          <ul>
            {cart.lines.map((line) => (
              <CartLineRow
                key={line.key}
                line={line}
                state={cart.state}
                density="page"
                onQuantityChange={cart.setQuantity}
                onRemove={cart.remove}
              />
            ))}
          </ul>

          {cart.storageAvailable === false ? (
            <p className="mb-5 rounded-xl bg-gold-100 px-4 py-3 text-sm font-medium leading-relaxed text-gold-700">
              This browser is blocking saved carts, so your selections will be lost when you leave this page.
            </p>
          ) : null}
        </div>

        <Link
          href="/menu"
          className="focus-gold mt-6 inline-flex items-center gap-2 rounded-full text-sm font-semibold text-navy-700 hover:text-navy"
        >
          <span aria-hidden="true">←</span>
          Return to the Menu
        </Link>
      </div>

      {/* Totals + actions */}
      <aside className="w-full shrink-0 lg:max-w-sm">
        <div className="rounded-3xl border border-border bg-surface p-5 shadow-card sm:p-6">
          <h2 className="font-display text-2xl font-semibold text-navy">Order summary</h2>
          <CartSummary
            subtotalCents={cart.subtotalCents}
            stale={cart.quoteStatus === "error" ? false : cart.quoteStale}
            checking={cart.quoteStatus !== "ready" && cart.quoteStatus !== "error"}
            unverified={cart.quoteStatus === "error"}
            onRetry={cart.refresh}
            className="mt-5"
          />

          <div className="mt-6 flex flex-col gap-2.5">
            <ButtonLink
              href="/checkout"
              variant="primary"
              className="h-[3.25rem] w-full"
              aria-disabled={hasBlocking}
              onClick={(event) => {
                if (hasBlocking) event.preventDefault();
              }}
            >
              Proceed to Checkout
              <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </ButtonLink>
            <ButtonLink href="/menu" variant="outline" className="h-12 w-full">
              Continue shopping
            </ButtonLink>
          </div>

          {hasBlocking ? (
            <p className="mt-3 text-center text-xs font-medium text-terracotta-700">
              Resolve the highlighted {blockedCount === 1 ? "item" : "items"} to continue to checkout.
            </p>
          ) : null}
        </div>
      </aside>
    </div>
  );
}

/** Clear-cart with an explicit confirmation step (no destructive surprises). */
function ClearCartControl({
  confirming,
  onArm,
  onConfirm,
  onCancel,
}: {
  confirming: boolean;
  onArm: () => void;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  if (confirming) {
    return (
      <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Confirm clearing your cart">
        <span className="text-sm font-medium text-navy-700">Remove everything?</span>
        <Button type="button" variant="secondary" size="sm" onClick={onConfirm}>
          Yes, clear my cart
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
          Keep my cart
        </Button>
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={onArm}
      className="focus-gold inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-semibold text-navy-700 transition-colors hover:bg-terracotta-100 hover:text-terracotta-700"
    >
      <Trash2 className="h-4 w-4" aria-hidden="true" />
      Clear cart
    </button>
  );
}

function CartNotices() {
  const { quoteStatus, lines, refresh } = useCart();
  if (quoteStatus !== "error") return null;

  return (
    <div className="mt-5">
      <div className="flex items-start gap-2.5 rounded-xl bg-terracotta-100 px-4 py-3">
        <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-terracotta-700" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-terracotta-700">We couldn&apos;t verify prices</p>
          <p className="mt-0.5 text-xs leading-relaxed text-terracotta-700">
            Your {lines.length} {lines.length === 1 ? "item is" : "items are"} still saved. Nothing has been
            ordered. Check your connection and try again.
          </p>
          <Button type="button" variant="ghost" size="sm" className="mt-2 text-terracotta-700" onClick={refresh}>
            <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
            Try again
          </Button>
        </div>
      </div>
    </div>
  );
}
