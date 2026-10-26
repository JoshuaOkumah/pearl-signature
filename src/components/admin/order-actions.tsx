"use client";

import { useActionState, useEffect, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Banknote, StickyNote } from "lucide-react";
import {
  addOrderNoteAction,
  changeOrderStatusAction,
  recordPaymentAction,
} from "@/lib/actions/admin-orders";
import { ORDER_STATUS_LABELS } from "@/lib/orders/lifecycle";
import type { AdminOrderActionResult } from "@/lib/validations/admin";
import type { FulfillmentMethod } from "@/lib/validations/checkout";
import { MAX_ORDER_NOTES, type OrderStatus, type PaymentStatus } from "@/lib/validations/order";
import { ConfirmSubmit } from "@/components/admin/confirm-submit";
import { FormAlert } from "@/components/admin/field";

/**
 * Order detail actions (Phase 5, Milestones C/D).
 *
 * Three Server Actions, each wrapped in `useActionState` so every outcome
 * (success, conflict, rejection, validation error) is reported in place
 * instead of navigating away.
 *
 * Confirmation policy: cancellation, completion and payment recording are
 * significant, hard-to-reverse actions, so each uses the two-step
 * arm-then-confirm control (`ConfirmSubmit`). Routine forward steps
 * (confirm, prepare, hand over) submit on a single press.
 *
 * The transition buttons offered here are computed on the server from the
 * lifecycle rules; the Server Action re-derives them from the freshly
 * loaded order, so this component is presentation only.
 */

const INITIAL: AdminOrderActionResult = { ok: false };

const plainActionClass =
  "inline-flex min-h-9 items-center gap-1.5 rounded-full border border-navy/25 px-3.5 font-sans text-xs font-bold text-navy transition-colors hover:border-navy hover:bg-navy hover:text-cream focus-gold disabled:pointer-events-none disabled:opacity-50";

/** First message of any kind in a failed result, for a single inline alert. */
function problemFor(state: AdminOrderActionResult): string | null {
  if (state.ok) return null;
  if (state.conflict) return state.error ?? "The order changed. Reload the page.";
  const fieldError = state.fieldErrors ? Object.values(state.fieldErrors)[0] : undefined;
  return fieldError ?? state.error ?? null;
}

function Section({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-border bg-surface p-5">
      <h2 className="font-sans text-base font-bold text-navy">{title}</h2>
      {description ? <p className="mt-1 font-sans text-sm text-ink-muted">{description}</p> : null}
      <div className="mt-4">{children}</div>
    </section>
  );
}

export function OrderActions({
  reference,
  status,
  method,
  allowed,
  paymentStatus,
  version,
}: {
  reference: string;
  status: OrderStatus;
  method: FulfillmentMethod;
  allowed: OrderStatus[];
  paymentStatus: PaymentStatus;
  version: number;
}) {
  const router = useRouter();
  const [statusState, statusFormAction, statusPending] = useActionState(changeOrderStatusAction, INITIAL);
  const [payState, payFormAction] = useActionState(recordPaymentAction, INITIAL);
  const [noteState, noteFormAction, notePending] = useActionState(addOrderNoteAction, INITIAL);
  const [reason, setReason] = useState("");
  const firstRun = useRef(true);

  // Every mutation (success, conflict, rejection) means the server-rendered
  // timeline, badges and version token may be stale: re-fetch the server
  // component in place. Skipped on mount so loading the page never issues
  // a second request.
  useEffect(() => {
    if (firstRun.current) {
      firstRun.current = false;
      return;
    }
    router.refresh();
  }, [statusState, payState, noteState, router]);

  const statusProblem = problemFor(statusState);
  const payProblem = problemFor(payState);
  const noteProblem = problemFor(noteState);
  const canCancel = allowed.includes("cancelled");

  function statusForm(to: OrderStatus): ReactNode {
    return (
      <>
        <input type="hidden" name="reference" value={reference} />
        <input type="hidden" name="to" value={to} />
        <input type="hidden" name="expectedVersion" value={String(version)} />
      </>
    );
  }

  return (
    <div className="space-y-5">
      {/* ── lifecycle ─────────────────────────────────────────────── */}
      <Section
        title="Status"
        description={`Current status: ${ORDER_STATUS_LABELS[status]}. ${method === "delivery" ? "Delivery" : "Pickup"} order.`}
      >
        {allowed.length === 0 ? (
          <p className="font-sans text-sm text-ink-muted">
            This order is finished. Its status cannot change again.
          </p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {allowed.map((to) => {
              const needsConfirm = to === "cancelled" || to === "completed";
              const buttonLabel =
                to === "cancelled" ? "Cancel order" : `Mark as ${ORDER_STATUS_LABELS[to].toLowerCase()}`;
              const confirmLabel =
                to === "cancelled" ? "Confirm cancellation" : `Confirm ${ORDER_STATUS_LABELS[to].toLowerCase()}`;

              if (needsConfirm) {
                return (
                  <ConfirmSubmit
                    key={to}
                    action={statusFormAction}
                    fields={{
                      reference,
                      to,
                      expectedVersion: String(version),
                      ...(to === "cancelled" ? { reason } : {}),
                    }}
                    buttonLabel={buttonLabel}
                    confirmLabel={confirmLabel}
                    tone={to === "cancelled" ? "danger" : "neutral"}
                  />
                );
              }
              return (
                <form key={to} action={statusFormAction} className="inline-flex">
                  {statusForm(to)}
                  <button type="submit" disabled={statusPending} className={plainActionClass}>
                    {buttonLabel}
                  </button>
                </form>
              );
            })}
          </div>
        )}

        {canCancel ? (
          <div className="mt-4">
            <label htmlFor="order-cancel-reason" className="mb-1.5 block font-sans text-sm font-semibold text-navy">
              Cancellation reason
            </label>
            <textarea
              id="order-cancel-reason"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              maxLength={300}
              rows={2}
              placeholder="Required when you cancel this order"
              className="w-full rounded-lg border border-navy/20 bg-surface px-3 py-2 font-sans text-sm text-navy placeholder:text-ink-muted/70 transition-colors hover:border-navy/35 focus-gold"
            />
            <p className="mt-1 font-sans text-xs text-ink-muted">
              Stored on the order and shown in its status history.
            </p>
          </div>
        ) : null}

        {statusState.ok ? (
          <div className="mt-4">
            <FormAlert tone="success">
              {statusState.status === "cancelled"
                ? "The order has been cancelled."
                : `Order marked as ${ORDER_STATUS_LABELS[statusState.status ?? status].toLowerCase()}.`}
            </FormAlert>
          </div>
        ) : statusProblem ? (
          <div className="mt-4">
            <FormAlert tone="error">{statusProblem}</FormAlert>
          </div>
        ) : null}
      </Section>

      {/* ── payment ───────────────────────────────────────────────── */}
      <Section
        title="Payment"
        description="Cash on Arrival is recorded by hand once the money is physically received."
      >
        {paymentStatus === "paid" ? (
          <p className="font-sans text-sm text-leaf-700">
            Payment for this order has been recorded.
          </p>
        ) : (
          <div className="flex flex-wrap items-center gap-3">
            <ConfirmSubmit
              action={payFormAction}
              fields={{ reference, expectedVersion: String(version) }}
              buttonLabel="Record payment received"
              confirmLabel="Confirm payment received"
              tone="neutral"
            >
              <Banknote className="size-3.5" aria-hidden="true" />
            </ConfirmSubmit>
            <span className="font-sans text-xs text-ink-muted">Two presses to confirm.</span>
          </div>
        )}
        {payState.ok ? (
          <div className="mt-4">
            <FormAlert tone="success">Payment recorded for this order.</FormAlert>
          </div>
        ) : payProblem ? (
          <div className="mt-4">
            <FormAlert tone="error">{payProblem}</FormAlert>
          </div>
        ) : null}
      </Section>

      {/* ── operational notes ─────────────────────────────────────── */}
      <Section
        title="Operational notes"
        description={`Internal only. Up to ${MAX_ORDER_NOTES} notes per order; customers never see them.`}
      >
        <form action={noteFormAction} className="flex flex-col gap-3">
          <input type="hidden" name="reference" value={reference} />
          <label htmlFor="order-note-body" className="sr-only">
            Note
          </label>
          <textarea
            id="order-note-body"
            name="body"
            rows={2}
            maxLength={500}
            placeholder="For example: customer asked for a later pickup time"
            className="w-full rounded-lg border border-navy/20 bg-surface px-3 py-2 font-sans text-sm text-navy placeholder:text-ink-muted/70 transition-colors hover:border-navy/35 focus-gold"
          />
          <div>
            <button
              type="submit"
              disabled={notePending}
              className="inline-flex items-center gap-1.5 rounded-full bg-navy px-4 font-sans text-xs font-bold text-cream transition-colors hover:bg-navy-800 focus-gold disabled:pointer-events-none disabled:opacity-50"
            >
              <StickyNote className="size-3.5" aria-hidden="true" />
              {notePending ? "Saving…" : "Add note"}
            </button>
          </div>
        </form>
        {noteState.ok ? (
          <div className="mt-4">
            <FormAlert tone="success">Note added.</FormAlert>
          </div>
        ) : noteProblem ? (
          <div className="mt-4">
            <FormAlert tone="error">{noteProblem}</FormAlert>
          </div>
        ) : null}
      </Section>
    </div>
  );
}
