// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  buildTrackingTimeline,
  isTerminalTrackingStatus,
  trackingPaymentSummary,
  trackingSequence,
} from "./tracking";
import type { OrderConfirmationView, OrderStatus, PaymentStatus } from "@/lib/validations/order";

/**
 * Tracking presentation rules (Phase 7).
 *
 * These are pure functions, so the whole matrix is cheap to cover. The rules
 * that matter:
 *
 *  - the delivery path shows "Out for delivery", the pickup path shows
 *    "Ready for pickup", never both,
 *  - a cancelled order is never shown as completed,
 *  - a refund that has not been confirmed is never described as returned,
 *  - Cash on Arrival is never called paid before collection is recorded.
 */

const PLACED_AT = "2026-10-01T12:00:00.000Z";

type View = Pick<OrderConfirmationView, "status" | "fulfillment" | "statusHistory" | "placedAtIso">;

function view(
  status: OrderStatus,
  history: OrderStatus[],
  method: "delivery" | "pickup" = "delivery",
): View {
  return {
    status,
    placedAtIso: PLACED_AT,
    fulfillment: {
      method,
      serviceAreaLabel: method === "delivery" ? "Test metro" : null,
      pickupInstructions: method === "pickup" ? "Synthetic counter note." : null,
    },
    statusHistory: history.map((to, index) => ({
      from: index === 0 ? null : history[index - 1],
      to,
      atIso: new Date(Date.parse(PLACED_AT) + index * 60_000).toISOString(),
    })),
  };
}

describe("trackingSequence", () => {
  it("uses the delivery handover step for delivery orders", () => {
    expect(trackingSequence("delivery").map((step) => step.label)).toEqual([
      "Order received",
      "Confirmed",
      "Preparing",
      "Out for delivery",
      "Completed",
    ]);
  });

  it("uses the pickup handover step for pickup orders", () => {
    const labels = trackingSequence("pickup").map((step) => step.label);
    expect(labels).toContain("Ready for pickup");
    expect(labels).not.toContain("Out for delivery");
  });
});

describe("buildTrackingTimeline", () => {
  it("marks earlier steps complete and the current step current", () => {
    const timeline = buildTrackingTimeline(view("preparing", ["placed", "confirmed", "preparing"]));

    expect(timeline.map((step) => step.state)).toEqual([
      "complete",
      "complete",
      "current",
      "upcoming",
      "upcoming",
    ]);
    expect(timeline[0].atIso).toBe(PLACED_AT);
    expect(timeline[3].atIso).toBeNull();
  });

  it("starts at the first step for a newly placed order", () => {
    const timeline = buildTrackingTimeline(view("placed", ["placed"]));
    expect(timeline[0].state).toBe("current");
    expect(timeline.slice(1).every((step) => step.state === "upcoming")).toBe(true);
  });

  it("marks every step complete for a completed order", () => {
    const timeline = buildTrackingTimeline(
      view("completed", ["placed", "confirmed", "preparing", "out_for_delivery", "completed"]),
    );
    expect(timeline.every((step) => step.state === "complete")).toBe(true);
  });

  it("never shows a cancelled order as completed", () => {
    const timeline = buildTrackingTimeline(view("cancelled", ["placed", "confirmed", "cancelled"]));

    const completed = timeline.find((step) => step.key === "completed");
    expect(completed?.state).toBe("upcoming");
    expect(timeline.every((step) => step.state !== "current")).toBe(true);
    expect(timeline.find((step) => step.key === "confirmed")?.state).toBe("complete");
    expect(timeline.find((step) => step.key === "preparing")?.state).toBe("upcoming");
  });

  it("keeps a cancelled pickup order on the pickup path", () => {
    const timeline = buildTrackingTimeline(view("cancelled", ["placed", "cancelled"], "pickup"));
    expect(timeline.map((step) => step.label)).toContain("Ready for pickup");
    expect(timeline.map((step) => step.label)).not.toContain("Out for delivery");
  });
});

describe("isTerminalTrackingStatus", () => {
  it("treats only completed and cancelled as terminal", () => {
    expect(isTerminalTrackingStatus("completed")).toBe(true);
    expect(isTerminalTrackingStatus("cancelled")).toBe(true);
    for (const status of ["placed", "confirmed", "preparing", "ready_for_pickup", "out_for_delivery"] as const) {
      expect(isTerminalTrackingStatus(status)).toBe(false);
    }
  });
});

/* ── payment copy ───────────────────────────────────────────────────── */

type PaymentView = Pick<OrderConfirmationView, "payment" | "status" | "money">;

function paymentView(
  status: PaymentStatus,
  options: { method?: "cash_on_arrival" | "stripe"; orderStatus?: OrderStatus } = {},
): PaymentView {
  return {
    status: options.orderStatus ?? "preparing",
    money: {
      currency: "CAD",
      subtotalCents: 3750,
      deliveryFeeCents: 0,
      taxCents: 488,
      totalCents: 4238,
      taxLabel: "Test HST",
    },
    payment: {
      method: options.method ?? "cash_on_arrival",
      status,
      provider: options.method === "stripe" ? "stripe" : "none",
      amountReceivedCents: status === "paid" ? 4238 : 0,
      refundedAmountCents: 0,
      requiresReview: status === "review_required",
      reconciliationStatus: "not_checked",
      lastReconciledAtIso: null,
      paidAtIso: null,
      attempts: [],
      retryAvailable: false,
    },
  };
}

describe("trackingPaymentSummary", () => {
  it("does not call Cash on Arrival paid before collection is recorded", () => {
    const summary = trackingPaymentSummary(paymentView("unpaid"));
    expect(summary.label).toBe("Cash on arrival");
    expect(summary.tone).toBe("neutral");
    expect(summary.detail).toBe("Payment is due when the order is delivered or collected.");
  });

  it("confirms Cash on Arrival only after the owner records collection", () => {
    const summary = trackingPaymentSummary(paymentView("paid"));
    expect(summary.tone).toBe("success");
    expect(summary.detail).toBe("Payment received. Thank you.");
  });

  it("does not imply a cash payment was taken on a cancelled order", () => {
    const summary = trackingPaymentSummary(paymentView("unpaid", { orderStatus: "cancelled" }));
    expect(summary.detail).toBe("No cash payment was recorded for this cancelled order.");
    expect(summary.tone).toBe("neutral");
  });

  it("describes a confirmed online payment as paid", () => {
    const summary = trackingPaymentSummary(paymentView("paid", { method: "stripe" }));
    expect(summary.label).toBe("Paid online");
    expect(summary.tone).toBe("success");
  });

  it("only says refund confirmed when the provider confirmed it", () => {
    for (const status of ["partially_refunded", "refunded"] as const) {
      const summary = trackingPaymentSummary(paymentView(status, { method: "stripe" }));
      expect(summary.label).toBe("Refund confirmed");
      expect(summary.detail).toContain("confirmed a refund");
    }
  });

  it("never describes a pending or failed refund as returned", () => {
    for (const status of ["failed", "expired"] as const) {
      const summary = trackingPaymentSummary(paymentView(status, { method: "stripe" }));
      expect(summary.label).toBe("Payment not completed");
      expect(summary.detail.toLowerCase()).not.toContain("returned");
      expect(summary.detail.toLowerCase()).not.toContain("refund");
    }
  });

  it("reports a review without asking the customer to act", () => {
    const summary = trackingPaymentSummary(paymentView("review_required", { method: "stripe" }));
    expect(summary.label).toBe("Payment under review");
    expect(summary.detail).toBe("No action is needed from you right now.");
  });

  it("reports pending verification for an in-flight online payment", () => {
    for (const status of ["awaiting_payment", "processing"] as const) {
      const summary = trackingPaymentSummary(paymentView(status, { method: "stripe" }));
      expect(summary.label).toBe("Payment pending");
      expect(summary.tone).toBe("neutral");
    }
  });

  it("does not imply a payment was taken on a cancelled unpaid online order", () => {
    const summary = trackingPaymentSummary(paymentView("unpaid", { method: "stripe", orderStatus: "cancelled" }));
    expect(summary.label).toBe("Payment not started");
    expect(summary.detail).toBe("No online payment was confirmed for this cancelled order.");
  });
});
