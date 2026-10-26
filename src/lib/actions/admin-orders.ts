"use server";

import { recordAudit } from "@/lib/auth/audit";
import { requireActionAdmin } from "@/lib/auth/guard";
import { connectDatabase, logDatabaseError } from "@/lib/db/mongoose";
import { notifyOrderEvent } from "@/lib/notifications/dispatch";
import { ORDER_STATUS_LABELS, transitionRejection } from "@/lib/orders/lifecycle";
import { OrderModel } from "@/models/order";
import {
  orderNoteSchema,
  orderStatusChangeSchema,
  recordPaymentSchema,
  type AdminOrderActionResult,
} from "@/lib/validations/admin";
import { MAX_ORDER_NOTES } from "@/lib/validations/order";

/**
 * Admin order Server Actions (Phase 5, Milestones C/D).
 *
 * Every mutation follows the same contract as the rest of the admin area:
 *
 *   independent session guard → Zod allowlist → lifecycle / state rules
 *   evaluated against the FRESHLY LOADED order → optimistic-concurrency
 *   filter in the update itself → audit → honest structured result.
 *
 * Notes on what the client can and cannot do here:
 *
 *  - The form carries only `{ reference, to, expectedVersion, reason }`
 *    (or its smaller equivalents). There is no path by which a request
 *    could set money, payment status, customer data or an arbitrary field.
 *  - The transition legality is decided server-side by `transitionRejection`
 *    against the current record — the buttons the UI offers are a
 *    convenience, never the authority.
 *  - `expectedVersion` is embedded in the update filter, so two operators
 *    acting on the same order cannot silently overwrite each other: the
 *    loser gets `conflict` and reloads.
 */

const UNAUTHORIZED: AdminOrderActionResult = {
  ok: false,
  error: "Your session has expired. Please sign in again.",
};

const CONFLICT: AdminOrderActionResult = {
  ok: false,
  conflict: true,
  error: "This order changed while you were viewing it. Reload the page to see the current state.",
};

const NOT_FOUND: AdminOrderActionResult = {
  ok: false,
  error: "That order could not be found. Reload the page and try again.",
};

const SAVE_FAILED: AdminOrderActionResult = {
  ok: false,
  error: "That change could not be saved. Please try again.",
};

function toFieldErrors(issues: ReadonlyArray<{ path: readonly PropertyKey[]; message: string }>): Record<string, string> {
  const fieldErrors: Record<string, string> = {};
  for (const issue of issues) {
    fieldErrors[String(issue.path[0] ?? "form")] ??= issue.message;
  }
  return fieldErrors;
}

/* ── lifecycle transition ───────────────────────────────────────────── */

/**
 * Move an order through its lifecycle (confirm, prepare, hand over,
 * complete) or cancel it with a reason.
 */
export async function changeOrderStatusAction(
  _previous: AdminOrderActionResult,
  formData: FormData,
): Promise<AdminOrderActionResult> {
  const guard = await requireActionAdmin();
  if (!guard.ok) return UNAUTHORIZED;

  const parsed = orderStatusChangeSchema.safeParse({
    reference: formData.get("reference") ?? "",
    to: formData.get("to") ?? "",
    expectedVersion: formData.get("expectedVersion") ?? "",
    reason: formData.get("reason") || undefined,
  });
  if (!parsed.success) return { ok: false, fieldErrors: toFieldErrors(parsed.error.issues) };
  const input = parsed.data;
  const reason = input.reason || null;

  try {
    await connectDatabase();
    const order = await OrderModel.findOne({ reference: input.reference }).lean();
    if (!order) return NOT_FOUND;
    if (order.version !== input.expectedVersion) return CONFLICT;

    // Legality is decided HERE, from the record just read.
    const rejection = transitionRejection(order.status, input.to, order.fulfillment.method);
    if (rejection) return { ok: false, error: rejection };

    const adminId = String(guard.admin._id);
    const result = await OrderModel.updateOne(
      // The concurrency token lives in the filter itself.
      { _id: order._id, version: input.expectedVersion },
      {
        $set: { status: input.to, ...(input.to === "cancelled" && reason ? { cancellationReason: reason } : {}) },
        $push: {
          statusHistory: { from: order.status, to: input.to, at: new Date(), adminId, note: reason },
        },
        $inc: { version: 1 },
      },
    );
    if (result.matchedCount === 0) return CONFLICT;

    await recordAudit({
      event: "order.status_changed",
      outcome: "success",
      adminId,
      email: guard.admin.email,
      target: { type: "order", id: input.reference, label: input.reference },
      detail: `${ORDER_STATUS_LABELS[order.status]} -> ${ORDER_STATUS_LABELS[input.to]}`,
    });

    // Tell the customer about the new status. The enqueue is idempotent
    // and both it and the background delivery attempt swallow their own
    // errors, so a notification problem can never fail an operator action
    // whose write already succeeded (docs/ORDER_NOTIFICATIONS.md).
    await notifyOrderEvent("order.status_changed", input.reference);

    return { ok: true, status: input.to, version: input.expectedVersion + 1 };
  } catch (error) {
    logDatabaseError("order-status-change", error);
    return SAVE_FAILED;
  }
}

/* ── Cash on Arrival payment recording ──────────────────────────────── */

/**
 * Record that the Cash on Arrival amount was physically received.
 *
 * This is the ONLY path to `payment.status = "paid"` in Phase 5: the
 * customer never sends a payment result, and no webhook exists. Payment is
 * recorded against the order's stored total — the form carries no amount,
 * so the recorded value can never disagree with what the order says.
 */
export async function recordPaymentAction(
  _previous: AdminOrderActionResult,
  formData: FormData,
): Promise<AdminOrderActionResult> {
  const guard = await requireActionAdmin();
  if (!guard.ok) return UNAUTHORIZED;

  const parsed = recordPaymentSchema.safeParse({
    reference: formData.get("reference") ?? "",
    expectedVersion: formData.get("expectedVersion") ?? "",
  });
  if (!parsed.success) return { ok: false, fieldErrors: toFieldErrors(parsed.error.issues) };
  const input = parsed.data;

  try {
    await connectDatabase();
    const order = await OrderModel.findOne({ reference: input.reference }).lean();
    if (!order) return NOT_FOUND;
    if (order.version !== input.expectedVersion) return CONFLICT;
    if (order.payment.status === "paid") {
      return { ok: false, conflict: true, error: "Payment has already been recorded for this order." };
    }

    const adminId = String(guard.admin._id);
    const result = await OrderModel.updateOne(
      { _id: order._id, version: input.expectedVersion, "payment.status": "unpaid" },
      {
        $set: {
          "payment.status": "paid",
          "payment.paidAt": new Date(),
          "payment.paidByAdminId": adminId,
          "payment.paidByLabel": guard.admin.email,
        },
        $inc: { version: 1 },
      },
    );
    if (result.matchedCount === 0) return CONFLICT;

    await recordAudit({
      event: "order.payment_recorded",
      outcome: "success",
      adminId,
      email: guard.admin.email,
      target: { type: "order", id: input.reference, label: input.reference },
      detail: `Cash on Arrival payment recorded (${order.money.totalCents} cents CAD)`,
    });

    return { ok: true, paymentStatus: "paid", version: input.expectedVersion + 1 };
  } catch (error) {
    logDatabaseError("order-payment-record", error);
    return SAVE_FAILED;
  }
}

/* ── operational note ───────────────────────────────────────────────── */

/**
 * Append an operator note. Notes are bounded per order and deliberately do
 * NOT bump `version`: they add information without changing order state,
 * so a note written by one operator cannot invalidate another operator's
 * pending status change.
 */
export async function addOrderNoteAction(
  _previous: AdminOrderActionResult,
  formData: FormData,
): Promise<AdminOrderActionResult> {
  const guard = await requireActionAdmin();
  if (!guard.ok) return UNAUTHORIZED;

  const parsed = orderNoteSchema.safeParse({
    reference: formData.get("reference") ?? "",
    body: formData.get("body") ?? "",
  });
  if (!parsed.success) return { ok: false, fieldErrors: toFieldErrors(parsed.error.issues) };
  const input = parsed.data;

  try {
    await connectDatabase();
    const order = await OrderModel.findOne({ reference: input.reference }).lean();
    if (!order) return NOT_FOUND;
    if (order.notes.length >= MAX_ORDER_NOTES) {
      return { ok: false, error: `This order already has the maximum of ${MAX_ORDER_NOTES} notes.` };
    }

    const adminId = String(guard.admin._id);
    const result = await OrderModel.updateOne(
      { _id: order._id },
      { $push: { notes: { body: input.body, at: new Date(), adminId } } },
    );
    if (result.matchedCount === 0) return NOT_FOUND;

    await recordAudit({
      event: "order.note_added",
      outcome: "success",
      adminId,
      email: guard.admin.email,
      target: { type: "order", id: input.reference, label: input.reference },
      detail: "Operational note added",
    });

    return { ok: true, version: order.version };
  } catch (error) {
    logDatabaseError("order-note-add", error);
    return SAVE_FAILED;
  }
}
