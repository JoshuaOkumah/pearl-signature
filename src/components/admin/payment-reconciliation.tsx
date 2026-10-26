"use client";

import { useActionState } from "react";
import { CheckCircle2, Search, ShieldAlert } from "lucide-react";
import { formatCad } from "@/lib/format";
import { reconcilePaymentAction, type ReconcilePaymentActionResult } from "@/lib/actions/payments";
import { ConfirmSubmit } from "@/components/admin/confirm-submit";

const INITIAL: ReconcilePaymentActionResult = { ok: false };

/** Admin-only dry-run first; applying verified changes is a separate two-step action. */
export function PaymentReconciliation({ reference }: { reference: string }) {
  const [state, action] = useActionState(reconcilePaymentAction, INITIAL);

  return (
    <section aria-label="Payment reconciliation" className="rounded-2xl border border-border bg-surface p-5">
      <h2 className="font-sans text-base font-bold text-navy">Stripe reconciliation</h2>
      <p className="mt-1 font-sans text-sm text-ink-muted">
        Check this order against Stripe&apos;s server record. The first action is read-only. Applying changes requires a second confirmation and is recorded in the admin audit log.
      </p>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <form action={action}>
          <input type="hidden" name="reference" value={reference} />
          <input type="hidden" name="apply" value="false" />
          <button type="submit" className="inline-flex min-h-10 items-center gap-2 rounded-full border border-navy/25 px-4 font-sans text-sm font-bold text-navy hover:bg-cream-100 focus-gold">
            <Search className="size-4" aria-hidden="true" />
            Run read-only check
          </button>
        </form>
        <ConfirmSubmit
          action={(formData) => action(formData)}
          fields={{ reference, apply: "true" }}
          buttonLabel="Apply verified reconciliation"
          confirmLabel="Confirm and apply reconciliation"
          tone="neutral"
        >
          <CheckCircle2 className="size-4" aria-hidden="true" />
        </ConfirmSubmit>
      </div>
      {state.error ? <p role="alert" className="mt-4 text-sm text-terracotta-700">{state.error}</p> : null}
      {state.report ? (
        <div className="mt-4 rounded-xl bg-cream-100 p-4" role="status">
          <p className="flex items-start gap-2 font-sans text-sm font-semibold text-navy">
            <ShieldAlert className="mt-0.5 size-4 shrink-0 text-gold-700" aria-hidden="true" />
            {state.report.summary}
          </p>
          <p className="mt-2 font-sans text-xs text-ink-muted">
            {state.report.mode === "dry_run" ? "Read-only" : "Applied"} · {state.report.checkedAttempts} attempts checked · Provider-confirmed payment {formatCad(state.report.providerPaidCents)} · Provider-confirmed refunds {formatCad(state.report.providerRefundedCents)}
          </p>
        </div>
      ) : null}
    </section>
  );
}
