import "server-only";
import type Stripe from "stripe";
import { connectDatabase } from "@/lib/db/mongoose";
import { OrderModel } from "@/models/order";
import { PaymentAttemptModel } from "@/models/payment-attempt";
import { ORDER_REFERENCE_PATTERN } from "@/lib/validations/order";
import { stripeClient, stripeReadiness } from "@/lib/payments/stripe";
import {
  markReconciliationMismatch,
  reconcileVerifiedExpiry,
  reconcileVerifiedPayment,
  reconcileVerifiedProcessing,
  reconcileVerifiedRefundCharge,
} from "@/lib/payments/webhooks";

export interface PaymentReconciliationReport {
  reference: string;
  mode: "dry_run" | "applied";
  result: "matched" | "mismatch" | "pending" | "not_applicable" | "unavailable";
  summary: string;
  checkedAttempts: number;
  providerPaidCents: number;
  providerRefundedCents: number;
}

type Finding = {
  attemptId: string;
  status: "paid" | "expired" | "processing" | "open" | "mismatch" | "unknown";
  charge?: Stripe.Charge;
  code?: string;
};

export interface StripeReconciliationGateway {
  checkout: { sessions: { retrieve: (id: string) => Promise<Stripe.Checkout.Session> } };
  paymentIntents: { retrieve: (id: string) => Promise<Stripe.PaymentIntent> };
  charges: { retrieve: (id: string, params?: Stripe.ChargeRetrieveParams) => Promise<Stripe.Charge> };
}

let testGateway: StripeReconciliationGateway | null = null;

export function setStripeReconciliationGatewayForTests(gateway: StripeReconciliationGateway | null): void {
  testGateway = gateway;
}

function reconciliationGateway(): StripeReconciliationGateway {
  return testGateway ?? stripeClient();
}

/**
 * Bounded reconciliation for one Stripe order. Dry-run is the default and
 * performs provider reads only. Applying a result is a separate, audited
 * admin action; provider facts and immutable order cents must match first.
 */
export async function reconcileStripeOrder(referenceInput: string, apply = false): Promise<PaymentReconciliationReport> {
  const reference = referenceInput.trim().toUpperCase();
  if (!ORDER_REFERENCE_PATTERN.test(reference)) {
    return report(reference, apply, "not_applicable", "That order reference is not valid.");
  }
  if (!stripeReadiness().ready) return report(reference, apply, "unavailable", "Stripe test-mode configuration is not ready.");

  try {
    await connectDatabase();
    const order = await OrderModel.findOne({ reference }).lean();
    if (!order) return report(reference, apply, "not_applicable", "That order could not be found.");
    if (order.payment.method !== "stripe") return report(reference, apply, "not_applicable", "This order does not use Stripe.");

    const attempts = await PaymentAttemptModel.find({ orderId: String(order._id) }).sort({ sequence: -1 }).limit(5).lean();
    if (attempts.length === 0) {
      if (apply) {
        await OrderModel.updateOne(
          { _id: order._id, "payment.method": "stripe", "payment.status": { $ne: "paid" } },
          { $set: { "payment.status": "review_required", "payment.requiresReview": true, "payment.reconciliationStatus": "mismatch", "payment.lastReconciledAt": new Date() }, $inc: { version: 1 } },
        );
      }
      return report(reference, apply, "mismatch", "No persisted provider attempt exists for this Stripe order.");
    }

    const findings: Finding[] = [];
    for (const attempt of attempts) {
      if (!attempt.checkoutSessionId) {
        findings.push({ attemptId: String(attempt._id), status: "unknown", code: "session_reference_missing" });
        continue;
      }
      try {
        const session = await reconciliationGateway().checkout.sessions.retrieve(attempt.checkoutSessionId);
        if (
          session.id !== attempt.checkoutSessionId ||
          session.livemode ||
          session.currency !== "cad" ||
          session.amount_total !== attempt.amountCents ||
          attempt.amountCents !== order.money.totalCents ||
          attempt.currency !== "CAD" ||
          order.money.currency !== "CAD" ||
          session.client_reference_id !== reference ||
          session.metadata?.order_reference !== reference ||
          session.metadata?.payment_attempt_id !== String(attempt._id)
        ) {
          findings.push({ attemptId: String(attempt._id), status: "mismatch", code: "provider_snapshot_mismatch" });
          continue;
        }

        let status: Finding["status"] = "open";
        if (session.payment_status === "paid") status = "paid";
        else if (session.status === "expired") status = "expired";
        else if (session.status === "complete") status = "processing";

        if (
          status !== "paid" &&
          ["paid", "partially_refunded", "refunded"].includes(order.payment.status)
        ) {
          findings.push({ attemptId: String(attempt._id), status: "mismatch", code: "local_paid_provider_not_settled" });
          continue;
        }
        if (status === "open" && ["failed", "expired"].includes(order.payment.status)) {
          findings.push({ attemptId: String(attempt._id), status: "mismatch", code: "local_failure_provider_open" });
          continue;
        }

        let charge: Finding["charge"];
        if (status === "paid" && typeof session.payment_intent === "string") {
          const intent = await reconciliationGateway().paymentIntents.retrieve(session.payment_intent);
          if (intent.currency !== "cad" || intent.amount !== attempt.amountCents || intent.status !== "succeeded") {
            findings.push({ attemptId: String(attempt._id), status: "mismatch", code: "payment_intent_mismatch" });
            continue;
          }
          const chargeId = typeof intent.latest_charge === "string" ? intent.latest_charge : intent.latest_charge?.id;
          if (chargeId) {
            charge = await reconciliationGateway().charges.retrieve(chargeId, { expand: ["refunds"] });
            if (charge.currency !== "cad" || charge.amount !== attempt.amountCents) {
              findings.push({ attemptId: String(attempt._id), status: "mismatch", code: "charge_amount_mismatch" });
              continue;
            }
          }
        }
        findings.push({ attemptId: String(attempt._id), status, ...(charge ? { charge } : {}) });
      } catch {
        findings.push({ attemptId: String(attempt._id), status: "unknown", code: "provider_read_unavailable" });
      }
    }

    const mismatch = findings.some((finding) => finding.status === "mismatch");
    const unknown = findings.some((finding) => finding.status === "unknown");
    const paid = findings.filter((finding) => finding.status === "paid");
    const refundedCents = paid.reduce((total, finding) => total + (finding.charge?.amount_refunded ?? 0), 0);
    const paidCents = paid.length > 0 ? order.money.totalCents : 0;

    if (apply) {
      if (mismatch || unknown) {
        for (const finding of findings.filter((entry) => entry.status === "mismatch" || entry.status === "unknown")) {
          await markReconciliationMismatch(reference, finding.attemptId, finding.code ?? "provider_read_unavailable");
        }
      } else {
        for (const finding of findings) {
          if (finding.status === "paid") {
            await reconcileVerifiedPayment(reference, finding.attemptId);
            if (finding.charge && finding.charge.amount_refunded > 0) {
              const refundResult = await reconcileVerifiedRefundCharge(finding.charge);
              if (refundResult === "quarantined") {
                await markReconciliationMismatch(reference, finding.attemptId, "refund_details_incomplete");
              }
            }
          } else if (finding.status === "expired") {
            await reconcileVerifiedExpiry(reference, finding.attemptId);
          } else if (finding.status === "processing") {
            await reconcileVerifiedProcessing(reference, finding.attemptId);
          } else if (finding.status === "open") {
            await PaymentAttemptModel.updateOne(
              { _id: finding.attemptId, active: true },
              { $set: { status: "open", lastReconciledAt: new Date(), reconciliationStatus: "matched" } },
            );
          }
        }
        await OrderModel.updateOne(
          { _id: order._id, "payment.method": "stripe" },
          { $set: { "payment.reconciliationStatus": "matched", "payment.lastReconciledAt": new Date() } },
        );
      }
    }

    const result = mismatch ? "mismatch" : unknown ? "pending" : "matched";
    return {
      reference,
      mode: apply ? "applied" : "dry_run",
      result,
      summary: result === "matched"
        ? "Provider amount and currency match the saved order snapshot."
        : result === "mismatch"
          ? "A provider or saved order value does not match. Review is required."
          : "Stripe could not verify every attempt. No uncertain payment was changed.",
      checkedAttempts: attempts.length,
      providerPaidCents: paidCents,
      providerRefundedCents: refundedCents,
    };
  } catch {
    return report(reference, apply, "unavailable", "Reconciliation could not complete. No provider credentials or internal details were exposed.");
  }
}

function report(
  reference: string,
  apply: boolean,
  result: PaymentReconciliationReport["result"],
  summary: string,
): PaymentReconciliationReport {
  return { reference, mode: apply ? "applied" : "dry_run", result, summary, checkedAttempts: 0, providerPaidCents: 0, providerRefundedCents: 0 };
}
