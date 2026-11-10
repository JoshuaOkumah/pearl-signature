import Link from "next/link";
import { ArrowRight, Banknote, ChefHat, Inbox, TriangleAlert } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatCad } from "@/lib/format";
import { ORDER_STATUS_LABELS } from "@/lib/orders/lifecycle";
import type { AdminInsights, DashboardStats } from "@/lib/repositories/admin";
import type { OrderStatus } from "@/lib/validations/order";
import { Badge, type BadgeTone } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { BarSeries, Meter, ProgressRing, RankedBars } from "@/components/admin/dashboard-charts";

/**
 * The two dashboard views (Phase 8 admin refresh).
 *
 * Simple answers three questions in the order an owner asks them: what is
 * waiting for me, what is happening today, and is my menu ready to sell.
 * Analytics answers "how is the week going" with bars, a progress ring and
 * the full money picture.
 *
 * Both read the same real aggregates. Neither invents a target, a trend or
 * a comparison period, and every figure is printed as text beside its
 * graphic. Cancelled orders are excluded from sales figures and counted in
 * the completion rate, exactly as before this refresh.
 */

const STATUS_TONE: Record<OrderStatus, BadgeTone> = {
  placed: "gold",
  confirmed: "navy",
  preparing: "navy",
  ready_for_pickup: "leaf",
  out_for_delivery: "leaf",
  completed: "neutral",
  cancelled: "terracotta",
};

/** "… CAD" is dropped only for headline figures, never for a total. */
function amount(cents: number): string {
  const formatted = formatCad(cents);
  return formatted ? formatted.replace(" CAD", "") : "—";
}

function formatTime(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime())
    ? ""
    : date.toLocaleTimeString("en-CA", { hour: "numeric", minute: "2-digit" });
}

function Card({
  children,
  className,
  label,
}: {
  children: React.ReactNode;
  className?: string;
  label?: string;
}) {
  return (
    <section
      aria-label={label}
      className={cn("rounded-2xl border border-border bg-surface p-5", className)}
    >
      {children}
    </section>
  );
}

function CardTitle({ children, hint }: { children: React.ReactNode; hint?: string }) {
  return (
    <div>
      <h2 className="font-sans text-base font-bold text-navy">{children}</h2>
      {hint ? <p className="mt-0.5 font-sans text-xs text-ink-muted">{hint}</p> : null}
    </div>
  );
}

/** A label above a figure — the shape every e2e locator reads. */
function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div>
      <p className="font-sans text-xs font-semibold uppercase tracking-wide text-ink-muted">
        {label}
      </p>
      <p className="mt-1 font-serif text-2xl font-semibold tabular-nums text-navy">{value}</p>
      {hint ? <p className="mt-0.5 font-sans text-xs text-ink-muted">{hint}</p> : null}
    </div>
  );
}

function QueueCard({
  href,
  label,
  value,
  hint,
  chip,
  icon: Icon,
}: {
  href: string;
  label: string;
  value: string;
  hint: string;
  chip: string;
  icon: typeof Inbox;
}) {
  return (
    <Link
      href={href}
      aria-label={`${label}: ${value}`}
      className="group rounded-2xl border border-border bg-surface p-5 transition-colors hover:border-navy/30 hover:bg-cream-100/40 focus-gold"
    >
      <div className="flex items-start justify-between gap-3">
        <p className="font-sans text-sm font-semibold text-ink-muted">{label}</p>
        <span className={cn("flex size-9 shrink-0 items-center justify-center rounded-full", chip)}>
          <Icon className="size-4.5" aria-hidden="true" />
        </span>
      </div>
      <p className="mt-3 font-serif text-4xl font-semibold tabular-nums text-navy">{value}</p>
      <p className="mt-1 font-sans text-xs text-ink-muted">{hint}</p>
    </Link>
  );
}

export function SimpleDashboard({
  stats,
  insights,
}: {
  stats: DashboardStats;
  insights: AdminInsights;
}) {
  const { queue, today, menu } = insights;

  return (
    <div className="space-y-6">
      <section aria-label="Today at a glance" className="grid gap-3 sm:grid-cols-3">
        <QueueCard
          href="/admin/orders?status=placed"
          label="Orders to accept"
          value={String(queue.toAccept)}
          hint={queue.toAccept === 0 ? "Nothing waiting" : "Waiting for your confirmation"}
          chip="bg-gold-100 text-gold-700"
          icon={Inbox}
        />
        <QueueCard
          href="/admin/orders"
          label="In progress"
          value={String(stats.orders.inProgress)}
          hint={
            stats.orders.inProgress === 0
              ? "No orders being prepared"
              : `${queue.preparing} preparing · ${queue.ready} ready · ${queue.onTheWay} on the way`
          }
          chip="bg-cream-200 text-navy"
          icon={ChefHat}
        />
        <QueueCard
          href="/admin/orders?payment=unpaid"
          label="Cash to collect"
          value={amount(stats.orders.unpaidCents)}
          hint={
            stats.orders.awaitingPayment === 0
              ? "Every order has been paid"
              : `${stats.orders.awaitingPayment} order${
                  stats.orders.awaitingPayment === 1 ? "" : "s"
                } not paid yet`
          }
          chip="bg-leaf-100 text-leaf-700"
          icon={Banknote}
        />
      </section>

      <div className="grid gap-6 lg:grid-cols-3">
        <Card label="Today's orders" className="lg:col-span-2">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border pb-4">
            <CardTitle hint={`${today.count} placed today`}>Today&apos;s orders</CardTitle>
            <Link
              href="/admin/orders"
              className="rounded font-sans text-sm font-semibold text-navy underline underline-offset-2 focus-gold"
            >
              All orders
            </Link>
          </div>

          {today.orders.length === 0 ? (
            <div className="py-10 text-center">
              <Inbox className="mx-auto size-7 text-ink-muted" aria-hidden="true" />
              <p className="mt-3 font-sans text-sm font-semibold text-navy">No orders yet today</p>
              <p className="mt-1 font-sans text-sm text-ink-muted">
                New orders appear here the moment a customer checks out.
              </p>
            </div>
          ) : (
            <ul className="divide-y divide-border">
              {today.orders.map((order) => (
                <li
                  key={order.reference}
                  className="flex flex-wrap items-center gap-x-3 gap-y-1.5 py-3.5"
                >
                  <span className="w-14 shrink-0 font-sans text-xs tabular-nums text-ink-muted">
                    {formatTime(order.placedAtIso)}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-sans text-sm font-semibold text-navy">
                      {order.customerName}
                    </p>
                    <p className="font-sans text-xs text-ink-muted">{order.reference}</p>
                  </div>
                  <Badge tone={STATUS_TONE[order.status] ?? "neutral"}>
                    {ORDER_STATUS_LABELS[order.status]}
                  </Badge>
                  <span className="font-sans text-sm font-semibold tabular-nums text-navy">
                    {formatCad(order.totalCents) ?? "—"}
                  </span>
                  <Link
                    href={`/admin/orders/${order.reference}`}
                    className="rounded font-sans text-sm font-semibold text-navy underline underline-offset-2 focus-gold"
                  >
                    Open
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <div className="space-y-6">
          <Card label="Your menu">
            <CardTitle>Your menu</CardTitle>

            <div className="mt-4 grid grid-cols-2 gap-4">
              <Stat label="Dishes" value={String(stats.totalProducts)} />
              <Stat label="Live" value={String(stats.publishedProducts)} />
              <Stat label="Drafts" value={String(stats.draftProducts)} />
              <Stat label="Unavailable" value={String(stats.unavailableProducts)} />
              <Stat label="Categories" value={String(stats.totalCategories)} />
            </div>

            {menu.withoutPrice > 0 ? (
              <div className="mt-4 rounded-xl bg-gold-100 p-3">
                <p className="flex items-start gap-2 font-sans text-sm font-semibold text-gold-700">
                  <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                  {menu.withoutPrice} live dish{menu.withoutPrice === 1 ? "" : "es"} still show
                  &ldquo;Price to be confirmed&rdquo;
                </p>
                <p className="mt-1 font-sans text-xs text-gold-700">
                  Customers can see them but cannot order them.
                </p>
                <Link
                  href="/admin/products"
                  className="mt-2 inline-flex items-center gap-1 rounded font-sans text-xs font-bold text-gold-700 underline underline-offset-2 focus-gold"
                >
                  Add prices
                  <ArrowRight className="size-3.5" aria-hidden="true" />
                </Link>
              </div>
            ) : (
              <p className="mt-4 rounded-xl bg-leaf-100 p-3 font-sans text-sm font-semibold text-leaf-700">
                Every live dish has a price.
              </p>
            )}

            <div className="mt-4 flex flex-wrap gap-2">
              <ButtonLink href="/admin/products/new" size="sm">
                Add a dish
              </ButtonLink>
              <ButtonLink href="/admin/products" variant="outline" size="sm">
                Edit menu
              </ButtonLink>
            </div>
          </Card>

          <Card label="Quick actions">
            <CardTitle>Quick actions</CardTitle>
            <div className="mt-3 flex flex-col gap-1">
              {[
                { href: "/admin/orders?status=placed", label: "See new orders" },
                { href: "/admin/categories", label: "Organise categories" },
                { href: "/admin/settings", label: "Delivery, pickup and tax" },
                { href: "/admin/system", label: "System status" },
              ].map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className="flex min-h-10 items-center justify-between gap-2 rounded-lg px-1 font-sans text-sm font-semibold text-navy transition-colors hover:text-navy-700 focus-gold"
                >
                  {item.label}
                  <ArrowRight className="size-4 text-ink-muted" aria-hidden="true" />
                </Link>
              ))}
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}

export function AnalyticsDashboard({
  stats,
  insights,
}: {
  stats: DashboardStats;
  insights: AdminInsights;
}) {
  const { days, statusCounts, topItems } = insights;

  const weekOrders = days.reduce((sum, day) => sum + day.orders, 0);
  const weekCollected = days.reduce((sum, day) => sum + day.collectedCents, 0);
  const outstanding = stats.orders.unpaidCents;
  const collected = stats.orders.grossCollectedCents;

  const finished = statusCounts.completed + statusCounts.cancelled;
  const completionRate = finished > 0 ? statusCounts.completed / finished : 0;

  const statusOrder: OrderStatus[] = [
    "placed",
    "confirmed",
    "preparing",
    "ready_for_pickup",
    "out_for_delivery",
    "completed",
    "cancelled",
  ];
  const statusItems = statusOrder
    .filter((status) => statusCounts[status] > 0)
    .map((status) => ({
      label: ORDER_STATUS_LABELS[status],
      value: statusCounts[status],
    }));

  return (
    <div className="space-y-6">
      <section aria-label="This week" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <Stat label="All orders" value={String(stats.orders.total)} hint="Every order ever placed" />
        </Card>
        <Card>
          <Stat
            label="Orders this week"
            value={String(weekOrders)}
            hint="Last seven days, including today"
          />
        </Card>
        <Card>
          <Stat label="Collected this week" value={amount(weekCollected)} hint="Paid orders only" />
        </Card>
        <Card>
          <Stat
            label="Still to collect"
            value={amount(outstanding)}
            hint={`${stats.orders.awaitingPayment} order${
              stats.orders.awaitingPayment === 1 ? "" : "s"
            } outstanding`}
          />
        </Card>
      </section>

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardTitle hint="Each bar is one day">Orders, last seven days</CardTitle>
          <div className="mt-4">
            <BarSeries
              data={days.map((day) => ({ label: day.label, value: day.orders }))}
              label="Orders per day"
            />
          </div>
        </Card>

        <Card>
          <CardTitle>Finished orders</CardTitle>
          <div className="mt-6">
            <ProgressRing
              value={completionRate}
              label="Completed"
              detail={
                finished === 0
                  ? "No finished orders yet"
                  : `${statusCounts.completed} of ${finished} finished orders`
              }
            />
          </div>
          <p className="mt-4 text-center font-sans text-xs text-ink-muted">
            Cancelled orders count against this rate.
          </p>
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardTitle hint="Every order ever placed">Where orders stand</CardTitle>
          <div className="mt-4">
            <RankedBars items={statusItems} emptyLabel="No orders yet." tone="navy" />
          </div>
        </Card>

        <Card>
          <CardTitle hint="Units sold, cancelled orders excluded">Best-selling dishes</CardTitle>
          <div className="mt-4">
            <RankedBars
              items={topItems.map((item) => ({ label: item.name, value: item.quantity }))}
              emptyLabel="No dishes sold yet."
              tone="gold"
              unitLabel="sold"
            />
          </div>
        </Card>
      </div>

      <Card label="Money in detail">
        <CardTitle hint="Cash and online payments combined">Money in detail</CardTitle>
        <div className="mt-4">
          <Meter
            label="Collected so far"
            value={collected}
            max={collected + outstanding}
            valueLabel={formatCad(collected) ?? "—"}
            tone="leaf"
            hint={
              outstanding > 0
                ? `${formatCad(outstanding) ?? "—"} is still to collect. A placed order is not revenue until it is paid.`
                : "Nothing is outstanding."
            }
          />
        </div>
        <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Stat label="Cash collected" value={formatCad(stats.orders.cashCollectedCents) ?? "—"} />
          <Stat label="Cash outstanding" value={formatCad(stats.orders.unpaidCents) ?? "—"} />
          <Stat label="Paid online" value={formatCad(stats.orders.paidOnlineCents) ?? "—"} />
          <Stat label="Gross collected" value={formatCad(stats.orders.grossCollectedCents) ?? "—"} />
          <Stat label="Confirmed refunds" value={formatCad(stats.orders.refundedCents) ?? "—"} />
          <Stat label="Net collected" value={formatCad(stats.orders.netCollectedCents) ?? "—"} />
        </div>
        <p className="mt-4 font-sans text-xs leading-relaxed text-ink-muted">
          Gross is everything received. Net subtracts confirmed refunds only. A placed order is never
          counted as money until it is paid.
        </p>
      </Card>
    </div>
  );
}
