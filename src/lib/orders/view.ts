import "server-only";
import { createHash } from "node:crypto";
import { PaymentAttemptModel, type PaymentAttemptRecord } from "@/models/payment-attempt";
import type { OrderRecord } from "@/models/order";
import { getCheckoutSettings } from "@/lib/store/config";
import { stripeReadiness } from "@/lib/payments/stripe";
import type { OrderConfirmationView } from "@/lib/validations/order";

/**
 * Shared order view builder (Phase 5, extracted in Phase 7).
 *
 * The confirmation page and the tracking page must present the SAME facts with
 * the same wording and the same payment rules. Keeping one builder means a
 * change to the view cannot drift between the two surfaces.
 *
 * This module is server-only because it reads payment attempts and store
 * configuration, but it contains no authorisation logic: callers prove access
 * first and pass the order in.
 */

/** sha256 of the Phase 5 guest capability; identical to the stored value. */
export function hashConfirmationKey(key: string): string {
  return createHash("sha256").update(key, "utf8").digest("hex");
}

export function toConfirmationView(
  order: OrderRecord,
  attempts: Array<{ status: string; createdAt: Date; expiresAt?: Date | null; failureCode?: string | null }>,
  onlineEnabled: boolean,
): OrderConfirmationView {
  return {
    reference: order.reference,
    status: order.status,
    placedAtIso: new Date(order.createdAt).toISOString(),
    statusHistory: (order.statusHistory ?? []).map((event) => ({
      from: event.from ?? null,
      to: event.to,
      atIso: new Date(event.at).toISOString(),
    })),
    items: order.items.map((item) => ({
      name: item.name,
      variantName: item.variantName ?? null,
      quantity: item.quantity,
      unitPriceCents: item.unitPriceCents,
      lineTotalCents: item.lineTotalCents,
    })),
    money: {
      currency: "CAD",
      subtotalCents: order.money.subtotalCents,
      deliveryFeeCents: order.money.deliveryFeeCents,
      taxCents: order.money.taxCents,
      totalCents: order.money.totalCents,
      taxLabel: order.money.taxLabel ?? null,
    },
    fulfillment: {
      method: order.fulfillment.method,
      serviceAreaLabel: order.fulfillment.serviceAreaLabel ?? null,
      pickupInstructions: order.fulfillment.pickupInstructions ?? null,
    },
    payment: {
      method: order.payment.method,
      status: order.payment.status,
      provider: order.payment.provider ?? (order.payment.method === "stripe" ? "stripe" : "none"),
      amountReceivedCents:
        order.payment.amountReceivedCents ?? (order.payment.status === "paid" ? order.money.totalCents : 0),
      refundedAmountCents: order.payment.refundedAmountCents ?? 0,
      requiresReview: order.payment.requiresReview ?? false,
      reconciliationStatus: order.payment.reconciliationStatus ?? "not_checked",
      lastReconciledAtIso: order.payment.lastReconciledAt
        ? new Date(order.payment.lastReconciledAt).toISOString()
        : null,
      paidAtIso: order.payment.paidAt ? new Date(order.payment.paidAt).toISOString() : null,
      attempts: attempts.map((attempt) => ({
        status: attempt.status as OrderConfirmationView["payment"]["attempts"][number]["status"],
        createdAtIso: new Date(attempt.createdAt).toISOString(),
        expiresAtIso: attempt.expiresAt ? new Date(attempt.expiresAt).toISOString() : null,
        failureCode: attempt.failureCode ?? null,
      })),
      retryAvailable:
        order.payment.method === "stripe" &&
        onlineEnabled &&
        order.status !== "cancelled" &&
        order.status !== "completed" &&
        !["paid", "partially_refunded", "refunded", "review_required"].includes(order.payment.status),
    },
  };
}

/** Load the payment context and build the view for an authorised order. */
export async function loadConfirmationView(order: OrderRecord): Promise<OrderConfirmationView> {
  const attemptsPromise: Promise<PaymentAttemptRecord[]> =
    order.payment.method === "stripe"
      ? (PaymentAttemptModel.find({ orderId: String(order._id) })
          .sort({ sequence: -1, _id: -1 })
          .limit(5)
          .select({ status: 1, createdAt: 1, expiresAt: 1, failureCode: 1 })
          .lean()
          .exec() as Promise<PaymentAttemptRecord[]>)
      : Promise.resolve([]);
  const [attempts, settings] = await Promise.all([
    attemptsPromise,
    order.payment.method === "stripe" ? getCheckoutSettings() : Promise.resolve(null),
  ]);
  return toConfirmationView(
    order,
    attempts,
    settings?.onlinePaymentsEnabled === true && stripeReadiness().ready,
  );
}
