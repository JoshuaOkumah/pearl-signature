import type { OrderConfirmationView, OrderStatus } from "@/lib/validations/order";

/**
 * Customer-facing tracking presentation rules (Phase 7).
 *
 * Pure and isomorphic so the same logic can be unit-tested without a browser.
 * It invents nothing: every step maps to a real lifecycle status, and the
 * payment copy distinguishes an unpaid Cash on Arrival order from a confirmed
 * online payment and from a refund that has not happened.
 */

export type TrackingStepState = "complete" | "current" | "upcoming";

export interface TrackingStep {
  key: string;
  label: string;
  atIso: string | null;
  state: TrackingStepState;
}

interface SequenceStep {
  key: string;
  status: OrderStatus;
  label: string;
}

/** The delivery and pickup paths from the Phase 5 lifecycle graph. */
export function trackingSequence(method: OrderConfirmationView["fulfillment"]["method"]): SequenceStep[] {
  return [
    { key: "placed", status: "placed", label: "Order received" },
    { key: "confirmed", status: "confirmed", label: "Confirmed" },
    { key: "preparing", status: "preparing", label: "Preparing" },
    method === "delivery"
      ? { key: "handover", status: "out_for_delivery", label: "Out for delivery" }
      : { key: "handover", status: "ready_for_pickup", label: "Ready for pickup" },
    { key: "completed", status: "completed", label: "Completed" },
  ];
}

/**
 * Build the timeline for an order.
 *
 * A cancelled order never shows Completed as reached. Steps the order actually
 * passed through stay complete; the rest are upcoming behind a cancelled
 * notice rendered by the caller.
 */
export function buildTrackingTimeline(
  order: Pick<OrderConfirmationView, "status" | "fulfillment" | "statusHistory" | "placedAtIso">,
): TrackingStep[] {
  const sequence = trackingSequence(order.fulfillment.method);
  const cancelled = order.status === "cancelled";
  const completed = order.status === "completed";
  const reached = new Set(order.statusHistory.map((event) => event.to));

  const currentIndex = cancelled || completed ? -1 : sequence.findIndex((step) => step.status === order.status);
  const reachedIndex = cancelled
    ? sequence.reduce((highest, step, index) => (reached.has(step.status) ? index : highest), -1)
    : currentIndex;

  return sequence.map((step, index) => {
    const event = order.statusHistory.find((entry) => entry.to === step.status);
    const atIso = event?.atIso ?? (step.status === "placed" ? order.placedAtIso : null);

    let state: TrackingStepState;
    if (completed) {
      // A finished order has no "current" step and no "Now" badge.
      state = "complete";
    } else if (cancelled) {
      state = index <= reachedIndex ? "complete" : "upcoming";
    } else if (index < currentIndex) {
      state = "complete";
    } else if (index === currentIndex) {
      state = "current";
    } else {
      state = "upcoming";
    }

    return { key: step.key, label: step.label, atIso, state };
  });
}

export type TrackingPaymentTone = "neutral" | "success" | "warning";

export interface TrackingPaymentSummary {
  label: string;
  detail: string;
  tone: TrackingPaymentTone;
}

/**
 * Accurate customer payment copy, without provider jargon.
 *
 * Cash on Arrival is never called paid before the owner records collection.
 * An online payment is only "confirmed" after the verified pipeline wrote
 * `paid`. A cancelled order never implies a refund happened.
 */
export function trackingPaymentSummary(
  order: Pick<OrderConfirmationView, "payment" | "status" | "money">,
): TrackingPaymentSummary {
  const cancelled = order.status === "cancelled";
  const status = order.payment.status;

  if (order.payment.method === "cash_on_arrival") {
    if (status === "paid") {
      return { label: "Cash on arrival", detail: "Payment received. Thank you.", tone: "success" };
    }
    return {
      label: "Cash on arrival",
      detail: cancelled
        ? "No cash payment was recorded for this cancelled order."
        : "Payment is due when the order is delivered or collected.",
      tone: "neutral",
    };
  }

  switch (status) {
    case "paid":
      return { label: "Paid online", detail: "Payment has been confirmed.", tone: "success" };
    case "partially_refunded":
    case "refunded":
      return {
        label: "Refund confirmed",
        detail: "The payment provider confirmed a refund for this order.",
        tone: "success",
      };
    case "failed":
    case "expired":
      return {
        label: "Payment not completed",
        detail: "The online payment was not completed.",
        tone: "warning",
      };
    case "review_required":
      return {
        label: "Payment under review",
        detail: "No action is needed from you right now.",
        tone: "warning",
      };
    case "awaiting_payment":
    case "processing":
      return {
        label: "Payment pending",
        detail: "Payment is pending verification.",
        tone: "neutral",
      };
    default:
      return {
        label: "Payment not started",
        detail: cancelled
          ? "No online payment was confirmed for this cancelled order."
          : "Payment has not been started.",
        tone: "neutral",
      };
  }
}

/** True when no further automatic refresh can change the order. */
export function isTerminalTrackingStatus(status: OrderStatus): boolean {
  return status === "completed" || status === "cancelled";
}
