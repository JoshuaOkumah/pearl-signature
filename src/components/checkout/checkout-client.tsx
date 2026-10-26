"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  AlertCircle,
  AlertTriangle,
  ArrowLeft,
  Banknote,
  Loader2,
  ShieldCheck,
} from "lucide-react";
import { placeOrderAction, startStripeCheckoutAction } from "@/lib/actions/orders";
import { clearOrderedLines } from "@/lib/cart/store";
import { isCartEmpty } from "@/lib/cart/core";
import { quoteIssueCopy } from "@/lib/cart/issues";
import { useCart } from "@/lib/cart/context";
import {
  attemptFor,
  checkoutSignature,
  clearAttempt,
  freshAttempt,
  saveConfirmation,
  type CheckoutAttempt,
} from "@/lib/checkout/attempt";
import { checkoutBlockers, priceCheckout, type PriceBlocker } from "@/lib/checkout/pricing";
import { formatCad } from "@/lib/format";
import type { PaymentMethod, PlaceOrderResponse, StartPaymentActionResponse } from "@/lib/validations/order";
import { normalizePostalCode } from "@/lib/validations/checkout";
import { cn } from "@/lib/utils";
import { CartLineRow } from "@/components/cart/cart-line-row";
import { EmptyCart } from "@/components/cart/cart-drawer";
import { Button } from "@/components/ui/button";
import { CustomerForm } from "./customer-form";
import { useCheckoutForm, useCheckoutSettings } from "./use-checkout";

/**
 * `/checkout` (Phase 5): review, price, pay on arrival, place the order.
 *
 * Layout is unchanged from Phase 4 (details left, summary right on desktop;
 * one comfortable column on mobile), but the right-hand panel is now a real
 * order flow:
 *
 *  - every figure comes from the server quote plus the owner's published
 *    configuration, computed by the SAME `priceCheckout` the server runs at
 *    submission, so the reviewed total and the persisted total cannot drift;
 *  - Cash on Arrival must be chosen explicitly before submission, and the
 *    wording never implies an online payment;
 *  - a total the server recomputes differently is rejected as a PRICE
 *    CHANGE: the customer reviews the new amount and submits again, and
 *    only then does an order exist;
 *  - failure paths never clear the basket or the form, and success clears
 *    only the lines that were actually ordered before moving to the
 *    confirmation page.
 */

const BLOCKER_COPY: Record<PriceBlocker, string> = {
  settings_unavailable:
    "Checkout availability could not be confirmed right now. Nothing has been submitted and your basket is unchanged.",
  intake_closed: "The store is not accepting orders right now.",
  no_fulfillment_method:
    "Delivery and pickup have not been set up yet, so orders cannot be accepted.",
  tax_unconfigured:
    "The tax treatment has not been confirmed yet, so a final total cannot be shown.",
  method_unavailable: "The fulfilment option selected is not available right now.",
  area_unsupported: "This address is outside the delivery areas currently served.",
  total_out_of_bounds: "This order total is outside the supported range.",
};

const FAILURE_COPY: Record<string, string> = {
  invalid: "Some order details could not be accepted. Check the highlighted fields and try again.",
  unavailable:
    "We could not place your order right now. Nothing was submitted and your basket is unchanged. Please try again.",
  cart_issue:
    "Some items changed and can no longer be ordered. Review the highlighted items in your basket, then try again.",
};

/** Notices produced while reviewing and submitting ONE order intent. */
interface ReviewState {
  signature: string;
  submitError: string | null;
  serverBlocker: PriceBlocker | null;
  priceChange: { from: number; to: number } | null;
  acknowledged: boolean;
}

function emptyReview(signature: string): ReviewState {
  return {
    signature,
    submitError: null,
    serverBlocker: null,
    priceChange: null,
    acknowledged: false,
  };
}

export function CheckoutClient() {
  const cart = useCart();
  const form = useCheckoutForm();
  const settingsState = useCheckoutSettings();
  const router = useRouter();

  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [placed, setPlaced] = useState(false);
  const [review, setReview] = useState<ReviewState>(() => emptyReview("initial"));

  const settings = settingsState.settings;
  const items = useMemo(
    () =>
      cart.state.items.map((item) => ({
        slug: item.slug,
        variantName: item.variantName,
        quantity: item.quantity,
      })),
    [cart.state.items],
  );

  // The intent signature drives idempotency: changing the basket or the
  // customer's details starts a new attempt, an unchanged intent reuses one.
  const signature = useMemo(
    () => checkoutSignature(items, form.values, paymentMethod ?? "cash_on_arrival"),
    [items, form.values, paymentMethod],
  );

  // Review notices (price change, blocker, error) belong to ONE intent. When
  // the intent changes they are discarded by derivation rather than by an
  // effect, so a stale notice can never be shown against a new basket.
  const current = review.signature === signature ? review : emptyReview(signature);
  const { submitError, serverBlocker, priceChange, acknowledged } = current;
  const updateReview = (patch: Partial<Omit<ReviewState, "signature">>): void => {
    setReview((previous) => ({
      ...(previous.signature === signature ? previous : emptyReview(signature)),
      ...patch,
    }));
  };

  // Default the fulfilment choice to an option the owner actually offers.
  useEffect(() => {
    if (settingsState.status !== "ready" || !settings) return;
    const current = form.values.fulfillment;
    const currentOffered =
      current === "delivery" ? settings.deliveryEnabled : settings.pickupEnabled;
    if (currentOffered) return;
    if (settings.deliveryEnabled) form.update("fulfillment", "delivery");
    else if (settings.pickupEnabled) form.update("fulfillment", "pickup");
    // Intentionally keyed on the settings state only: re-running on every
    // keystroke would fight the customer's own selection.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settingsState.status, settings]);

  /* ── price preview (identical logic to the server) ─────────────── */

  const method = form.values.fulfillment;
  const addressReady =
    method === "pickup" ||
    (Boolean(form.values.province) && normalizePostalCode(form.values.postalCode) !== null);

  const preview =
    settings && cart.subtotalCents !== null && addressReady
      ? priceCheckout({
          subtotalCents: cart.subtotalCents,
          method,
          address:
            method === "delivery"
              ? { province: form.values.province, postalCode: form.values.postalCode }
              : null,
          settings,
        })
      : null;

  /* ── readiness ─────────────────────────────────────────────────── */

  const readinessBlockers: PriceBlocker[] = [];
  if (settingsState.status === "error") readinessBlockers.push("settings_unavailable");
  else if (settings && checkoutBlockers(settings).length > 0) {
    readinessBlockers.push(...checkoutBlockers(settings));
  } else if (preview && !preview.ok) readinessBlockers.push(preview.blocker);
  if (serverBlocker && !readinessBlockers.includes(serverBlocker)) {
    readinessBlockers.push(serverBlocker);
  }

  const quoteReady =
    cart.quoteStatus === "ready" && !cart.quoteStale && !cart.quote?.hasIssues;
  const totalsReady = preview?.ok === true;
  const awaitingAddress = method === "delivery" && !addressReady;
  // A total the customer has not acknowledged yet cannot be submitted: the
  // button says so by staying disabled instead of quietly doing nothing.
  const awaitingAcknowledgment = Boolean(priceChange && !acknowledged);
  const canSubmit =
    settingsState.status === "ready" &&
    readinessBlockers.length === 0 &&
    totalsReady &&
    quoteReady &&
    !submitting &&
    !placed &&
    !awaitingAcknowledgment;

  /* ── submission ────────────────────────────────────────────────── */

  async function submit(): Promise<void> {
    if (submitting || placed) return;
    updateReview({ submitError: null });

    if (!form.validateAll()) {
      updateReview({ submitError: "Check your details above before placing the order." });
      return;
    }
    if (!paymentMethod) {
      updateReview({ submitError: "Choose how you would like to pay before placing the order." });
      return;
    }
    if (!preview?.ok || !quoteReady) return;
    if (priceChange && !acknowledged) return;

    const expectedTotalCents = preview.totals.totalCents;
    let attempt: CheckoutAttempt = attemptFor(signature);

    const buildPayload = (candidate: CheckoutAttempt) => ({
      idempotencyKey: candidate.idempotencyKey,
      confirmationKey: candidate.confirmationKey,
      expectedTotalCents,
      items,
      customer: form.values,
      paymentMethod,
    });

    setSubmitting(true);
    try {
      let response: PlaceOrderResponse = await placeOrderAction(buildPayload(attempt));

      // The stored key was reused with a different intent (another tab
      // changed the basket under us). Start a fresh attempt and retry once.
      if (!response.ok && response.reason === "conflict") {
        attempt = freshAttempt(signature);
        response = await placeOrderAction(buildPayload(attempt));
      }

      if (response.ok) {
        saveConfirmation(response.order.reference, attempt.confirmationKey);
        if (paymentMethod === "cash_on_arrival") {
          clearAttempt();
          clearOrderedLines(items);
          setPlaced(true);
          router.push(`/order-confirmation?ref=${response.order.reference}`);
          return;
        }

        const payment: StartPaymentActionResponse = await startStripeCheckoutAction({
          reference: response.order.reference,
          accessKey: attempt.confirmationKey,
        });
        if (payment.ok) {
          clearAttempt();
          clearOrderedLines(items);
          setPlaced(true);
          window.location.assign(payment.url);
          return;
        }
        const messages: Record<string, string> = {
          payment_pending: "Your order is saved. We are checking the payment session before offering another attempt.",
          payment_unavailable: "Online payment is not available right now. Your order is saved. You can retry here or choose Cash on Arrival.",
          already_paid: "This order has already been paid. Open your order confirmation to review it.",
          attempt_limit: "Online payment could not be retried for this order. Please contact the store using its verified contact details.",
          rate_limited: "Too many payment attempts were made. Please wait a little while before trying again.",
        };
        updateReview({ submitError: messages[payment.reason] ?? "Your order is saved, but secure payment could not be started. Please try again." });
        return;
      }

      switch (response.reason) {
        case "price_changed":
          updateReview({
            priceChange: { from: expectedTotalCents, to: response.totals.totalCents },
            acknowledged: false,
          });
          cart.refresh(); // pull the new prices into the preview
          break;
        case "blocked":
          updateReview({ serverBlocker: response.blocker });
          break;
        case "rate_limited":
          updateReview({
            submitError: `Too many order attempts from this connection. Please wait ${Math.max(
              1,
              Math.round(response.retryAfterSeconds / 60),
            )} minute${Math.round(response.retryAfterSeconds / 60) === 1 ? "" : "s"} and try again.`,
          });
          break;
        case "payment_unavailable":
          updateReview({ submitError: "Online payment is not available right now. Choose Cash on Arrival or try again later." });
          break;
        case "cart_issue":
          updateReview({ submitError: FAILURE_COPY.cart_issue });
          cart.refresh();
          break;
        default:
          updateReview({ submitError: FAILURE_COPY[response.reason] ?? FAILURE_COPY.unavailable });
      }
    } catch {
      updateReview({ submitError: FAILURE_COPY.unavailable });
    } finally {
      setSubmitting(false);
    }
  }

  /* ── render states ─────────────────────────────────────────────── */

  if (placed) {
    return (
      <div className="rounded-3xl border border-border bg-surface px-5 py-10 text-center shadow-card sm:px-8">
        <Loader2 className="mx-auto h-6 w-6 motion-safe:animate-spin text-gold-700" aria-hidden="true" />
        <p className="mt-4 font-display text-2xl font-semibold text-navy">Taking you to your confirmation</p>
        <p className="mt-2 text-sm text-ink-muted">Your order has been received.</p>
      </div>
    );
  }

  if (!cart.hydrated || isCartEmpty(cart.state)) {
    return (
      <div className="rounded-3xl border border-border bg-surface px-5 shadow-card sm:px-8">
        <EmptyCart compact />
      </div>
    );
  }

  const blockedCount = cart.lines.filter((line) => line.quote?.issue != null).length;
  const awaitingPrice = !totalsReady && !awaitingAddress && readinessBlockers.length === 0;

  return (
    <div className="flex flex-col gap-10 lg:flex-row lg:items-start lg:gap-12">
      <div className="min-w-0 flex-1">
        <CustomerForm
          values={form.values}
          errors={form.errors}
          settingsState={settingsState}
          update={form.update}
          blur={form.blur}
        />
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

          <CheckoutTotals
            cart={cart}
            preview={preview}
            settings={settings}
            taxLabel={settings?.tax.label ?? null}
            awaitingAddress={awaitingAddress}
            className="mt-6 border-t border-sand pt-5"
          />

          <UnavailablePanel blockedCount={blockedCount} />

          {readinessBlockers.length > 0 ? (
            <ReadinessPanel blockers={readinessBlockers} />
          ) : (
            <>
              {priceChange && !acknowledged ? (
                <div
                  className="mt-6 rounded-2xl border border-gold-700/40 bg-gold-100 p-4"
                  role="alert"
                  data-testid="price-change"
                >
                  <p className="flex items-center gap-2 text-sm font-bold text-navy">
                    <AlertTriangle className="h-4 w-4 shrink-0 text-gold-700" aria-hidden="true" />
                    The total changed while you were reviewing it
                  </p>
                  <p className="mt-2 text-sm leading-relaxed text-navy-700">
                    The order was not submitted. The total is now{" "}
                    <strong className="font-bold text-navy">{formatCad(priceChange.to)}</strong> (it was{" "}
                    {formatCad(priceChange.from)}).
                  </p>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="mt-3"
                    onClick={() => updateReview({ acknowledged: true })}
                  >
                    I have reviewed the new total
                  </Button>
                </div>
              ) : null}

          <PaymentPanel
                selected={paymentMethod}
                onSelect={setPaymentMethod}
                onlinePaymentsAvailable={settings?.onlinePaymentsAvailable === true}
                totalCents={preview?.ok ? preview.totals.totalCents : null}
                submitting={submitting}
                canSubmit={canSubmit}
                awaitingPrice={awaitingPrice}
                awaitingAddress={awaitingAddress}
                awaitingAcknowledgment={awaitingAcknowledgment}
                error={submitError}
                onSubmit={() => void submit()}
              />
            </>
          )}
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

/* ── totals ─────────────────────────────────────────────────────────── */

function CheckoutTotals({
  cart,
  preview,
  settings,
  taxLabel,
  awaitingAddress,
  className,
}: {
  cart: ReturnType<typeof useCart>;
  preview: ReturnType<typeof priceCheckout> | null;
  settings: ReturnType<typeof useCheckoutSettings>["settings"];
  taxLabel: string | null;
  awaitingAddress: boolean;
  className?: string;
}) {
  const checking = cart.quoteStatus !== "ready" && cart.quoteStatus !== "error";
  const unverified = cart.quoteStatus === "error";
  const stale = cart.quoteStatus === "ready" && cart.quoteStale;

  const rows: Array<{ label: string; value: string; strong?: boolean }> = [];
  if (preview?.ok) {
    rows.push(
      { label: "Subtotal", value: formatCad(preview.totals.subtotalCents) ?? "" },
      {
        label: preview.totals.deliveryFeeCents > 0 ? "Delivery" : "Delivery fee",
        value: formatCad(preview.totals.deliveryFeeCents) ?? "",
      },
      {
        label: taxLabel ?? "Tax",
        value: formatCad(preview.totals.taxCents) ?? "",
      },
      { label: "Total", value: formatCad(preview.totals.totalCents) ?? "", strong: true },
    );
  } else {
    rows.push({ label: "Subtotal", value: checking ? "Checking…" : formatCad(cart.subtotalCents) ?? "-" });
  }

  return (
    <div className={className}>
      <dl className="flex flex-col gap-2">
        {rows.map((row) => (
          <div
            key={row.label}
            className={cn(
              "flex items-baseline justify-between gap-3 text-sm",
              row.strong ? "mt-1 border-t border-sand pt-3 text-base font-bold text-navy" : "text-ink-muted",
            )}
          >
            <dt className={row.strong ? "font-sans" : ""}>{row.label}</dt>
            <dd className={cn("font-sans tabular-nums", row.strong ? "text-navy" : "text-navy-700")}>
              {row.value}
            </dd>
          </div>
        ))}
      </dl>

      {!preview?.ok ? (
        <p className="mt-3 text-xs leading-relaxed text-ink-muted">
          {awaitingAddress
            ? "Enter your delivery address to see the delivery fee, tax and total."
            : "Delivery and taxes are confirmed by the store before the final total is shown."}
        </p>
      ) : null}

      {stale && !checking ? (
        <p className="mt-3 flex items-center gap-1.5 text-xs font-medium text-gold-700">
          <Loader2 className="h-3.5 w-3.5 motion-safe:animate-spin" aria-hidden="true" />
          Re-checking your total…
        </p>
      ) : null}

      {unverified ? (
        <p className="mt-3 flex items-start gap-2 text-xs font-medium text-terracotta-700">
          <AlertCircle className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          Prices could not be verified. Nothing has been submitted.
        </p>
      ) : null}

      {settings && settings.customerNote ? (
        <p className="mt-3 rounded-xl bg-cream-100 px-3 py-2 text-xs leading-relaxed text-navy-700">
          {settings.customerNote}
        </p>
      ) : null}
    </div>
  );
}

/* ── payment and submission ─────────────────────────────────────────── */

function PaymentPanel({
  selected,
  onSelect,
  onlinePaymentsAvailable,
  totalCents,
  submitting,
  canSubmit,
  awaitingPrice,
  awaitingAddress,
  awaitingAcknowledgment,
  error,
  onSubmit,
}: {
  selected: PaymentMethod | null;
  onSelect: (value: PaymentMethod) => void;
  onlinePaymentsAvailable: boolean;
  totalCents: number | null;
  submitting: boolean;
  canSubmit: boolean;
  awaitingPrice: boolean;
  awaitingAddress: boolean;
  awaitingAcknowledgment: boolean;
  error: string | null;
  onSubmit: () => void;
}) {
  return (
    <section aria-label="Payment and submission" className="mt-6">
      <h3 className="font-display text-xl font-semibold text-navy">Payment</h3>

      <label
        htmlFor="payment-cash"
        className={cn(
          "focus-within:ring-2 focus-within:ring-gold-700 focus-within:ring-offset-2 mt-3 flex cursor-pointer flex-col gap-2 rounded-2xl border p-4 transition-colors",
          selected ? "border-navy bg-cream-100" : "border-border hover:border-navy/40",
        )}
      >
        <span className="flex items-center gap-3">
          <input
            id="payment-cash"
            type="radio"
            name="payment-method"
            checked={selected === "cash_on_arrival"}
            onChange={() => onSelect("cash_on_arrival")}
            className="h-4 w-4 shrink-0 accent-navy"
          />
          <span className="flex items-center gap-2 text-base font-semibold text-navy">
            <Banknote className="h-4 w-4 text-gold-700" aria-hidden="true" />
            Cash on arrival
          </span>
        </span>
        <span className="text-sm leading-relaxed text-ink-muted">
          You pay in full when your order is delivered or collected. Your order is recorded when it is placed; payment is still due.
        </span>
      </label>

      <label
        htmlFor="payment-stripe"
        className={cn(
          "mt-3 flex cursor-pointer flex-col gap-2 rounded-2xl border p-4 transition-colors",
          "focus-within:ring-2 focus-within:ring-gold-700 focus-within:ring-offset-2",
          selected === "stripe" ? "border-navy bg-cream-100" : "border-border",
          !onlinePaymentsAvailable && "cursor-not-allowed opacity-70",
        )}
      >
        <span className="flex items-center gap-3">
          <input
            id="payment-stripe"
            type="radio"
            name="payment-method"
            checked={selected === "stripe"}
            disabled={!onlinePaymentsAvailable || submitting}
            onChange={() => onSelect("stripe")}
            className="h-4 w-4 shrink-0 accent-navy focus-gold"
          />
          <span className="flex items-center gap-2 text-base font-semibold text-navy">
            <ShieldCheck className="h-4 w-4 text-gold-700" aria-hidden="true" />
            Online payment
          </span>
        </span>
        <span className="text-sm leading-relaxed text-ink-muted">
          {onlinePaymentsAvailable
            ? "Continue to Stripe's secure hosted payment page. Your order total is fixed before you leave this site."
            : "Online payment is not available yet. Cash on Arrival remains available."}
        </span>
      </label>

      {totalCents !== null ? (
        <p className="mt-3 text-sm text-ink-muted">
          {selected === "stripe" ? "Amount to pay online: " : "Amount due on arrival: "}
          <strong className="font-bold text-navy" data-testid="amount-due">
            {formatCad(totalCents)}
          </strong>
        </p>
      ) : null}

      {error ? (
        <p
          role="alert"
          className="mt-4 flex items-start gap-2 rounded-2xl bg-terracotta-100 px-4 py-3 text-sm font-medium text-terracotta-700"
          data-testid="submit-error"
        >
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          {error}
        </p>
      ) : null}

      <div className="mt-4">
        <Button
          type="button"
          variant="primary"
          className="w-full"
          disabled={!canSubmit}
          onClick={onSubmit}
          data-testid="place-order"
        >
          {submitting ? (
            <>
              <Loader2 className="h-4 w-4 motion-safe:animate-spin" aria-hidden="true" />
              Placing your order…
            </>
          ) : (
            selected === "stripe" ? "Continue to Secure Payment" : "Place order"
          )}
        </Button>
        <p role="status" className="mt-2 text-center text-xs text-ink-muted">
          {submitting
            ? "Submitting your order. Please do not close this page."
            : canSubmit
              ? "Your order is placed once the store confirms it was received."
              : awaitingAcknowledgment
                ? "Review the new total above to continue."
                : awaitingAddress
                  ? "Enter your delivery address to continue."
                  : awaitingPrice
                    ? "Verifying your total…"
                    : "Ordering is unavailable until the store finishes its setup."}
        </p>
      </div>
    </section>
  );
}

/* ── notices ────────────────────────────────────────────────────────── */

function ReadinessPanel({ blockers }: { blockers: PriceBlocker[] }) {
  return (
    <div
      className="mt-6 rounded-2xl border border-dashed border-navy/25 bg-cream-100 p-4"
      data-testid="checkout-blocked"
    >
      <p className="flex items-center gap-2 font-display text-lg font-semibold text-navy">
        <ShieldCheck className="h-5 w-5 shrink-0 text-gold-700" aria-hidden="true" />
        Ordering is not open right now
      </p>
      <ul className="mt-2 flex flex-col gap-1.5">
        {blockers.map((blocker) => (
          <li key={blocker} className="flex items-start gap-2 text-sm leading-relaxed text-ink-muted">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-gold-700" aria-hidden="true" />
            {BLOCKER_COPY[blocker]}
          </li>
        ))}
      </ul>
      <p className="mt-3 text-xs leading-relaxed text-ink-muted">
        Your basket and everything you have typed on this page are kept here. Nothing has been sent
        or charged.
      </p>
    </div>
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
