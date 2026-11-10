import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { AlertTriangle, CheckCircle2, HelpCircle } from "lucide-react";
import { getStoreConfigRecord } from "@/lib/store/config";
import { normalizeCheckoutSettings } from "@/lib/validations/store-config";
import { checkoutBlockers } from "@/lib/checkout/pricing";
import { stripeReadiness } from "@/lib/payments/stripe";
import { emailReadiness } from "@/lib/notifications/config";
import { guestVerificationReadiness } from "@/lib/guest/readiness";

export const metadata: Metadata = {
  title: "System status",
};

/**
 * `/admin/system` — plain-language readiness for the services the shop
 * depends on (Phase 8 admin refresh).
 *
 * These panels used to sit on `/admin/settings`, mixed in with the owner's
 * own decisions (delivery areas, tax, pickup). They are not decisions: they
 * are facts about the server. Moving them here keeps Settings about what
 * the owner chooses and gives the technical state one honest home.
 *
 * Nothing on this page shows a secret value. Each panel answers "can this
 * work right now?" and, when it cannot, what is missing in words a
 * non-technical operator can act on or hand to their developer.
 */

type Status = "ready" | "attention" | "unknown";

const STATUS_LABEL: Record<Status, string> = {
  ready: "Ready",
  attention: "Needs attention",
  unknown: "Could not check",
};

function StatusCard({
  title,
  status,
  summary,
  children,
}: {
  title: string;
  status: Status;
  summary: string;
  children?: React.ReactNode;
}) {
  const Icon = status === "ready" ? CheckCircle2 : status === "attention" ? AlertTriangle : HelpCircle;
  return (
    <section aria-label={title} className="rounded-2xl border border-border bg-surface p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <h2 className="font-sans text-base font-bold text-navy">{title}</h2>
        <span
          className={
            status === "ready"
              ? "inline-flex items-center gap-1.5 rounded-full bg-leaf-100 px-3 py-1 font-sans text-xs font-bold text-leaf-700"
              : status === "attention"
                ? "inline-flex items-center gap-1.5 rounded-full bg-gold-100 px-3 py-1 font-sans text-xs font-bold text-gold-700"
                : "inline-flex items-center gap-1.5 rounded-full bg-cream-200 px-3 py-1 font-sans text-xs font-bold text-navy-700"
          }
        >
          <Icon className="size-3.5" aria-hidden="true" />
          {STATUS_LABEL[status]}
        </span>
      </div>
      <p
        className={
          status === "ready"
            ? "mt-2 font-sans text-sm text-leaf-700"
            : "mt-2 font-sans text-sm text-ink-muted"
        }
      >
        {summary}
      </p>
      {children}
    </section>
  );
}

const BLOCKER_COPY: Record<string, string> = {
  settings_unavailable: "The store configuration could not be read from the database.",
  intake_closed: "Order intake is switched off in Settings.",
  no_fulfillment_method: "Neither delivery nor pickup is switched on.",
  tax_unconfigured: "The tax treatment has not been confirmed.",
};

export default async function SystemStatusPage() {
  // Live server state: never prerender or prefetch this page.
  await connection();

  const result = await getStoreConfigRecord();

  const stripeStatus = stripeReadiness();
  const emailStatus = emailReadiness();
  const guestStatus = guestVerificationReadiness();

  let checkoutStatus: Status = "unknown";
  let blockers: string[] = [];
  if (!("error" in result)) {
    blockers = checkoutBlockers(normalizeCheckoutSettings(result.record));
    checkoutStatus = blockers.length === 0 ? "ready" : "attention";
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="font-serif text-3xl font-semibold text-navy">System status</h1>
        <p className="mt-1 max-w-2xl font-sans text-sm text-ink-muted">
          Whether the shop can take orders, send email and accept card payments right now. Nothing
          here is a setting you change on this page — it reports what the server is configured to do.
        </p>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <StatusCard
          title="Taking orders"
          status={checkoutStatus}
          summary={
            checkoutStatus === "unknown"
              ? "The configuration could not be read. Reload the page, and check the database connection if this continues."
              : checkoutStatus === "ready"
                ? "Customers can review their basket and place an order."
                : "Customers cannot place an order yet. Finish these steps in Settings:"
          }
        >
          {blockers.length > 0 ? (
            <ul className="mt-3 flex flex-col gap-1.5">
              {blockers.map((blocker) => (
                <li key={blocker} className="flex items-start gap-2 font-sans text-sm text-ink-muted">
                  <AlertTriangle className="mt-0.5 size-4 shrink-0 text-gold-700" aria-hidden="true" />
                  {BLOCKER_COPY[blocker] ?? "One more decision is needed before orders can be accepted."}
                </li>
              ))}
            </ul>
          ) : null}
          <p className="mt-3 font-sans text-xs leading-relaxed text-ink-muted">
            Order intake only opens when you switch it on, and only after delivery or pickup and the
            tax treatment are confirmed.
          </p>
          <Link
            href="/admin/settings"
            className="mt-3 inline-flex rounded-lg font-sans text-sm font-semibold text-navy underline underline-offset-2 focus-gold"
          >
            Open Settings
          </Link>
        </StatusCard>

        <StatusCard
          title="Card payments"
          status={stripeStatus.ready ? "ready" : "attention"}
          summary={
            stripeStatus.ready
              ? "Test-mode card payments are configured. Real payments are not enabled in this release."
              : stripeStatus.reason === "disabled"
                ? "Card payments are switched off on this server. Cash on pickup still works."
                : stripeStatus.reason === "live_key_rejected"
                  ? "A live payment key was found and is refused. This release accepts test keys only."
                  : stripeStatus.reason === "invalid_site_url"
                    ? "The shop's web address is not configured, so a card payment cannot be started."
                    : "Payment credentials are incomplete, so online card payment is unavailable."
          }
        >
          <p className="mt-3 font-sans text-xs leading-relaxed text-ink-muted">
            This is a server configuration item, not an order setting. Your developer can see the
            variable names in <code className="rounded bg-cream px-1.5 py-0.5 font-mono text-xs text-navy">.env.example</code>.
            Secret values are never shown in the admin.
          </p>
        </StatusCard>

        <StatusCard
          title="Emails to customers"
          status={emailStatus.configured ? "ready" : "attention"}
          summary={
            emailStatus.configured
              ? "Order and tracking emails can be attempted."
              : "Email is not configured, so no message can be sent. Orders, payments and tracking keep working, and messages stay queued instead of being reported as sent."
          }
        >
          <p className="mt-3 font-sans text-xs leading-relaxed text-ink-muted">
            Queue counts, failures and retries live on the notifications page.
          </p>
          <Link
            href="/admin/notifications"
            className="mt-3 inline-flex rounded-lg font-sans text-sm font-semibold text-navy underline underline-offset-2 focus-gold"
          >
            Open notifications
          </Link>
        </StatusCard>

        <StatusCard
          title="Verifying customer email"
          status={guestStatus.ready ? "ready" : "attention"}
          summary={
            guestStatus.ready
              ? "Customers can confirm their email address at checkout, and can recover their order on another device."
              : guestStatus.reason === "email_unavailable"
                ? "Customers cannot confirm their email because email delivery is unavailable. Checkout needs this before it can accept an order."
                : guestStatus.reason === "missing_otp_secret"
                  ? "The code-signing secret is missing, so a confirmation code cannot be issued safely."
                  : "The code-signing secret is too short to be safe. It needs at least 32 characters."
          }
        >
          <p className="mt-3 font-sans text-xs leading-relaxed text-ink-muted">
            Confirmation codes are protected with a secret that is separate from the email provider
            key, so changing providers does not invalidate codes already sent.
          </p>
        </StatusCard>
      </div>

      <p className="font-sans text-xs leading-relaxed text-ink-muted">
        This page reports configuration only. It never changes a setting and never displays a secret.
      </p>
    </div>
  );
}
