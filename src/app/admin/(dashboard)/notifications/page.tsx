import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { AlertTriangle, CheckCircle2, Mail, Send, TriangleAlert } from "lucide-react";
import { loadNotificationOverview } from "@/lib/notifications/observability";
import type { EmailReadinessReason } from "@/lib/notifications/config";
import { NotificationRetryForm } from "@/components/admin/notification-retry-form";

export const metadata: Metadata = {
  title: "Notifications",
};

/**
 * `/admin/notifications` — delivery readiness and the failed-notification queue
 * (Phase 7).
 *
 * This page answers three operator questions honestly:
 *
 *  1. Can email be sent at all (provider, sender, owner recipient, processor)?
 *  2. How much has been accepted, and when was the last attempt?
 *  3. Which entries are stuck, and can each be safely requeued?
 *
 * "Accepted" is never presented as "delivered": a provider accepted message is
 * only evidence that the provider queued it.
 */

const READINESS_COPY: Record<EmailReadinessReason, string> = {
  not_configured: "Email delivery is not configured. Orders, payments and tracking keep working, but no message can be sent.",
  unsupported_provider: "The configured provider name is not supported by this build.",
  missing_api_key: "The provider API key is missing.",
  invalid_sender: "The sender address (EMAIL_FROM) is missing or invalid.",
  missing_sink_file: "The test sink file is not configured.",
  sink_forbidden: "The test sink is not permitted in production.",
  ready: "Email delivery is configured and ready to attempt a send.",
};

function formatDateTime(iso: string | null): string {
  if (!iso) return "Never";
  const date = new Date(iso);
  return Number.isNaN(date.getTime())
    ? "Unknown"
    : date.toLocaleString("en-CA", {
        month: "short",
        day: "numeric",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl border border-border bg-cream/60 px-4 py-3">
      <p className="font-sans text-xs font-semibold uppercase tracking-wide text-ink-muted">{label}</p>
      <p className="mt-1 font-serif text-2xl font-semibold text-navy">{value}</p>
    </div>
  );
}

function YesNo({ value, yes = "Configured", no = "Not configured" }: { value: boolean; yes?: string; no?: string }) {
  return <span className={value ? "font-semibold text-leaf-700" : "font-semibold text-terracotta-700"}>{value ? yes : no}</span>;
}

export default async function NotificationsPage() {
  // Live database state: never prerender or prefetch this page.
  await connection();
  const overview = await loadNotificationOverview();
  const { readiness, counts, volume } = overview;

  return (
    <div className="space-y-8">
      <div>
        <h1 className="flex items-center gap-2 font-serif text-3xl font-semibold text-navy">
          <Mail className="size-6" aria-hidden="true" />
          Notifications
        </h1>
        <p className="mt-1 font-sans text-sm text-ink-muted">
          Email delivery for order and payment events. Secrets are never shown on this page.
        </p>
      </div>

      {overview.databaseError ? (
        <div className="rounded-2xl border border-terracotta-700/40 bg-terracotta-700/10 p-5">
          <div className="flex items-start gap-3">
            <AlertTriangle className="mt-0.5 size-5 shrink-0 text-terracotta-700" aria-hidden="true" />
            <div>
              <h2 className="font-sans text-base font-bold text-navy">Notification data is unavailable</h2>
              <p className="mt-1 font-sans text-sm text-ink-muted">
                The database could not be read. Counts below are not evidence of a healthy queue.
              </p>
            </div>
          </div>
        </div>
      ) : null}

      <section aria-label="Delivery readiness" className="rounded-2xl border border-border bg-surface p-5">
        <h2 className="flex items-center gap-2 font-sans text-base font-bold text-navy">
          {readiness.configured ? (
            <CheckCircle2 className="size-4 text-leaf-700" aria-hidden="true" />
          ) : (
            <AlertTriangle className="size-4 text-gold-700" aria-hidden="true" />
          )}
          Delivery readiness
        </h2>
        <p className={`mt-2 font-sans text-sm ${readiness.configured ? "text-leaf-700" : "text-ink-muted"}`}>
          {READINESS_COPY[readiness.reason]}
        </p>
        <dl className="mt-4 grid gap-x-6 gap-y-2 sm:grid-cols-2">
          <div className="flex justify-between gap-4 border-b border-border/60 py-1.5">
            <dt className="font-sans text-sm text-ink-muted">Provider</dt>
            <dd className="font-sans text-sm font-semibold text-navy">{readiness.provider ?? "Not configured"}</dd>
          </div>
          <div className="flex justify-between gap-4 border-b border-border/60 py-1.5">
            <dt className="font-sans text-sm text-ink-muted">Sender</dt>
            <dd className="font-sans text-sm font-semibold text-navy">
              {readiness.senderEmail ?? "Not configured"}
              {readiness.senderLabel ? <span className="text-ink-muted"> ({readiness.senderLabel})</span> : null}
            </dd>
          </div>
          <div className="flex justify-between gap-4 border-b border-border/60 py-1.5">
            <dt className="font-sans text-sm text-ink-muted">Owner recipient</dt>
            <dd className="font-sans text-sm">
              <YesNo value={readiness.ownerRecipientConfigured} />
            </dd>
          </div>
          <div className="flex justify-between gap-4 border-b border-border/60 py-1.5">
            <dt className="font-sans text-sm text-ink-muted">Processor secret</dt>
            <dd className="font-sans text-sm">
              <YesNo value={readiness.processorConfigured} yes="Configured" no="Missing" />
            </dd>
          </div>
          <div className="flex justify-between gap-4 border-b border-border/60 py-1.5">
            <dt className="font-sans text-sm text-ink-muted">Delivery callbacks</dt>
            <dd className="font-sans text-sm">
              <YesNo value={readiness.webhookConfigured} yes="Configured" no="Not configured" />
            </dd>
          </div>
          <div className="flex justify-between gap-4 border-b border-border/60 py-1.5">
            <dt className="font-sans text-sm text-ink-muted">Cross-device tracking</dt>
            <dd className="font-sans text-sm">
              <YesNo
                value={readiness.trackingRecoveryAvailable}
                yes="Available"
                no="Unavailable until email works"
              />
            </dd>
          </div>
        </dl>
        <p className="mt-3 font-sans text-xs leading-relaxed text-ink-muted">
          When delivery is unavailable, events are still recorded and stay queued. Nothing is reported as sent,
          and no message is redirected to another address.
        </p>
      </section>

      <section aria-label="Queue state" className="rounded-2xl border border-border bg-surface p-5">
        <h2 className="font-sans text-base font-bold text-navy">Queue state</h2>
        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-5">
          <Stat label="Pending" value={counts.pending} />
          <Stat label="Processing" value={counts.processing} />
          <Stat label="Accepted" value={counts.sent} />
          <Stat label="Failed" value={counts.failed} />
          <Stat label="Uncertain" value={counts.uncertain} />
        </div>
        <dl className="mt-4 grid gap-x-6 gap-y-2 sm:grid-cols-2">
          <div className="flex justify-between gap-4 border-b border-border/60 py-1.5">
            <dt className="font-sans text-sm text-ink-muted">Last processing attempt</dt>
            <dd className="font-sans text-sm font-semibold text-navy">{formatDateTime(overview.lastAttemptAtIso)}</dd>
          </div>
          <div className="flex justify-between gap-4 border-b border-border/60 py-1.5">
            <dt className="font-sans text-sm text-ink-muted">Last provider acceptance</dt>
            <dd className="font-sans text-sm font-semibold text-navy">{formatDateTime(overview.lastAcceptedAtIso)}</dd>
          </div>
        </dl>
        {volume ? (
          <div className="mt-4 rounded-xl bg-cream/70 p-4">
            <p className="flex items-center gap-2 font-sans text-sm font-semibold text-navy">
              <Send className="size-4" aria-hidden="true" />
              Configured send limits
            </p>
            <p className="mt-1 font-sans text-sm text-ink-muted">
              {volume.sentToday} of {volume.dailyLimit} today, {volume.sentThisMonth} of {volume.monthlyLimit} this
              month. {volume.remaining} remaining under the stricter limit.
            </p>
            <p className="mt-1 font-sans text-xs text-ink-muted">
              These are the store&apos;s configured limits, not a claim about a provider plan.
            </p>
          </div>
        ) : null}
        <p className="mt-3 font-sans text-xs leading-relaxed text-ink-muted">
          &quot;Accepted&quot; means the provider queued the message. It does not prove delivery. Delivery callbacks are
          the only evidence that may move an entry to delivered, bounced or complained.
        </p>
      </section>

      <section aria-label="Notifications needing attention" className="rounded-2xl border border-border bg-surface p-5">
        <h2 className="flex items-center gap-2 font-sans text-base font-bold text-navy">
          <TriangleAlert className="size-4 text-terracotta-700" aria-hidden="true" />
          Notifications needing attention
        </h2>
        {overview.problems.length === 0 ? (
          <p className="mt-2 font-sans text-sm text-ink-muted">
            No failed or uncertain notifications. Unresolved entries are never silently deleted.
          </p>
        ) : (
          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[46rem] border-collapse text-left">
              <thead>
                <tr className="border-b border-border">
                  <th scope="col" className="py-2 pr-3 font-sans text-xs font-semibold uppercase tracking-wide text-ink-muted">Event</th>
                  <th scope="col" className="py-2 pr-3 font-sans text-xs font-semibold uppercase tracking-wide text-ink-muted">Order</th>
                  <th scope="col" className="py-2 pr-3 font-sans text-xs font-semibold uppercase tracking-wide text-ink-muted">To</th>
                  <th scope="col" className="py-2 pr-3 font-sans text-xs font-semibold uppercase tracking-wide text-ink-muted">State</th>
                  <th scope="col" className="py-2 pr-3 font-sans text-xs font-semibold uppercase tracking-wide text-ink-muted">Attempts</th>
                  <th scope="col" className="py-2 pr-3 font-sans text-xs font-semibold uppercase tracking-wide text-ink-muted">Last attempt</th>
                  <th scope="col" className="py-2 pr-3 font-sans text-xs font-semibold uppercase tracking-wide text-ink-muted">Reason</th>
                  <th scope="col" className="py-2 font-sans text-xs font-semibold uppercase tracking-wide text-ink-muted">Action</th>
                </tr>
              </thead>
              <tbody>
                {overview.problems.map((problem) => (
                  <tr key={problem.id} className="border-b border-border/60 align-top">
                    <td className="py-3 pr-3 font-sans text-sm text-navy">{problem.event}</td>
                    <td className="py-3 pr-3 font-sans text-sm">
                      <Link
                        href={`/admin/orders/${encodeURIComponent(problem.reference)}`}
                        className="font-semibold text-navy underline underline-offset-2 focus-gold"
                      >
                        {problem.reference}
                      </Link>
                    </td>
                    <td className="py-3 pr-3 font-sans text-sm text-ink-muted">{problem.recipientRole}</td>
                    <td className="py-3 pr-3 font-sans text-sm">
                      <span
                        className={
                          problem.status === "uncertain"
                            ? "rounded-full bg-gold/20 px-2 py-0.5 text-xs font-semibold text-gold-700"
                            : "rounded-full bg-terracotta-700/10 px-2 py-0.5 text-xs font-semibold text-terracotta-700"
                        }
                      >
                        {problem.status === "uncertain" ? "Uncertain" : "Failed"}
                      </span>
                    </td>
                    <td className="py-3 pr-3 font-sans text-sm text-ink-muted">
                      {problem.attempts}
                      {problem.ambiguousAttempts > 0 ? ` (${problem.ambiguousAttempts} ambiguous)` : ""}
                    </td>
                    <td className="py-3 pr-3 font-sans text-sm text-ink-muted">{formatDateTime(problem.lastAttemptAtIso)}</td>
                    <td className="py-3 pr-3 font-sans text-sm text-ink-muted">{problem.reason ?? "No reason recorded"}</td>
                    <td className="py-3">
                      <NotificationRetryForm id={problem.id} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="mt-3 font-sans text-xs leading-relaxed text-ink-muted">
          Retry returns the original event to the queue. It cannot change the recipient, subject or content.
          Delivery still happens through the processor.
        </p>
      </section>

      <section aria-label="Recently accepted" className="rounded-2xl border border-border bg-surface p-5">
        <h2 className="font-sans text-base font-bold text-navy">Recently accepted</h2>
        {overview.recentAccepted.length === 0 ? (
          <p className="mt-2 font-sans text-sm text-ink-muted">No message has been accepted by a provider yet.</p>
        ) : (
          <ul className="mt-3 divide-y divide-border/60">
            {overview.recentAccepted.map((entry) => (
              <li
                key={`${entry.event}:${entry.reference}:${entry.recipientRole}:${entry.sentAtIso ?? ""}`}
                className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 py-2"
              >
                <span className="font-sans text-sm font-semibold text-navy">
                  {entry.event} <span className="font-normal text-ink-muted">for</span>{" "}
                  <Link
                    href={`/admin/orders/${encodeURIComponent(entry.reference)}`}
                    className="underline underline-offset-2 focus-gold"
                  >
                    {entry.reference}
                  </Link>
                </span>
                <span className="font-sans text-xs text-ink-muted">
                  {entry.recipientRole} · provider state {entry.providerStatus ?? "unknown"} ·{" "}
                  {formatDateTime(entry.sentAtIso)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-label="Processing schedule" className="rounded-2xl border border-border bg-surface p-5">
        <h2 className="font-sans text-base font-bold text-navy">Processing schedule</h2>
        <p className="mt-2 font-sans text-sm text-ink-muted">
          The queue is drained by a guarded processor, not by order or payment requests. Run it manually with{" "}
          <code className="rounded bg-cream px-1.5 py-0.5 font-mono text-xs text-navy">
            npm run notifications:process
          </code>
          , or call the secured endpoint from a scheduler. Automatic scheduled delivery stays pending until a
          deployment scheduler is configured.
        </p>
      </section>
    </div>
  );
}
