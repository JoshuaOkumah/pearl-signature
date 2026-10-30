"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { AlertCircle, Banknote, CheckCircle2, Clock, CreditCard, Loader2, MapPin, Truck } from "lucide-react";
import { loadOrderConfirmationAction, startStripeCheckoutAction } from "@/lib/actions/orders";
import { confirmationKeyFor } from "@/lib/checkout/attempt";
import { formatCad } from "@/lib/format";
import type { OrderConfirmationResponse, OrderConfirmationView, OrderStatus } from "@/lib/validations/order";
import { Button, ButtonLink } from "@/components/ui/button";

/**
 * Order confirmation (Phase 5).
 *
 * Access model: the URL carries only the public reference, and this tab's
 * sessionStorage holds the 32-byte capability the server compares against a
 * sha256. Reference alone matches nothing, so links can be shared freely
 * without leaking anyone's order, and no capability ever appears in the URL,
 * a referrer header or a server log.
 *
 * Honest states are first-class here: no capability on this device, unknown
 * reference, rate limited and database unavailable all get a plain
 * explanation instead of a fake confirmation. Nothing on this page invents
 * a delivery time, a pickup address or a promise the business never made.
 */

type ConfirmationState =
  | { kind: "loading" }
  | { kind: "ready"; order: OrderConfirmationView }
  | { kind: "missing_reference" }
  | { kind: "no_capability" }
  | { kind: "not_found" }
  | { kind: "rate_limited" }
  | { kind: "unavailable" };

const STATUS_COPY: Record<OrderStatus, string> = {
  placed: "Your order has been received. It is waiting for the store to confirm it.",
  confirmed: "The store has confirmed your order.",
  preparing: "Your order is being prepared.",
  ready_for_pickup: "Your order is ready for pickup.",
  out_for_delivery: "Your order is on its way.",
  completed: "Your order is complete.",
  cancelled: "This order was cancelled.",
};

export function OrderConfirmationClient() {
  const searchParams = useSearchParams();
  const reference = (searchParams.get("ref") ?? "").trim().toUpperCase();

  // No reference means no loader to run: render the notice directly instead
  // of spending an effect (and a frame) to discover it.
  if (reference === "") {
    return <Notice state="missing_reference" reference="" />;
  }

  return <ConfirmationLoader key={reference} reference={reference} />;
}

/**
 * Fetches one order. The capability is read once when the component is
 * created, because it decides the INITIAL state — which keeps the effect's
 * body free of synchronous state updates (it only starts the request and
 * settles in the promise callbacks).
 */
function ConfirmationLoader({ reference }: { reference: string }) {
  const [accessKey] = useState(() => confirmationKeyFor(reference));
  const [state, setState] = useState<ConfirmationState>(() =>
    accessKey ? { kind: "loading" } : { kind: "no_capability" },
  );

  useEffect(() => {
    // Not an error: the expected state when the link is opened on another
    // device or after this tab's session storage is gone.
    if (!accessKey) return;

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let checks = 0;
    const load = async (): Promise<void> => {
      try {
        const response: OrderConfirmationResponse = await loadOrderConfirmationAction({ reference, accessKey });
        if (cancelled) return;
        if (response.ok) {
          setState({ kind: "ready", order: response.order });
          if (
            checks < 4 && response.order.payment.method === "stripe" &&
            ["awaiting_payment", "processing"].includes(response.order.payment.status)
          ) {
            checks += 1;
            timer = setTimeout(() => void load(), 1_500);
          }
        } else if (response.reason === "rate_limited") setState({ kind: "rate_limited" });
        else if (response.reason === "unavailable") setState({ kind: "unavailable" });
        else setState({ kind: "not_found" });
      } catch {
        if (!cancelled) setState({ kind: "unavailable" });
      }
    };
    void load();

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [reference, accessKey]);

  if (state.kind === "loading") {
    return (
      <div className="rounded-3xl border border-border bg-surface p-6 text-sm text-ink-muted">
        Loading your confirmation…
      </div>
    );
  }

  if (state.kind !== "ready") {
    return <Notice state={state.kind} reference={reference} />;
  }

  return (
    <Confirmation
      order={state.order}
      reference={reference}
      accessKey={accessKey ?? ""}
      onRefresh={async () => {
        setState({ kind: "loading" });
        const response = await loadOrderConfirmationAction({ reference, accessKey });
        if (response.ok) setState({ kind: "ready", order: response.order });
        else if (response.reason === "rate_limited") setState({ kind: "rate_limited" });
        else if (response.reason === "unavailable") setState({ kind: "unavailable" });
        else setState({ kind: "not_found" });
      }}
    />
  );
}

/* ── notices ────────────────────────────────────────────────────────── */

type NoticeKind =
  | "missing_reference"
  | "no_capability"
  | "not_found"
  | "rate_limited"
  | "unavailable";

function Notice({ state, reference }: { state: NoticeKind; reference: string }) {
  const content = {
    missing_reference: {
      title: "No order reference was provided",
      body: "Open the confirmation link you received when your order was placed.",
    },
    no_capability: {
      title: "This confirmation can only be opened where the order was placed",
      body:
        "For privacy, order details can only be opened from the browser session that placed the order." +
        (reference ? ` This link refers to order ${reference}.` : ""),
    },
    not_found: {
      title: "We could not find that order",
      body:
        "The reference or the confirmation for it does not match anything we have. " +
        "If you placed this order in another browser, open the confirmation there.",
    },
    rate_limited: {
      title: "Too many attempts",
      body: "Please wait a few minutes before trying to open this confirmation again.",
    },
    unavailable: {
      title: "The confirmation is unavailable right now",
      body: "Your order is stored. Please reload this page in a moment to try again.",
    },
  }[state];

  return (
    <div
      className="rounded-3xl border border-border bg-surface p-6 shadow-card"
      role="alert"
      data-testid="confirmation-notice"
    >
      <p className="flex items-center gap-2 font-display text-xl font-semibold text-navy">
        <AlertCircle className="h-5 w-5 shrink-0 text-gold-700" aria-hidden="true" />
        {content.title}
      </p>
      <p className="mt-2 text-sm leading-relaxed text-ink-muted">{content.body}</p>
      <div className="mt-5 flex flex-wrap gap-3">
        <ButtonLink href="/menu" variant="primary" size="sm">
          Browse the menu
        </ButtonLink>
        <ButtonLink href="/checkout" variant="outline" size="sm">
          Back to checkout
        </ButtonLink>
      </div>
    </div>
  );
}

/* ── the confirmation itself ────────────────────────────────────────── */

function Confirmation({
  order,
  reference,
  accessKey,
  onRefresh,
}: {
  order: OrderConfirmationView;
  reference: string;
  accessKey: string;
  onRefresh: () => Promise<void>;
}) {
  const cancelled = order.status === "cancelled";
  const [retrying, setRetrying] = useState(false);
  const [paymentError, setPaymentError] = useState<string | null>(null);

  async function retryStripePayment(): Promise<void> {
    if (retrying) return;
    setRetrying(true);
    setPaymentError(null);
    try {
      const result = await startStripeCheckoutAction({ reference, accessKey });
      if (result.ok) {
        window.location.assign(result.url);
        return;
      }
      if (result.reason === "payment_pending") {
        await onRefresh();
        setPaymentError("We are checking the payment status. Please check this order again shortly.");
      } else if (result.reason === "already_paid") {
        await onRefresh();
      } else {
        setPaymentError("Secure payment could not be started. Your order details are saved. Please try again later.");
      }
    } catch {
      setPaymentError("Secure payment could not be started. Your order details are saved. Please try again later.");
    } finally {
      setRetrying(false);
    }
  }

  return (
    <div className="flex flex-col gap-6" data-testid="order-confirmation">
      <div className="rounded-3xl border border-leaf-700/30 bg-leaf-700/10 p-5 sm:p-6">
        <p className="flex items-center gap-2 font-display text-2xl font-semibold text-navy">
          <CheckCircle2 className="h-6 w-6 shrink-0 text-leaf-700" aria-hidden="true" />
          {cancelled ? "Order received" : "Your order is in"}
        </p>
        <p className="mt-2 text-sm leading-relaxed text-navy-700">{STATUS_COPY[order.status]}</p>
        <p className="mt-3 inline-flex items-center gap-2 rounded-full bg-surface px-3 py-1.5 text-sm font-bold tracking-wide text-navy">
          <Clock className="h-4 w-4 text-gold-700" aria-hidden="true" />
          {order.reference}
        </p>
        <p className="mt-2 text-xs text-ink-muted">
          Placed {formatDateTime(order.placedAtIso)}. Keep this reference handy.
        </p>
      </div>

      {/* ── items ─────────────────────────────────────────────────── */}

      <section aria-label="Ordered items" className="rounded-3xl border border-border bg-surface p-5 sm:p-6">
        <h2 className="font-display text-xl font-semibold text-navy">What you ordered</h2>
        <ul className="mt-4 flex flex-col divide-y divide-sand">
          {order.items.map((item, index) => (
            <li key={`${item.name}-${index}`} className="flex items-start justify-between gap-4 py-3">
              <div className="min-w-0">
                <p className="text-sm font-semibold text-navy">{item.name}</p>
                {item.variantName ? <p className="text-xs text-ink-muted">{item.variantName}</p> : null}
                <p className="mt-0.5 text-xs text-ink-muted">
                  {item.quantity} × {formatCad(item.unitPriceCents)}
                </p>
              </div>
              <p className="shrink-0 text-sm font-semibold tabular-nums text-navy-700">
                {formatCad(item.lineTotalCents)}
              </p>
            </li>
          ))}
        </ul>

        <dl className="mt-4 flex flex-col gap-2 border-t border-sand pt-4 text-sm">
          <Row label="Subtotal" value={formatCad(order.money.subtotalCents)} />
          <Row
            label="Delivery fee"
            value={order.money.deliveryFeeCents > 0 ? formatCad(order.money.deliveryFeeCents) : "No delivery fee"}
          />
          <Row label={order.money.taxLabel ?? "Tax"} value={formatCad(order.money.taxCents)} />
          <div className="flex items-baseline justify-between gap-3 border-t border-sand pt-3 text-base font-bold text-navy">
            <dt>Total</dt>
            <dd className="tabular-nums" data-testid="confirmation-total">
              {formatCad(order.money.totalCents)}
            </dd>
          </div>
        </dl>
      </section>

      {/* ── fulfilment and payment ────────────────────────────────── */}

      <div className="grid gap-6 sm:grid-cols-2">
        <section
          aria-label="Fulfilment"
          className="rounded-3xl border border-border bg-surface p-5"
        >
          <h2 className="flex items-center gap-2 font-display text-lg font-semibold text-navy">
            {order.fulfillment.method === "delivery" ? (
              <Truck className="h-4 w-4 text-gold-700" aria-hidden="true" />
            ) : (
              <MapPin className="h-4 w-4 text-gold-700" aria-hidden="true" />
            )}
            {order.fulfillment.method === "delivery" ? "Delivery" : "Pickup"}
          </h2>
          {order.fulfillment.method === "delivery" ? (
            <p className="mt-2 text-sm leading-relaxed text-ink-muted">
              {order.fulfillment.serviceAreaLabel
                ? `Delivering to the ${order.fulfillment.serviceAreaLabel} area.`
                : "Your delivery details were recorded with the order."}
            </p>
          ) : (
            <p className="mt-2 text-sm leading-relaxed text-ink-muted">
              {order.fulfillment.pickupInstructions ??
                "Pickup details will be confirmed with you directly."}
            </p>
          )}
        </section>

        <section aria-label="Payment" className="rounded-3xl border border-border bg-surface p-5">
          <h2 className="flex items-center gap-2 font-display text-lg font-semibold text-navy">
            {order.payment.method === "stripe" ? (
              <CreditCard className="h-4 w-4 text-gold-700" aria-hidden="true" />
            ) : (
              <Banknote className="h-4 w-4 text-gold-700" aria-hidden="true" />
            )}
            {order.payment.method === "stripe" ? "Online payment" : "Cash on arrival"}
          </h2>
          {order.payment.method === "cash_on_arrival" && order.payment.status === "paid" ? (
            <p className="mt-2 text-sm font-semibold leading-relaxed text-leaf-700">
              Payment has been received. Thank you.
            </p>
          ) : order.payment.method === "cash_on_arrival" ? (
            <>
              <p className="mt-2 text-sm leading-relaxed text-ink-muted">
                Nothing has been paid online. Payment of{" "}
                <strong className="font-bold text-navy" data-testid="confirmation-amount-due">
                  {formatCad(order.money.totalCents)}
                </strong>{" "}
                is still due in cash when your order is delivered or collected.
              </p>
              <p className="mt-2 text-xs leading-relaxed text-ink-muted">
                Your order is confirmed by this message; the payment is confirmed separately once it
                is received.
              </p>
            </>
          ) : order.payment.status === "paid" ? (
            <p className="mt-2 text-sm font-semibold leading-relaxed text-leaf-700">
              Payment received. Thank you for your order.
            </p>
          ) : order.payment.status === "partially_refunded" || order.payment.status === "refunded" ? (
            <p className="mt-2 text-sm leading-relaxed text-navy-700">
              {formatCad(order.payment.refundedAmountCents)} has been confirmed as refunded by the payment provider.
            </p>
          ) : order.payment.status === "awaiting_payment" || order.payment.status === "processing" ? (
            <>
              <p className="mt-2 text-sm leading-relaxed text-ink-muted">We&apos;re confirming your payment. Your order details are saved.</p>
              <Button type="button" variant="outline" size="sm" className="mt-3" onClick={() => void onRefresh()}>
                Check payment status
              </Button>
            </>
          ) : order.payment.status === "failed" || order.payment.status === "expired" ? (
            <p className="mt-2 text-sm leading-relaxed text-terracotta-700">Your payment wasn&apos;t completed. You can try again.</p>
          ) : order.payment.status === "review_required" ? (
            <p className="mt-2 text-sm leading-relaxed text-ink-muted">Your payment needs a manual review. Your order details are saved.</p>
          ) : (
            <p className="mt-2 text-sm leading-relaxed text-ink-muted">Payment has not been started.</p>
          )}
          {order.payment.method === "stripe" && order.payment.status !== "paid" && order.payment.status !== "refunded" && order.payment.status !== "partially_refunded" && order.payment.status !== "review_required" ? (
            <>
              <p className="mt-2 text-sm leading-relaxed text-ink-muted">Order total: <strong className="text-navy">{formatCad(order.money.totalCents)}</strong></p>
              {order.payment.retryAvailable ? (
                <Button type="button" variant="primary" size="sm" className="mt-3" disabled={retrying} onClick={() => void retryStripePayment()}>
                  {retrying ? <><Loader2 className="h-4 w-4 motion-safe:animate-spin" aria-hidden="true" /> Connecting securely…</> : "Continue to Secure Payment"}
                </Button>
              ) : null}
              {paymentError ? <p role="alert" className="mt-3 text-sm text-terracotta-700">{paymentError}</p> : null}
            </>
          ) : null}
        </section>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <ButtonLink href="/menu" variant="primary" size="sm">
          Continue browsing
        </ButtonLink>
        <Link
          href={`/track?ref=${encodeURIComponent(order.reference)}`}
          className="focus-gold rounded text-sm font-semibold text-navy-700 underline underline-offset-4 hover:text-navy"
        >
          Track this order
        </Link>
        <Link
          href="/cart"
          className="focus-gold rounded text-sm font-semibold text-navy-700 underline underline-offset-4 hover:text-navy"
        >
          Back to your cart
        </Link>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="flex items-baseline justify-between gap-3 text-ink-muted">
      <dt>{label}</dt>
      <dd className="tabular-nums text-navy-700">{value ?? "-"}</dd>
    </div>
  );
}

function formatDateTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString("en-CA", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}
