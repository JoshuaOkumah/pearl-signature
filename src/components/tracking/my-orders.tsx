"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import {
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  ChevronLeft,
  ChevronRight,
  Loader2,
  LogOut,
  MailCheck,
  Package,
  ShoppingBag,
} from "lucide-react";
import {
  forgetGuestDeviceAction,
  getGuestSessionStateAction,
  loadMyOrdersAction,
} from "@/lib/actions/guest-verification";
import { formatCad } from "@/lib/format";
import { ORDER_STATUS_LABELS } from "@/lib/orders/lifecycle";
import { myOrderGroup, type MyOrderGroup } from "@/lib/orders/tracking";
import type { GuestSessionState, MyOrdersPage, MyOrderSummary } from "@/lib/validations/guest";
import { PAYMENT_STATUS_LABELS } from "@/lib/validations/order";
import { Button, ButtonLink } from "@/components/ui/button";
import { FindMyOrders } from "./find-my-orders";

/**
 * My Orders (Phase 7B).
 *
 * The server decides what this page may show: `loadMyOrdersAction` derives the
 * list from the verified email on the live remembered-device session. The
 * browser sends only a page number, so no client-supplied email or reference
 * can widen the result.
 *
 * Individual orders are not re-implemented here. "View Order" opens `/track`,
 * which reuses the Phase 7 tracking timeline, item table, payment summary and
 * fulfilment panel. This page is the scannable index in front of it.
 */

const GROUP_COPY: Record<MyOrderGroup, { title: string; description: string }> = {
  active: {
    title: "In progress",
    description: "Orders the kitchen is still working on.",
  },
  completed: {
    title: "Completed",
    description: "Orders that finished their journey.",
  },
  cancelled: {
    title: "Cancelled",
    description: "Orders that did not go ahead.",
  },
};

const GROUP_ORDER: MyOrderGroup[] = ["active", "completed", "cancelled"];

function formatDate(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime())
    ? ""
    : date.toLocaleDateString("en-CA", { month: "short", day: "numeric", year: "numeric" });
}

function statusPillClass(status: MyOrderSummary["status"]): string {
  if (status === "cancelled") return "border-terracotta-700/30 bg-terracotta-100 text-terracotta-700";
  if (status === "completed") return "border-leaf-700/30 bg-leaf-100 text-leaf-700";
  return "border-gold-700/30 bg-gold-100 text-gold-700";
}

export function MyOrdersClient({ initialSession }: { initialSession: GuestSessionState }) {
  const [session, setSession] = useState<GuestSessionState>(initialSession);
  const [page, setPage] = useState<MyOrdersPage | null>(null);
  const [status, setStatus] = useState<"idle" | "loading" | "ready" | "error">(
    initialSession.authenticated ? "loading" : "idle",
  );
  const [error, setError] = useState<string | null>(null);
  const [forgetting, setForgetting] = useState(false);
  const [expired, setExpired] = useState(false);

  const load = useCallback(async (target: number): Promise<void> => {
    setStatus("loading");
    setError(null);
    try {
      const response = await loadMyOrdersAction({ page: target });
      if (response.ok) {
        setPage(response.data);
        setStatus("ready");
        return;
      }
      if (response.reason === "unauthenticated") {
        // The remembered device expired or was revoked between render and read.
        setSession((current) => ({
          ...current,
          authenticated: false,
          email: null,
          verifiedAtIso: null,
          sessionExpiresAtIso: null,
          checkoutFresh: false,
        }));
        setPage(null);
        setExpired(true);
        setStatus("idle");
        return;
      }
      setStatus("error");
      setError(
        response.reason === "rate_limited"
          ? "Too many requests from this connection. Please wait a little while and try again."
          : "We could not load your orders right now. They are safe. Please try again shortly.",
      );
    } catch {
      setStatus("error");
      setError("We could not load your orders right now. They are safe. Please try again shortly.");
    }
  }, []);

  useEffect(() => {
    if (!initialSession.authenticated) return;
    // Deferred past commit: the effect only starts the read, and every state
    // change happens after an await.
    let active = true;
    void Promise.resolve().then(() => {
      if (active) void load(1);
    });
    return () => {
      active = false;
    };
  }, [initialSession.authenticated, load]);

  const onVerified = useCallback(async (): Promise<void> => {
    setExpired(false);
    setPage(null);
    // The verify action already rotated the cookie; re-reading the session and
    // the first page is enough. Nothing from the previous identity survives.
    const next = await getGuestSessionStateAction();
    setSession(next);
    if (next.authenticated) await load(1);
  }, [load]);

  async function forgetDevice(): Promise<void> {
    if (forgetting) return;
    setForgetting(true);
    try {
      const next = await forgetGuestDeviceAction();
      setSession(next);
      setPage(null);
      setExpired(false);
      setStatus("idle");
      setError(null);
    } catch {
      setError("This device could not be forgotten right now. Please try again.");
    } finally {
      setForgetting(false);
    }
  }

  if (!session.authenticated) {
    return (
      <div className="grid max-w-3xl gap-6">
        {expired ? (
          <p
            role="status"
            className="flex items-start gap-2 rounded-2xl border border-border bg-cream-100 px-4 py-3 font-sans text-sm text-ink-muted"
          >
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-gold-700" aria-hidden="true" />
            This device is no longer remembered. Verify your email address to see your orders again.
          </p>
        ) : null}
        {session.verificationAvailable ? (
          <FindMyOrders onVerified={onVerified} />
        ) : (
          <div
            role="alert"
            className="rounded-3xl border border-dashed border-navy/25 bg-cream-100 p-6 font-sans text-sm leading-relaxed text-ink-muted"
          >
            <p className="flex items-center gap-2 font-display text-xl font-semibold text-navy">
              <MailCheck className="h-5 w-5 text-gold-700" aria-hidden="true" />
              Order history is unavailable right now
            </p>
            <p className="mt-2">
              We cannot send verification codes at the moment, so this page cannot open your order
              history. Your orders are safe. If you have the confirmation link from when you ordered,
              that still works on this device.
            </p>
            <ButtonLink href="/menu" variant="primary" size="sm" className="mt-4">
              Browse the menu
            </ButtonLink>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="grid gap-6" data-testid="my-orders">
      <div className="flex flex-col gap-3 rounded-3xl border border-border bg-surface p-5 shadow-card sm:flex-row sm:items-center sm:justify-between sm:p-6">
        <div className="min-w-0">
          <p className="flex items-center gap-2 font-sans text-xs font-semibold uppercase tracking-[0.14em] text-gold-700">
            <MailCheck className="h-4 w-4" aria-hidden="true" />
            Verified email
          </p>
          <p className="mt-1 truncate font-sans text-base font-semibold text-navy" data-testid="my-orders-email">
            {page?.emailMasked ?? "Your verified address"}
          </p>
          <p className="mt-1 font-sans text-xs leading-relaxed text-ink-muted">
            This device stays signed in for 30 days. Only orders placed with this address are shown.
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => void forgetDevice()}
          disabled={forgetting}
          className="shrink-0 self-start sm:self-auto"
        >
          {forgetting ? (
            <Loader2 className="h-4 w-4 motion-safe:animate-spin" aria-hidden="true" />
          ) : (
            <LogOut className="h-4 w-4" aria-hidden="true" />
          )}
          {forgetting ? "Forgetting" : "Forget this device"}
        </Button>
      </div>

      {status === "loading" && !page ? (
        <p className="flex items-center gap-3 rounded-3xl border border-border bg-surface p-6 font-sans text-sm text-ink-muted">
          <Loader2 className="h-4 w-4 motion-safe:animate-spin text-gold-700" aria-hidden="true" />
          Loading your orders…
        </p>
      ) : null}

      {status === "error" ? (
        <div role="alert" className="rounded-3xl border border-border bg-surface p-6">
          <p className="flex items-start gap-2 font-sans text-sm text-terracotta-700">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            {error}
          </p>
          <Button type="button" variant="outline" size="sm" className="mt-4" onClick={() => void load(page?.page ?? 1)}>
            Try again
          </Button>
        </div>
      ) : null}

      {status === "ready" && page && page.counts.total === 0 ? (
        <div className="rounded-3xl border border-border bg-surface p-8 text-center shadow-card" data-testid="my-orders-empty">
          <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-cream-100 text-gold-700">
            <ShoppingBag className="h-6 w-6" aria-hidden="true" />
          </span>
          <h2 className="mt-4 font-display text-2xl font-semibold text-navy">
            You haven&apos;t placed any orders yet.
          </h2>
          <p className="mx-auto mt-2 max-w-md font-sans text-sm leading-relaxed text-ink-muted">
            Orders placed with {page.emailMasked} will appear here, with their progress and payment
            details.
          </p>
          <ButtonLink href="/menu" variant="primary" size="sm" className="mt-5">
            Browse the menu
          </ButtonLink>
        </div>
      ) : null}

      {status === "ready" && page && page.counts.total > 0 ? (
        <div className="grid gap-8">
          {GROUP_ORDER.map((group) => {
            const orders = page.orders.filter((order) => myOrderGroup(order.status) === group);
            if (orders.length === 0) return null;
            return (
              <section key={group} aria-labelledby={`my-orders-${group}`} className="grid gap-3">
                <div className="flex items-baseline justify-between gap-3">
                  <div>
                    <h2
                      id={`my-orders-${group}`}
                      className="font-display text-xl font-semibold text-navy"
                    >
                      {GROUP_COPY[group].title}
                    </h2>
                    <p className="mt-0.5 font-sans text-xs text-ink-muted">{GROUP_COPY[group].description}</p>
                  </div>
                  <span className="rounded-full bg-cream-100 px-2.5 py-1 font-sans text-xs font-bold text-navy-700">
                    {page.counts[group]}
                  </span>
                </div>
                <ul className="grid gap-3">
                  {orders.map((order) => (
                    <li key={order.reference}>
                      <OrderCard order={order} />
                    </li>
                  ))}
                </ul>
              </section>
            );
          })}

          {page.page > 1 || page.hasMore ? (
            <nav aria-label="Order history pages" className="flex flex-wrap items-center justify-between gap-3">
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={page.page <= 1}
                onClick={() => void load(page.page - 1)}
              >
                <ChevronLeft className="h-4 w-4" aria-hidden="true" />
                Newer orders
              </Button>
              <p className="font-sans text-xs text-ink-muted">Page {page.page}</p>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={!page.hasMore}
                onClick={() => void load(page.page + 1)}
              >
                Older orders
                <ChevronRight className="h-4 w-4" aria-hidden="true" />
              </Button>
            </nav>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function OrderCard({ order }: { order: MyOrderSummary }) {
  const trackHref = `/track?ref=${encodeURIComponent(order.reference)}`;

  return (
    <article className="rounded-2xl border border-border bg-surface p-4 shadow-card sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-sans text-base font-bold tracking-wide text-navy">{order.reference}</p>
          <p className="mt-0.5 font-sans text-xs text-ink-muted">Placed {formatDate(order.placedAtIso)}</p>
        </div>
        <span
          className={`shrink-0 rounded-full border px-2.5 py-1 font-sans text-xs font-bold ${statusPillClass(order.status)}`}
        >
          {ORDER_STATUS_LABELS[order.status]}
        </span>
      </div>

      <p className="mt-3 flex items-start gap-2 font-sans text-sm leading-relaxed text-ink">
        <Package className="mt-0.5 h-4 w-4 shrink-0 text-gold-700" aria-hidden="true" />
        <span className="min-w-0">
          {order.itemsSummary}
          <span className="text-ink-muted">
            {" "}
            ({order.itemCount} {order.itemCount === 1 ? "item" : "items"})
          </span>
        </span>
      </p>

      <dl className="mt-3 grid gap-2 border-t border-border pt-3 font-sans text-xs sm:grid-cols-3">
        <div>
          <dt className="text-ink-muted">Fulfilment</dt>
          <dd className="mt-0.5 font-semibold text-navy">
            {order.fulfillmentMethod === "delivery" ? "Delivery" : "Pickup"}
          </dd>
        </div>
        <div>
          <dt className="text-ink-muted">Payment</dt>
          <dd className="mt-0.5 font-semibold text-navy">
            {order.paymentMethod === "stripe" ? "Online" : "Cash on arrival"}
            <span className="block font-normal text-ink-muted">
              {PAYMENT_STATUS_LABELS[order.paymentStatus]}
            </span>
          </dd>
        </div>
        <div>
          <dt className="text-ink-muted">Total</dt>
          <dd className="mt-0.5 font-semibold tabular-nums text-navy">
            {formatCad(order.totalCents) ?? "Amount unavailable"}
          </dd>
        </div>
      </dl>

      <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2">
        <Link
          href={trackHref}
          className="focus-gold inline-flex items-center gap-1.5 rounded-full bg-navy px-4 py-2 font-sans text-sm font-semibold text-cream transition-colors hover:bg-navy-800"
        >
          View Order
          <ArrowRight className="h-4 w-4" aria-hidden="true" />
        </Link>
        <Link
          href="/menu"
          className="focus-gold inline-flex items-center gap-1.5 rounded font-sans text-xs font-semibold text-navy-700 underline underline-offset-4 hover:text-navy"
        >
          <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
          Order again from the menu
        </Link>
      </div>
    </article>
  );
}
