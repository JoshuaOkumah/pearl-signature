"use client";

import Link from "next/link";
import { AlertCircle, AlertTriangle, ArrowLeft, ShieldCheck } from "lucide-react";
import { isCartEmpty } from "@/lib/cart/core";
import { quoteIssueCopy } from "@/lib/cart/issues";
import { useCart } from "@/lib/cart/context";
import { cn } from "@/lib/utils";
import { CartSummary } from "@/components/cart/cart-summary";
import { CartLineRow } from "@/components/cart/cart-line-row";
import { EmptyCart } from "@/components/cart/cart-drawer";
import { CustomerForm } from "./customer-form";

/**
 * `/checkout` — the review step of the checkout foundation.
 *
 * Two-column on desktop (details left, summary right), a single comfortable
 * column on mobile with the summary directly after the details so it is
 * always one scroll away. Nothing sticky is used on small screens, so a soft
 * keyboard never covers a field or the primary action.
 *
 * Every price shown here comes from the server quote. While verification is
 * in flight the figures read "Checking…" rather than displaying a number the
 * server has not confirmed.
 */
export function CheckoutClient() {
  const cart = useCart();
  const empty = !cart.hydrated || isCartEmpty(cart.state);

  if (empty) {
    return (
      <div className="rounded-3xl border border-border bg-surface px-5 shadow-card sm:px-8">
        <EmptyCart compact />
      </div>
    );
  }

  const blockedCount = cart.lines.filter((line) => line.quote?.issue != null).length;

  return (
    <div className="flex flex-col gap-10 lg:flex-row lg:items-start lg:gap-12">
      <div className="min-w-0 flex-1">
        <CustomerForm />
      </div>

      <aside className="w-full shrink-0 lg:max-w-md lg:sticky lg:top-24">
        <div className="rounded-3xl border border-border bg-surface p-5 shadow-card sm:p-6">
          <div className="flex items-baseline justify-between gap-3">
            <h2 className="font-display text-2xl font-semibold text-navy">Your order</h2>
            <Link
              href="/cart"
              className="focus-gold rounded text-sm font-semibold text-navy-700 underline underline-offset-4 hover:text-navy"
            >
              Edit cart
            </Link>
          </div>

          <OrderLines />

          <CartSummary
            subtotalCents={cart.subtotalCents}
            stale={cart.quoteStatus === "error" ? false : cart.quoteStale}
            checking={cart.quoteStatus !== "ready" && cart.quoteStatus !== "error"}
            unverified={cart.quoteStatus === "error"}
            onRetry={cart.refresh}
            className="mt-6 border-t border-sand pt-5"
          />

          <UnavailablePanel blockedCount={blockedCount} />
          <NotOrderingPanel />
        </div>
      </aside>
    </div>
  );
}

/** Server-validated lines with images, current prices and reconciliation. */
function OrderLines() {
  const cart = useCart();

  return (
    <ul className="mt-4 border-t border-sand">
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
  );
}

/**
 * Reconciliation summary. Colour is never the only signal: every warning
 * carries an icon and plain wording as well.
 */
function UnavailablePanel({ blockedCount }: { blockedCount: number }) {
  const cart = useCart();
  const unverified = cart.quoteStatus === "error";

  if (!unverified && blockedCount === 0) return null;

  return (
    <div className="mt-6 flex flex-col gap-3">
      {unverified ? (
        <div className="flex items-start gap-2.5 rounded-2xl bg-terracotta-100 px-4 py-3">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-terracotta-700" aria-hidden="true" />
          <div className="min-w-0">
            <p className="text-sm font-semibold text-terracotta-700">Prices could not be verified</p>
            <p className="mt-0.5 text-xs leading-relaxed text-terracotta-700">
              Your items are saved and nothing has been submitted. Try again in a moment.
            </p>
          </div>
        </div>
      ) : null}

      {blockedCount > 0 ? (
        <div className="rounded-2xl bg-cream-100 px-4 py-3">
          <p className="flex items-center gap-2 text-sm font-semibold text-navy">
            <AlertTriangle className="h-4 w-4 shrink-0 text-terracotta-700" aria-hidden="true" />
            {blockedCount} {blockedCount === 1 ? "item needs" : "items need"} attention
          </p>
          <ul className="mt-2 flex flex-col gap-1.5">
            {cart.lines
              .filter((line) => line.quote?.issue != null)
              .map((line) => (
                <li key={line.key} className="flex items-baseline justify-between gap-3 text-xs">
                  <span className="min-w-0 truncate font-medium text-navy-700">
                    {line.quote?.name ?? line.slug}
                    {line.variantName ? <span className="text-ink-muted"> · {line.variantName}</span> : null}
                  </span>
                  <span className="shrink-0 text-terracotta-700">
                    {quoteIssueCopy(line.quote!.issue!)}
                  </span>
                </li>
              ))}
          </ul>
          <p className="mt-2 text-xs leading-relaxed text-ink-muted">
            Remove the highlighted items, or update them in your cart, to continue.
          </p>
        </div>
      ) : null}
    </div>
  );
}

/**
 * Where the "Place order" button will eventually live.
 *
 * It is an explanation, not a disabled control: a button that looks ready and
 * does nothing is worse than an honest message. Order creation, payment and
 * confirmation are later phases.
 */
function NotOrderingPanel() {
  return (
    <div className="mt-6 rounded-2xl border border-dashed border-navy/25 bg-cream-100 p-4">
      <p className="flex items-center gap-2 font-display text-lg font-semibold text-navy">
        <ShieldCheck className="h-5 w-5 shrink-0 text-leaf-700" aria-hidden="true" />
        Order placement is not available yet
      </p>
      <p className="mt-2 text-sm leading-relaxed text-ink-muted">
        This page reviews your basket and checks every price against the menu. Taking payment, confirming
        delivery and sending receipts arrive in a later release, so there is nothing to submit here yet.
      </p>
      <p className="mt-3 text-xs leading-relaxed text-ink-muted">
        Your details stay in this browser tab and are never sent anywhere.
      </p>
    </div>
  );
}

/** Compact back-link used above the checkout content. */
export function CheckoutBackLink({ className }: { className?: string }) {
  return (
    <Link
      href="/cart"
      className={cn(
        "focus-gold inline-flex items-center gap-2 rounded-full text-sm font-semibold text-navy-700 hover:text-navy",
        className,
      )}
    >
      <ArrowLeft className="h-4 w-4" aria-hidden="true" />
      Back to your cart
    </Link>
  );
}

/** Live region announcing verification state changes to screen readers. */
export function QuoteStatusAnnouncer() {
  const { quoteStatus, quoteStale } = useCart();
  const message =
    quoteStatus === "error"
      ? "Prices could not be verified."
      : quoteStatus === "ready" && !quoteStale
        ? "Prices verified."
        : "";

  return (
    <p role="status" aria-live="polite" className="sr-only">
      {message}
    </p>
  );
}
