import Link from "next/link";
import type { AdminOrderRow } from "@/lib/repositories/admin";
import { formatCad } from "@/lib/format";
import { Badge, type BadgeTone } from "@/components/ui/badge";
import { ORDER_STATUS_LABELS, PAYMENT_STATUS_LABELS } from "@/lib/orders/lifecycle";

/**
 * Admin order list (Phase 5).
 *
 * Same deliberate responsive composition as the product table: a dense
 * table on md+ screens and stacked cards on phones, never a compressed
 * table that overflows. Rows link to the order detail screen, where every
 * action lives.
 */

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

function StatusBadges({ row }: { row: AdminOrderRow }) {
  return (
    <span className="flex flex-wrap items-center gap-1.5">
      <Badge tone={STATUS_TONE[row.status] ?? "neutral"}>{ORDER_STATUS_LABELS[row.status]}</Badge>
      <Badge tone={PAYMENT_TONE[row.paymentStatus] ?? "neutral"}>
        {PAYMENT_STATUS_LABELS[row.paymentStatus]}
      </Badge>
      <Badge tone="neutral">{row.paymentMethod === "stripe" ? "Online" : "Cash on Arrival"}</Badge>
    </span>
  );
}

function OrderLink({ row, className }: { row: AdminOrderRow; className?: string }) {
  return (
    <Link
      href={`/admin/orders/${row.reference}`}
      className={`font-sans font-bold text-navy underline-offset-2 hover:underline focus-gold rounded ${className ?? ""}`}
    >
      {row.reference}
    </Link>
  );
}

export function OrderList({ rows }: { rows: AdminOrderRow[] }) {
  return (
    <>
      {/* Desktop / tablet: table */}
      <div className="hidden overflow-hidden rounded-2xl border border-border bg-surface md:block">
        <table className="w-full border-collapse text-left">
          <thead>
            <tr className="border-b border-border bg-cream-100">
              <th scope="col" className="px-4 py-3 font-sans text-xs font-bold uppercase tracking-wide text-ink-muted">
                Order
              </th>
              <th scope="col" className="px-4 py-3 font-sans text-xs font-bold uppercase tracking-wide text-ink-muted">
                Customer
              </th>
              <th scope="col" className="px-4 py-3 font-sans text-xs font-bold uppercase tracking-wide text-ink-muted">
                Fulfilment
              </th>
              <th scope="col" className="px-4 py-3 font-sans text-xs font-bold uppercase tracking-wide text-ink-muted">
                Status
              </th>
              <th scope="col" className="px-4 py-3 text-right font-sans text-xs font-bold uppercase tracking-wide text-ink-muted">
                Total
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.map((row) => (
              <tr key={row.reference} className="align-middle transition-colors hover:bg-cream-100/60">
                <td className="px-4 py-3">
                  <OrderLink row={row} />
                  <p className="font-sans text-xs text-ink-muted">{formatDateTime(row.placedAtIso)}</p>
                </td>
                <td className="px-4 py-3">
                  <p className="font-sans text-sm font-semibold text-navy">{row.customerName}</p>
                  <p className="truncate font-sans text-xs text-ink-muted">{row.customerEmail}</p>
                </td>
                <td className="px-4 py-3 font-sans text-sm text-navy-700">
                  {row.method === "delivery" ? "Delivery" : "Pickup"}
                  <span className="block font-sans text-xs text-ink-muted">
                    {row.itemCount} item{row.itemCount === 1 ? "" : "s"}
                  </span>
                </td>
                <td className="px-4 py-3">
                  <StatusBadges row={row} />
                </td>
                <td className="px-4 py-3 text-right font-sans text-sm font-semibold tabular-nums text-navy">
                  {formatCad(row.totalCents)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Mobile: stacked cards */}
      <ul className="space-y-3 md:hidden">
        {rows.map((row) => (
          <li key={row.reference} className="rounded-2xl border border-border bg-surface p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <OrderLink row={row} className="text-sm" />
                <p className="mt-0.5 font-sans text-xs text-ink-muted">{formatDateTime(row.placedAtIso)}</p>
                <p className="mt-1.5 truncate font-sans text-sm font-semibold text-navy">{row.customerName}</p>
                <p className="truncate font-sans text-xs text-ink-muted">{row.customerEmail}</p>
              </div>
              <p className="shrink-0 font-sans text-sm font-semibold tabular-nums text-navy">
                {formatCad(row.totalCents)}
              </p>
            </div>
            <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-border pt-3">
              <StatusBadges row={row} />
              <span className="font-sans text-xs text-ink-muted">
                {row.method === "delivery" ? "Delivery" : "Pickup"} · {row.itemCount} item
                {row.itemCount === 1 ? "" : "s"}
              </span>
            </div>
          </li>
        ))}
      </ul>
    </>
  );
}
