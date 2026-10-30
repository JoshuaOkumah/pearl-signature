"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  AlertCircle,
  Check,
  CheckCircle2,
  Clock,
  Loader2,
  Lock,
  Mail,
  RefreshCw,
  ShieldCheck,
  XCircle,
} from "lucide-react";
import {
  loadOrderTrackingAction,
  requestTrackingCodeAction,
  verifyTrackingCodeAction,
} from "@/lib/actions/tracking";
import {
  clearTrackingGrant,
  confirmationKeyFor,
  saveTrackingGrant,
  trackingGrantFor,
} from "@/lib/checkout/attempt";
import { formatCad } from "@/lib/format";
import {
  buildTrackingTimeline,
  isTerminalTrackingStatus,
  trackingPaymentSummary,
  type TrackingPaymentTone,
} from "@/lib/orders/tracking";
import type { OrderConfirmationView } from "@/lib/validations/order";
import { Button } from "@/components/ui/button";

/**
 * Guest order tracking (Phase 7).
 *
 * Access is proven before any order data is rendered:
 *
 *  - same browser: the Phase 5 confirmation capability in sessionStorage,
 *  - another device: a scoped grant obtained by verifying a one-time code
 *    emailed to the address on the order.
 *
 * The public reference alone is never enough. The page polls modestly while it
 * is visible and the order is not terminal, pauses when the tab is hidden,
 * stops at completed or cancelled, and offers a manual Refresh. Every response
 * is tagged with a request id so a slow earlier response can never overwrite a
 * newer one.
 */

type LoadState =
  | { kind: "loading" }
  | { kind: "ready"; order: OrderConfirmationView; access: "capability" | "grant" }
  | { kind: "no_access" }
  | { kind: "not_found" }
  | { kind: "rate_limited" }
  | { kind: "unavailable" };

const POLL_INTERVAL_MS = 30_000;

const STATUS_COPY: Record<OrderConfirmationView["status"], string> = {
  placed: "Your order has been received and is waiting for the store to confirm it.",
  confirmed: "The store has confirmed your order.",
  preparing: "Your order is being prepared.",
  ready_for_pickup: "Your order is ready for pickup.",
  out_for_delivery: "Your order is out for delivery.",
  completed: "Your order is complete.",
  cancelled: "This order was cancelled.",
};

const PAYMENT_TONE: Record<TrackingPaymentTone, string> = {
  neutral: "border-border bg-cream/70 text-ink",
  success: "border-leaf-700/30 bg-leaf-700/10 text-leaf-700",
  warning: "border-terracotta-700/30 bg-terracotta-700/10 text-terracotta-700",
};

function formatDateTime(iso: string | null): string {
  if (!iso) return "";
  const date = new Date(iso);
  return Number.isNaN(date.getTime())
    ? ""
    : date.toLocaleString("en-CA", {
        month: "short",
        day: "numeric",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });
}

export function OrderTrackingClient() {
  const searchParams = useSearchParams();
  const reference = (searchParams.get("ref") ?? "").trim().toUpperCase();

  if (reference === "") {
    return (
      <div className="max-w-xl">
        <RecoveryPanel initialReference="" onGranted={() => undefined} />
      </div>
    );
  }

  return <TrackingLoader key={reference} reference={reference} />;
}

function TrackingLoader({ reference }: { reference: string }) {
  const router = useRouter();
  const [accessKey] = useState(() => confirmationKeyFor(reference));
  const [grantKey, setGrantKey] = useState(() => trackingGrantFor(reference));
  const [state, setState] = useState<LoadState>(() =>
    accessKey || grantKey ? { kind: "loading" } : { kind: "no_access" },
  );
  const [refreshing, setRefreshing] = useState(false);
  const requestId = useRef(0);

  const load = useCallback(async (): Promise<void> => {
    const id = ++requestId.current;
    try {
      const response = await loadOrderTrackingAction({
        reference,
        ...(accessKey ? { accessKey } : {}),
        ...(grantKey ? { grantKey } : {}),
      });
      if (id !== requestId.current) return; // a newer request won
      if (response.ok) {
        setState({ kind: "ready", order: response.order, access: response.access });
      } else if (response.reason === "rate_limited") {
        setState({ kind: "rate_limited" });
      } else if (response.reason === "unavailable") {
        setState({ kind: "unavailable" });
      } else if (grantKey) {
        // The scoped grant is invalid or expired. Forget it and offer the
        // email recovery flow again rather than claiming the order vanished.
        clearTrackingGrant(reference);
        setGrantKey(null);
        setState({ kind: "no_access" });
      } else {
        setState({ kind: "not_found" });
      }
    } catch {
      if (id === requestId.current) setState({ kind: "unavailable" });
    }
  }, [reference, accessKey, grantKey]);

  const refresh = useCallback(async (): Promise<void> => {
    setRefreshing(true);
    try {
      await load();
    } finally {
      setRefreshing(false);
    }
  }, [load]);

  useEffect(() => {
    if (!accessKey && !grantKey) return;
    // Defer past the commit so the effect only subscribes: the first read is
    // started asynchronously and every state change happens after an await.
    let active = true;
    void Promise.resolve().then(() => {
      if (active) void load();
    });
    return () => {
      active = false;
    };
  }, [accessKey, grantKey, load]);

  const hasOrder = state.kind === "ready";
  const terminal = hasOrder && isTerminalTrackingStatus(state.order.status);

  useEffect(() => {
    if (!hasOrder || terminal) return;

    const timer = setInterval(() => {
      if (document.visibilityState === "visible") void load();
    }, POLL_INTERVAL_MS);

    const onVisibility = () => {
      if (document.visibilityState === "visible") void load();
    };
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [hasOrder, terminal, load]);

  const handleGranted = (grantedReference: string) => {
    if (grantedReference !== reference) {
      router.replace(`/track?ref=${encodeURIComponent(grantedReference)}`);
      return;
    }
    setGrantKey(trackingGrantFor(reference));
  };

  if (state.kind === "loading") {
    return (
      <div className="flex items-center gap-3 rounded-3xl border border-border bg-surface p-6 font-sans text-sm text-ink-muted">
        <Loader2 className="size-4 motion-safe:animate-spin" aria-hidden="true" />
        Loading your order…
      </div>
    );
  }

  if (state.kind === "ready") {
    return (
      <TrackingView
        order={state.order}
        access={state.access}
        refreshing={refreshing}
        onRefresh={() => void refresh()}
      />
    );
  }

  const notice = {
    no_access: {
      title: "This order needs private access",
      body:
        "Order details are never shown from a reference alone. Open the confirmation link on the device that placed the order, or verify the email address on the order below.",
    },
    not_found: {
      title: "We could not open that order",
      body:
        "The reference and this device's access do not match an order. If you placed the order in another browser, use the email recovery below.",
    },
    rate_limited: {
      title: "Too many attempts",
      body: "Please wait a few minutes before trying to open this order again.",
    },
    unavailable: {
      title: "Tracking is unavailable right now",
      body: "Your order is stored. Please reload this page in a moment to try again.",
    },
  }[state.kind];

  return (
    <div className="grid max-w-4xl gap-6">
      <div
        className="rounded-3xl border border-border bg-surface p-6 shadow-card"
        role="alert"
        data-testid="tracking-notice"
      >
        <h2 className="flex items-center gap-2 font-sans text-lg font-bold text-navy">
          <Lock className="size-4 text-gold-700" aria-hidden="true" />
          {notice.title}
        </h2>
        <p className="mt-2 font-sans text-sm leading-relaxed text-ink-muted">{notice.body}</p>
      </div>

      {state.kind !== "rate_limited" ? (
        <RecoveryPanel initialReference={reference} onGranted={handleGranted} />
      ) : null}
    </div>
  );
}

/* ── recovery ───────────────────────────────────────────────────────── */

function RecoveryPanel({
  initialReference,
  onGranted,
}: {
  initialReference: string;
  onGranted: (reference: string) => void;
}) {
  const [reference, setReference] = useState(initialReference);
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [phase, setPhase] = useState<"request" | "verify">("request");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const normalisedReference = reference.trim().toUpperCase();

  const requestCode = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    setNotice(null);
    setPending(true);
    try {
      const response = await requestTrackingCodeAction({
        reference: normalisedReference,
        email,
      });
      if (response.ok) {
        setPhase("verify");
        setNotice(
          "If that email matches an order, a six digit code is on its way. Check the inbox for that address.",
        );
      } else if (response.reason === "rate_limited") {
        setError("Too many requests. Please wait a few minutes and try again.");
      } else {
        setError(
          "Email recovery is not available right now. Same-browser access still works where the order was placed.",
        );
      }
    } catch {
      setError("The request could not be sent. Please try again.");
    } finally {
      setPending(false);
    }
  };

  const verifyCode = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    setNotice(null);
    setPending(true);
    try {
      const response = await verifyTrackingCodeAction({
        reference: normalisedReference,
        code,
      });
      if (response.ok) {
        saveTrackingGrant(normalisedReference, response.grantKey);
        onGranted(normalisedReference);
      } else if (response.reason === "rate_limited") {
        setError("Too many attempts. Please wait a few minutes and try again.");
      } else if (response.reason === "unavailable") {
        setError("Email recovery is not available right now.");
      } else {
        setError("That code is invalid or has expired. Request a new code if needed.");
      }
    } catch {
      setError("The code could not be checked. Please try again.");
    } finally {
      setPending(false);
    }
  };

  return (
    <section
      aria-label="Open this order on this device"
      data-testid="tracking-recovery"
      className="rounded-3xl border border-border bg-surface p-6 shadow-card"
    >
      <h2 className="flex items-center gap-2 font-sans text-lg font-bold text-navy">
        <Mail className="size-4 text-gold-700" aria-hidden="true" />
        Open this order on this device
      </h2>
      <p className="mt-2 font-sans text-sm leading-relaxed text-ink-muted">
        Enter the order reference and the email address used for the order. If they match, we email a short
        one-time code. Recovery is only available when email delivery is configured.
      </p>

      {phase === "request" ? (
        <form onSubmit={requestCode} className="mt-5 grid gap-4">
          <label className="grid gap-1.5">
            <span className="font-sans text-sm font-semibold text-navy">Order reference</span>
            <input
              name="reference"
              value={reference}
              onChange={(event) => setReference(event.target.value.toUpperCase())}
              required
              pattern="PS-[0-9A-Fa-f]{10}"
              autoComplete="off"
              spellCheck={false}
              placeholder="PS-XXXXXXXXXX"
              className="min-h-11 rounded-xl border border-border bg-cream px-3 font-sans text-base text-navy focus-gold"
            />
          </label>
          <label className="grid gap-1.5">
            <span className="font-sans text-sm font-semibold text-navy">Email on the order</span>
            <input
              name="email"
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              required
              autoComplete="email"
              inputMode="email"
              className="min-h-11 rounded-xl border border-border bg-cream px-3 font-sans text-base text-navy focus-gold"
            />
          </label>
          <div>
            <Button type="submit" disabled={pending}>
              {pending ? <Loader2 className="size-4 motion-safe:animate-spin" aria-hidden="true" /> : null}
              {pending ? "Sending code" : "Email me a code"}
            </Button>
          </div>
        </form>
      ) : (
        <form onSubmit={verifyCode} className="mt-5 grid gap-4">
          <label className="grid gap-1.5">
            <span className="font-sans text-sm font-semibold text-navy">Six digit code</span>
            <input
              name="code"
              value={code}
              onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, 6))}
              required
              pattern="\d{6}"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              className="min-h-12 w-40 rounded-xl border border-border bg-cream px-3 text-center font-sans text-2xl font-bold tracking-[0.3em] text-navy focus-gold"
            />
          </label>
          <div className="flex flex-wrap gap-3">
            <Button type="submit" disabled={pending}>
              {pending ? <Loader2 className="size-4 motion-safe:animate-spin" aria-hidden="true" /> : null}
              {pending ? "Checking" : "Open this order"}
            </Button>
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                setPhase("request");
                setCode("");
                setError(null);
                setNotice(null);
              }}
            >
              Use a different email
            </Button>
          </div>
        </form>
      )}

      <div aria-live="polite" className="mt-4">
        {notice ? (
          <p className="flex items-start gap-2 font-sans text-sm text-ink-muted">
            <ShieldCheck className="mt-0.5 size-4 shrink-0 text-leaf-700" aria-hidden="true" />
            {notice}
          </p>
        ) : null}
        {error ? (
          <p className="flex items-start gap-2 font-sans text-sm text-terracotta-700" role="alert">
            <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            {error}
          </p>
        ) : null}
      </div>
    </section>
  );
}

/* ── tracking view ──────────────────────────────────────────────────── */

function TrackingView({
  order,
  access,
  refreshing,
  onRefresh,
}: {
  order: OrderConfirmationView;
  access: "capability" | "grant";
  refreshing: boolean;
  onRefresh: () => void;
}) {
  const timeline = buildTrackingTimeline(order);
  const payment = trackingPaymentSummary(order);
  const cancelled = order.status === "cancelled";

  return (
    <div
      className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,22rem)] lg:items-start"
      data-testid="order-tracking"
    >
      <div className="grid gap-6">
        <section className="rounded-3xl border border-border bg-surface p-6 shadow-card">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="font-sans text-xs font-semibold uppercase tracking-[0.14em] text-gold-700">
                Order
              </p>
              <h2 className="mt-1 font-display text-2xl font-semibold text-navy sm:text-3xl">
                {order.reference}
              </h2>
              <p className="mt-1 font-sans text-sm text-ink-muted">
                Placed {formatDateTime(order.placedAtIso)}
              </p>
            </div>
            <Button type="button" variant="outline" size="sm" onClick={onRefresh} disabled={refreshing}>
              <RefreshCw
                className={`size-4 ${refreshing ? "motion-safe:animate-spin" : ""}`}
                aria-hidden="true"
              />
              {refreshing ? "Refreshing" : "Refresh"}
            </Button>
          </div>

          <p className="mt-4 font-sans text-sm leading-relaxed text-ink" data-testid="tracking-status">
            {STATUS_COPY[order.status]}
          </p>

          {cancelled ? (
            <div className="mt-4 flex items-start gap-3 rounded-2xl border border-terracotta-700/30 bg-terracotta-700/10 p-4">
              <XCircle className="mt-0.5 size-5 shrink-0 text-terracotta-700" aria-hidden="true" />
              <div>
                <p className="font-sans text-sm font-bold text-terracotta-700">Order cancelled</p>
                <p className="mt-1 font-sans text-sm text-ink-muted">
                  This order did not continue past the steps marked below. It is never shown as completed.
                </p>
              </div>
            </div>
          ) : null}

          <ol className="mt-6 grid gap-0" aria-label="Order progress">
            {timeline.map((step, index) => {
              const last = index === timeline.length - 1;
              return (
                <li key={step.key} className="flex gap-4">
                  <div className="flex w-7 flex-col items-center">
                    <span
                      className={
                        step.state === "complete"
                          ? "flex size-7 items-center justify-center rounded-full bg-leaf-700 text-cream"
                          : step.state === "current"
                            ? "flex size-7 items-center justify-center rounded-full border-2 border-gold-700 bg-cream text-gold-700"
                            : "flex size-7 items-center justify-center rounded-full border border-border bg-cream text-ink-muted"
                      }
                    >
                      {step.state === "complete" ? (
                        <Check className="size-4" aria-hidden="true" />
                      ) : step.state === "current" ? (
                        <Clock className="size-3.5" aria-hidden="true" />
                      ) : (
                        <span className="size-1.5 rounded-full bg-current" aria-hidden="true" />
                      )}
                    </span>
                    {!last ? (
                      <span
                        className={`mt-1 w-px flex-1 ${step.state === "complete" ? "bg-leaf-700/50" : "bg-border"}`}
                        aria-hidden="true"
                      />
                    ) : null}
                  </div>
                  <div className={`min-w-0 ${last ? "pb-0" : "pb-6"}`}>
                    <p
                      className={
                        step.state === "upcoming"
                          ? "font-sans text-sm font-semibold text-ink-muted"
                          : "font-sans text-sm font-semibold text-navy"
                      }
                    >
                      {step.label}
                      {step.state === "current" ? (
                        <span className="ml-2 rounded-full bg-gold/20 px-2 py-0.5 font-sans text-[11px] font-bold uppercase tracking-wide text-gold-700">
                          Now
                        </span>
                      ) : null}
                    </p>
                    <p className="mt-0.5 font-sans text-xs text-ink-muted">
                      {step.atIso
                        ? formatDateTime(step.atIso)
                        : step.state === "upcoming"
                          ? "Not yet"
                          : ""}
                    </p>
                  </div>
                </li>
              );
            })}
          </ol>
        </section>

        <section className="rounded-3xl border border-border bg-surface p-6 shadow-card">
          <h2 className="font-sans text-lg font-bold text-navy">Your items</h2>
          <ul className="mt-4 divide-y divide-border/60">
            {order.items.map((item, index) => (
              <li key={`${item.name}:${item.variantName ?? ""}:${index}`} className="flex gap-3 py-3">
                <div className="min-w-0 flex-1">
                  <p className="font-sans text-sm font-semibold text-navy">{item.name}</p>
                  {item.variantName ? (
                    <p className="font-sans text-xs text-ink-muted">{item.variantName}</p>
                  ) : null}
                  <p className="font-sans text-xs text-ink-muted">
                    {item.quantity} × {formatCad(item.unitPriceCents) ?? "Price unavailable"}
                  </p>
                </div>
                <p className="font-sans text-sm font-semibold text-navy">
                  {formatCad(item.lineTotalCents) ?? "Amount unavailable"}
                </p>
              </li>
            ))}
          </ul>
          <dl className="mt-4 space-y-1.5 border-t border-border pt-4">
            <MoneyRow label="Subtotal" value={order.money.subtotalCents} />
            <MoneyRow
              label="Delivery fee"
              value={order.money.deliveryFeeCents}
              zero="No delivery fee"
            />
            <MoneyRow label={order.money.taxLabel ?? "Tax"} value={order.money.taxCents} />
            <div className="flex items-baseline justify-between border-t border-border pt-2">
              <dt className="font-sans text-sm font-bold text-navy">Total</dt>
              <dd className="font-sans text-base font-bold text-navy" data-testid="tracking-total">
                {formatCad(order.money.totalCents) ?? "Amount unavailable"}
              </dd>
            </div>
          </dl>
        </section>
      </div>

      <aside className="grid gap-6">
        <section className="rounded-3xl border border-border bg-surface p-6 shadow-card">
          <h2 className="font-sans text-lg font-bold text-navy">Payment</h2>
          <div
            className={`mt-3 rounded-2xl border p-4 ${PAYMENT_TONE[payment.tone]}`}
            data-testid="tracking-payment"
          >
            <p className="flex items-center gap-2 font-sans text-sm font-bold">
              {payment.tone === "success" ? (
                <CheckCircle2 className="size-4" aria-hidden="true" />
              ) : payment.tone === "warning" ? (
                <AlertCircle className="size-4" aria-hidden="true" />
              ) : (
                <Clock className="size-4" aria-hidden="true" />
              )}
              {payment.label}
            </p>
            <p className="mt-1 font-sans text-sm leading-relaxed">{payment.detail}</p>
          </div>
        </section>

        <section className="rounded-3xl border border-border bg-surface p-6 shadow-card">
          <h2 className="font-sans text-lg font-bold text-navy">Fulfilment</h2>
          <p className="mt-2 font-sans text-sm font-semibold text-navy">
            {order.fulfillment.method === "delivery" ? "Delivery" : "Pickup"}
          </p>
          {order.fulfillment.method === "delivery" && order.fulfillment.serviceAreaLabel ? (
            <p className="mt-1 font-sans text-sm text-ink-muted">
              Delivery area: {order.fulfillment.serviceAreaLabel}
            </p>
          ) : null}
          {order.fulfillment.method === "pickup" ? (
            <p className="mt-1 font-sans text-sm leading-relaxed text-ink-muted">
              {order.fulfillment.pickupInstructions ??
                "Bring your order reference when you collect the order."}
            </p>
          ) : null}
          {order.fulfillment.method === "delivery" ? (
            <p className="mt-2 font-sans text-xs text-ink-muted">
              No delivery estimate is shown unless the store provides one.
            </p>
          ) : null}
        </section>

        <section className="rounded-3xl border border-border bg-cream/70 p-6">
          <h2 className="flex items-center gap-2 font-sans text-sm font-bold text-navy">
            <Lock className="size-4 text-gold-700" aria-hidden="true" />
            Private access
          </h2>
          <p className="mt-2 font-sans text-xs leading-relaxed text-ink-muted">
            {access === "capability"
              ? "This order is open because this browser holds the private confirmation for it."
              : "This order is open because the email address on it was verified on this device. The access expires automatically."}
          </p>
          <p className="mt-2 font-sans text-xs leading-relaxed text-ink-muted">
            Do not share this page URL: the reference alone does not grant access.
          </p>
        </section>

        <p className="font-sans text-xs text-ink-muted">
          Need the full confirmation?{" "}
          <Link
            href={`/order-confirmation?ref=${encodeURIComponent(order.reference)}`}
            className="font-semibold text-navy underline underline-offset-2 focus-gold"
          >
            Open the confirmation page
          </Link>
          .
        </p>
      </aside>
    </div>
  );
}

function MoneyRow({ label, value, zero }: { label: string; value: number; zero?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <dt className="font-sans text-sm text-ink-muted">{label}</dt>
      <dd className="font-sans text-sm font-semibold text-navy">
        {value === 0 && zero ? zero : (formatCad(value) ?? "Amount unavailable")}
      </dd>
    </div>
  );
}
