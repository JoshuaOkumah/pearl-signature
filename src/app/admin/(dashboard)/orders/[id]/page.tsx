import type { Metadata } from "next";
import { connection } from "next/server";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { getAdminOrder } from "@/lib/repositories/admin";
import { ORDER_STATUS_LABELS, PAYMENT_STATUS_LABELS, availableTransitions } from "@/lib/orders/lifecycle";
import { ORDER_REFERENCE_PATTERN } from "@/lib/validations/order";
import { formatCad } from "@/lib/format";
import { Badge, type BadgeTone } from "@/components/ui/badge";
import { OrderActions } from "@/components/admin/order-actions";
import { PaymentReconciliation } from "@/components/admin/payment-reconciliation";

export const metadata: Metadata = {
  title: "Order detail",
};

type PageProps = {
  params: Promise<{ id: string }>;
};

const STATUS_TONE: Record<string, BadgeTone> = {
  placed: "gold",
  confirmed: "navy",
  preparing: "navy",
  ready_for_pickup: "leaf",
  out_for_delivery: "leaf",
  completed: "neutral",
  cancelled: "terracotta",
};

const PAYMENT_TONE: Record<string, BadgeTone> = {
  unpaid: "terracotta",
  awaiting_payment: "gold",
  processing: "gold",
  paid: "leaf",
  failed: "terracotta",
  expired: "terracotta",
  partially_refunded: "gold",
  refunded: "neutral",
  review_required: "terracotta",
};

function formatDateTime(iso: string): string {
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

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-border bg-surface p-5">
      <h2 className="font-sans text-base font-bold text-navy">{title}</h2>
      <div className="mt-4">{children}</div>
    </section>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="font-sans text-xs font-semibold uppercase tracking-wide text-ink-muted">{label}</dt>
      <dd className="mt-0.5 font-sans text-sm text-navy">{children}</dd>
    </div>
  );
}

/**
 * `/admin/orders/[id]` — one order in full (Phase 5, Milestone D).
 *
 * The identifier is the public order reference (`PS-XXXXXXXXXX`): it is
 * URL-safe, already unique-indexed, and malformed values are rejected
 * before they can reach a query. Every mutation below runs through a
 * Server Action that re-authorizes the session, re-reads this record and
 * applies its own optimistic-concurrency filter.
 */
export default async function AdminOrderDetailPage({ params }: PageProps) {
  // Live DB state: never prerendered, never cached.
  await connection();
  const { id } = await params;
  const order = await getAdminOrder(id);
  if (!order || !ORDER_REFERENCE_PATTERN.test(order.reference)) notFound();

  const allowed = availableTransitions(order.status, order.method);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <Link
            href="/admin/orders"
            className="inline-flex items-center gap-1.5 rounded font-sans text-sm font-semibold text-navy underline-offset-2 hover:underline focus-gold"
          >
            <ArrowLeft className="size-4" aria-hidden="true" />
            All orders
          </Link>
          <h1 className="mt-2 font-serif text-3xl font-semibold text-navy">{order.reference}</h1>
          <p className="mt-1 font-sans text-sm text-ink-muted">Placed {formatDateTime(order.placedAtIso)}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={STATUS_TONE[order.status] ?? "neutral"}>{ORDER_STATUS_LABELS[order.status]}</Badge>
          <Badge tone={PAYMENT_TONE[order.paymentStatus] ?? "neutral"}>
            {PAYMENT_STATUS_LABELS[order.paymentStatus]}
          </Badge>
          <Badge tone="neutral">{order.method === "delivery" ? "Delivery" : "Pickup"}</Badge>
        </div>
      </div>

      {order.status === "cancelled" && order.cancellationReason ? (
        <div className="rounded-2xl border border-terracotta-700/40 bg-terracotta-700/10 p-5">
          <h2 className="font-sans text-sm font-bold text-navy">Cancellation reason</h2>
          <p className="mt-1 font-sans text-sm text-navy-700">{order.cancellationReason}</p>
        </div>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Main column */}
        <div className="space-y-6 lg:col-span-2">
          <Panel title="Customer and fulfilment">
            <dl className="grid gap-4 sm:grid-cols-2">
              <Field label="Name">{order.customerName}</Field>
              <Field label="Email">
                <a
                  href={`mailto:${order.customerEmail}`}
                  className="underline underline-offset-2 focus-gold rounded"
                >
                  {order.customerEmail}
                </a>
              </Field>
              <Field label="Phone">{order.phone}</Field>
              <Field label="Method">{order.method === "delivery" ? "Delivery" : "Pickup"}</Field>
              {order.address ? (
                <div className="sm:col-span-2">
                  <Field label="Delivery address">
                    {order.address.line1}
                    {order.address.line2 ? `, ${order.address.line2}` : ""}
                    <br />
                    {order.address.city}, {order.address.province} {order.address.postalCode}
                  </Field>
                </div>
              ) : null}
              {order.serviceAreaLabel ? (
                <Field label="Service area">{order.serviceAreaLabel}</Field>
              ) : null}
              {order.pickupInstructions ? (
                <Field label="Pickup instructions">{order.pickupInstructions}</Field>
              ) : null}
              {order.instructions ? (
                <Field label="Delivery instructions">{order.instructions}</Field>
              ) : null}
              {order.customerNotes ? (
                <div className="sm:col-span-2">
                  <Field label="Notes from the customer">{order.customerNotes}</Field>
                </div>
              ) : null}
            </dl>
          </Panel>

          <Panel title="Items">
            <ul className="divide-y divide-border">
              {order.items.map((item, index) => (
                <li
                  key={`${item.name}-${item.variantName ?? ""}-${index}`}
                  className="flex items-start justify-between gap-4 py-3"
                >
                  <div className="min-w-0">
                    <p className="font-sans text-sm font-semibold text-navy">
                      {item.name}
                      {item.variantName ? (
                        <span className="font-normal text-ink-muted"> · {item.variantName}</span>
                      ) : null}
                    </p>
                    <p className="font-sans text-xs text-ink-muted">
                      {item.quantity} × {formatCad(item.unitPriceCents)}
                    </p>
                  </div>
                  <p className="shrink-0 font-sans text-sm font-semibold tabular-nums text-navy">
                    {formatCad(item.lineTotalCents)}
                  </p>
                </li>
              ))}
            </ul>
          </Panel>

          <Panel title="Status history">
            {order.statusHistory.length === 0 ? (
              <p className="font-sans text-sm text-ink-muted">No status events recorded.</p>
            ) : (
              <ol className="space-y-4">
                {[...order.statusHistory].reverse().map((event, index) => (
                  <li key={`${event.atIso}-${index}`} className="flex gap-3">
                    <span
                      className="mt-1.5 size-2 shrink-0 rounded-full bg-navy"
                      aria-hidden="true"
                    />
                    <div className="min-w-0">
                      <p className="font-sans text-sm font-semibold text-navy">
                        {ORDER_STATUS_LABELS[event.to]}
                        <span className="ml-2 font-sans text-xs font-normal text-ink-muted">
                          {formatDateTime(event.atIso)}
                        </span>
                      </p>
                      <p className="font-sans text-xs text-ink-muted">
                        {event.from === null ? "Placed by the customer" : `From ${ORDER_STATUS_LABELS[event.from]}`}
                      </p>
                      {event.note ? (
                        <p className="mt-1 font-sans text-sm text-navy-700">{event.note}</p>
                      ) : null}
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </Panel>
        </div>

        {/* Side column */}
        <div className="space-y-6">
          <Panel title="Totals">
            <dl className="space-y-2">
              <div className="flex items-baseline justify-between gap-3">
                <dt className="font-sans text-sm text-ink-muted">Subtotal</dt>
                <dd className="font-sans text-sm tabular-nums text-navy">
                  {formatCad(order.money.subtotalCents)}
                </dd>
              </div>
              <div className="flex items-baseline justify-between gap-3">
                <dt className="font-sans text-sm text-ink-muted">
                  {order.method === "delivery" ? "Delivery fee" : "Pickup"}
                </dt>
                <dd className="font-sans text-sm tabular-nums text-navy">
                  {order.method === "delivery"
                    ? formatCad(order.money.deliveryFeeCents)
                    : formatCad(0)}
                </dd>
              </div>
              <div className="flex items-baseline justify-between gap-3">
                <dt className="font-sans text-sm text-ink-muted">
                  {order.money.taxLabel ?? "Tax"}
                  {order.money.taxRateBps ? ` (${(order.money.taxRateBps / 100).toFixed(2)}%)` : ""}
                </dt>
                <dd className="font-sans text-sm tabular-nums text-navy">
                  {formatCad(order.money.taxCents)}
                </dd>
              </div>
              <div className="flex items-baseline justify-between gap-3 border-t border-border pt-2">
                <dt className="font-sans text-sm font-bold text-navy">Total</dt>
                <dd className="font-sans text-base font-bold tabular-nums text-navy">
                  {formatCad(order.money.totalCents)}
                </dd>
              </div>
            </dl>
            <div className="mt-4 rounded-xl bg-cream-100 p-3">
              <p className="font-sans text-xs font-semibold uppercase tracking-wide text-ink-muted">
                {PAYMENT_STATUS_LABELS[order.paymentStatus]}
              </p>
              <p className="mt-1 font-sans text-sm text-navy-700">
                Method: {order.payment.method === "stripe" ? "Online payment (Stripe)" : "Cash on Arrival"}
              </p>
              {order.payment.amountReceivedCents > 0 ? (
                <p className="mt-1 font-sans text-sm text-navy-700">
                  Collected: {formatCad(order.payment.amountReceivedCents)}
                  {order.payment.paidAtIso ? ` on ${formatDateTime(order.payment.paidAtIso)}` : ""}
                  {order.payment.paidByLabel ? ` · recorded by ${order.payment.paidByLabel}` : ""}
                </p>
              ) : (
                <p className="mt-1 font-sans text-sm text-ink-muted">
                  {order.payment.method === "stripe" ? "No payment has been confirmed." : "Cash on Arrival: not yet received."}
                </p>
              )}
              {order.payment.refundedAmountCents > 0 ? (
                <p className="mt-1 font-sans text-sm text-terracotta-700">
                  Confirmed refunds: {formatCad(order.payment.refundedAmountCents)}
                </p>
              ) : null}
              {order.payment.method === "stripe" && order.payment.paymentIntentId ? (
                <p className="mt-1 break-all font-sans text-xs text-ink-muted">PaymentIntent: {order.payment.paymentIntentId}</p>
              ) : null}
              {order.payment.requiresReview ? (
                <p role="alert" className="mt-2 rounded-lg bg-terracotta-700/10 px-3 py-2 font-sans text-sm font-semibold text-terracotta-700">
                  Payment needs review. Verify the provider record before taking action.
                </p>
              ) : null}
            </div>
          </Panel>

          <OrderActions
            reference={order.reference}
            status={order.status}
            method={order.method}
            allowed={allowed}
            paymentStatus={order.paymentStatus}
            paymentMethod={order.payment.method}
            totalCents={order.money.totalCents}
            version={order.version}
          />

          {order.payment.method === "stripe" ? (
            <Panel title="Online payment attempts">
              {order.payment.attempts.length === 0 ? (
                <p className="font-sans text-sm text-ink-muted">No Checkout Session attempts are recorded.</p>
              ) : (
                <ul className="space-y-3">
                  {order.payment.attempts.map((attempt) => (
                    <li key={attempt.id} className="rounded-xl bg-cream-100 p-3">
                      <p className="flex flex-wrap justify-between gap-2 font-sans text-sm font-semibold text-navy">
                        <span>Attempt {attempt.sequence}: {attempt.status.replaceAll("_", " ")}</span>
                        <span className="tabular-nums">{formatCad(attempt.amountCents)}</span>
                      </p>
                      <p className="mt-1 font-sans text-xs text-ink-muted">Started {formatDateTime(attempt.createdAtIso)}</p>
                      {attempt.expiresAtIso ? <p className="font-sans text-xs text-ink-muted">Session expiry: {formatDateTime(attempt.expiresAtIso)}</p> : null}
                      {attempt.checkoutSessionId ? <p className="mt-1 break-all font-sans text-xs text-ink-muted">Checkout Session: {attempt.checkoutSessionId}</p> : null}
                      {attempt.paymentIntentId ? <p className="break-all font-sans text-xs text-ink-muted">PaymentIntent: {attempt.paymentIntentId}</p> : null}
                      {attempt.failureCode ? <p className="mt-1 font-sans text-xs text-terracotta-700">Provider state: {attempt.failureCode.replaceAll("_", " ")}</p> : null}
                      {attempt.succeededAtIso ? <p className="font-sans text-xs text-ink-muted">Confirmed {formatDateTime(attempt.succeededAtIso)}</p> : null}
                    </li>
                  ))}
                </ul>
              )}
              {order.payment.refunds.length > 0 ? (
                <div className="mt-4 border-t border-border pt-4">
                  <h3 className="font-sans text-sm font-bold text-navy">Provider refund records</h3>
                  <ul className="mt-2 space-y-2">
                    {order.payment.refunds.map((refund) => (
                      <li key={refund.stripeRefundId} className="flex flex-wrap justify-between gap-2 font-sans text-sm">
                        <span>{refund.status.replaceAll("_", " ")} · {formatDateTime(refund.createdAtIso)}</span>
                        <span className="tabular-nums">{formatCad(refund.amountCents)}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
              <p className="mt-3 font-sans text-xs text-ink-muted">
                Refunds are recorded from verified Stripe data only. Cancellation does not issue a refund.
              </p>
            </Panel>
          ) : null}

          {order.payment.method === "stripe" ? <PaymentReconciliation reference={order.reference} /> : null}

          <Panel title="Internal notes">
            {order.adminNotes.length === 0 ? (
              <p className="font-sans text-sm text-ink-muted">No notes yet.</p>
            ) : (
              <ul className="space-y-3">
                {[...order.adminNotes].reverse().map((note, index) => (
                  <li key={`${note.atIso}-${index}`} className="border-b border-border pb-3 last:border-b-0 last:pb-0">
                    <p className="font-sans text-sm text-navy">{note.body}</p>
                    <p className="mt-0.5 font-sans text-xs text-ink-muted">{formatDateTime(note.atIso)}</p>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </div>
      </div>
    </div>
  );
}
