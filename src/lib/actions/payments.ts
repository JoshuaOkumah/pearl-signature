"use server";

import { recordAudit } from "@/lib/auth/audit";
import { requireActionAdmin } from "@/lib/auth/guard";
import { reconcileStripeOrder } from "@/lib/payments/reconcile";
import { reconcilePaymentSchema } from "@/lib/validations/admin";

export interface ReconcilePaymentActionResult {
  ok: boolean;
  error?: string;
  report?: {
    mode: "dry_run" | "applied";
    result: "matched" | "mismatch" | "pending" | "not_applicable" | "unavailable";
    summary: string;
    checkedAttempts: number;
    providerPaidCents: number;
    providerRefundedCents: number;
  };
}

export async function reconcilePaymentAction(
  _previous: ReconcilePaymentActionResult,
  formData: FormData,
): Promise<ReconcilePaymentActionResult> {
  const guard = await requireActionAdmin();
  if (!guard.ok) return { ok: false, error: "Your session has expired. Please sign in again." };
  const parsed = reconcilePaymentSchema.safeParse({
    reference: formData.get("reference") ?? "",
    apply: formData.get("apply") ?? "false",
  });
  if (!parsed.success) return { ok: false, error: "The reconciliation request could not be validated." };

  const apply = parsed.data.apply === "true";
  const report = await reconcileStripeOrder(parsed.data.reference, apply);
  if (apply && report.result !== "unavailable" && report.result !== "not_applicable") {
    await recordAudit({
      event: "payment.reconciled",
      outcome: report.result === "mismatch" ? "failure" : "success",
      adminId: String(guard.admin._id),
      email: guard.admin.email,
      target: { type: "order", id: parsed.data.reference, label: parsed.data.reference },
      detail: `Stripe reconciliation applied: ${report.result}, ${report.checkedAttempts} attempts`,
    });
  }
  return { ok: true, report };
}
