import { describe, expect, it } from "vitest";
import {
  ORDER_STATUS_LABELS,
  ORDER_TRANSITIONS,
  PAYMENT_STATUS_LABELS,
  availableTransitions,
  canTransition,
  isCancellable,
  isTerminalStatus,
  transitionRejection,
} from "./lifecycle";
import { ORDER_STATUSES, PAYMENT_STATUSES, type OrderStatus } from "@/lib/validations/order";
import type { FulfillmentMethod } from "@/lib/validations/checkout";

/**
 * Order lifecycle matrix (Phase 5, Milestones C/D).
 *
 * The rules in this module are executed by BOTH the admin UI (to offer
 * buttons) and the Server Action (to authorize the write), so the tests
 * below pin down three properties:
 *
 *  1. The forward path exists end to end for each fulfilment method.
 *  2. No state can be skipped, no terminal state reopened, and no
 *     cross-method state reached (pickup is never "out for delivery" and
 *     delivery is never "ready for pickup").
 *  3. Cancellation is allowed exactly where the order has not yet left
 *     the store.
 */

const METHODS: FulfillmentMethod[] = ["pickup", "delivery"];

describe("labels", () => {
  it("labels every lifecycle and payment state", () => {
    for (const status of ORDER_STATUSES) {
      expect(ORDER_STATUS_LABELS[status]).toBeTruthy();
    }
    for (const status of PAYMENT_STATUSES) {
      expect(PAYMENT_STATUS_LABELS[status]).toBeTruthy();
    }
    // Every label is human copy, never the raw enum value.
    expect(ORDER_STATUS_LABELS.ready_for_pickup).toBe("Ready for pickup");
    expect(ORDER_STATUS_LABELS.out_for_delivery).toBe("Out for delivery");
    expect(PAYMENT_STATUS_LABELS.unpaid).toBe("Unpaid");
  });

  it("keeps every transition target a real status", () => {
    for (const from of ORDER_STATUSES) {
      for (const to of ORDER_TRANSITIONS[from]) {
        expect(ORDER_STATUSES).toContain(to);
      }
    }
  });
});

describe("the forward path", () => {
  it("walks a delivery order placed to completed", () => {
    const path: OrderStatus[] = ["confirmed", "preparing", "out_for_delivery", "completed"];
    let current: OrderStatus = "placed";
    for (const next of path) {
      expect(canTransition(current, next, "delivery")).toBe(true);
      current = next;
    }
    expect(current).toBe("completed");
    expect(isTerminalStatus(current)).toBe(true);
  });

  it("walks a pickup order placed to completed without ever leaving for delivery", () => {
    const path: OrderStatus[] = ["confirmed", "preparing", "ready_for_pickup", "completed"];
    let current: OrderStatus = "placed";
    for (const next of path) {
      expect(canTransition(current, next, "pickup")).toBe(true);
      current = next;
    }
    expect(current).toBe("completed");
  });

  it("allows confirmation and cancellation straight from placed", () => {
    for (const method of METHODS) {
      expect(canTransition("placed", "confirmed", method)).toBe(true);
      expect(canTransition("placed", "cancelled", method)).toBe(true);
    }
  });
});

describe("no skipped steps", () => {
  const illegal: Array<[OrderStatus, OrderStatus]> = [
    ["placed", "preparing"],
    ["placed", "ready_for_pickup"],
    ["placed", "out_for_delivery"],
    ["placed", "completed"],
    ["confirmed", "placed"],
    ["confirmed", "ready_for_pickup"],
    ["confirmed", "completed"],
    ["preparing", "completed"],
    ["ready_for_pickup", "preparing"],
    ["ready_for_pickup", "out_for_delivery"],
    ["out_for_delivery", "confirmed"],
  ];

  it("rejects every move that skips a step, for both methods", () => {
    for (const [from, to] of illegal) {
      for (const method of METHODS) {
        expect(canTransition(from, to, method)).toBe(false);
      }
    }
  });

  it("never treats staying put as a transition", () => {
    for (const status of ORDER_STATUSES) {
      for (const method of METHODS) {
        expect(canTransition(status, status, method)).toBe(false);
      }
    }
    expect(transitionRejection("placed", "placed", "delivery")).toBe(
      "The order is already in that state.",
    );
  });
});

describe("method awareness", () => {
  it("offers ready_for_pickup only to pickup orders", () => {
    expect(canTransition("preparing", "ready_for_pickup", "pickup")).toBe(true);
    expect(canTransition("preparing", "ready_for_pickup", "delivery")).toBe(false);
    expect(transitionRejection("preparing", "ready_for_pickup", "delivery")).toBe(
      "Only pickup orders can be marked ready for pickup.",
    );
  });

  it("offers out_for_delivery only to delivery orders", () => {
    expect(canTransition("preparing", "out_for_delivery", "delivery")).toBe(true);
    expect(canTransition("preparing", "out_for_delivery", "pickup")).toBe(false);
    expect(transitionRejection("preparing", "out_for_delivery", "pickup")).toBe(
      "Only delivery orders can be marked out for delivery.",
    );
  });

  it("never lets a pickup order reach out_for_delivery, or a delivery order ready_for_pickup", () => {
    for (const from of ORDER_STATUSES) {
      expect(canTransition(from, "out_for_delivery", "pickup")).toBe(false);
      expect(canTransition(from, "ready_for_pickup", "delivery")).toBe(false);
    }
  });
});

describe("terminal states", () => {
  it("closes completed and cancelled to every further move", () => {
    for (const terminal of ["completed", "cancelled"] as const) {
      expect(isTerminalStatus(terminal)).toBe(true);
      for (const to of ORDER_STATUSES) {
        for (const method of METHODS) {
          expect(canTransition(terminal, to, method)).toBe(false);
          expect(availableTransitions(terminal, method)).toHaveLength(0);
        }
      }
      expect(isCancellable(terminal)).toBe(false);
    }
  });

  it("explains that a finished order cannot change again", () => {
    expect(transitionRejection("completed", "confirmed", "delivery")).toBe(
      "This order is already completed. Its status cannot change again.",
    );
    expect(transitionRejection("cancelled", "preparing", "pickup")).toBe(
      "This order is already cancelled. Its status cannot change again.",
    );
  });

  it("marks every non-terminal state as open", () => {
    for (const status of ORDER_STATUSES) {
      if (status === "completed" || status === "cancelled") continue;
      expect(isTerminalStatus(status)).toBe(false);
    }
  });
});

describe("cancellation rules", () => {
  it("allows cancellation only while the order has not left the store", () => {
    expect(isCancellable("placed")).toBe(true);
    expect(isCancellable("confirmed")).toBe(true);
    expect(isCancellable("preparing")).toBe(true);
    expect(isCancellable("ready_for_pickup")).toBe(true);
    // It has physically left: "cancelled" would misdescribe what happened.
    expect(isCancellable("out_for_delivery")).toBe(false);
    expect(isCancellable("completed")).toBe(false);
    expect(isCancellable("cancelled")).toBe(false);
  });

  it("rejects cancelling an order that is out for delivery", () => {
    expect(canTransition("out_for_delivery", "cancelled", "delivery")).toBe(false);
    expect(transitionRejection("out_for_delivery", "cancelled", "delivery")).toBe(
      "An order cannot go from Out for delivery to Cancelled.",
    );
  });
});

describe("availableTransitions", () => {
  it("agrees exactly with canTransition for every state, target and method", () => {
    for (const from of ORDER_STATUSES) {
      for (const method of METHODS) {
        const offered = availableTransitions(from, method);
        const expected = ORDER_STATUSES.filter((to) => canTransition(from, to, method));
        expect(offered).toEqual(expected);
        // Never offers a transition that would be rejected on submit.
        for (const to of offered) {
          expect(canTransition(from, to, method)).toBe(true);
          expect(transitionRejection(from, to, method)).toBeNull();
        }
      }
    }
  });

  it("differs by method exactly where the lifecycle differs", () => {
    expect(availableTransitions("preparing", "pickup")).toEqual(["ready_for_pickup", "cancelled"]);
    expect(availableTransitions("preparing", "delivery")).toEqual(["out_for_delivery", "cancelled"]);
    expect(availableTransitions("placed", "delivery")).toEqual(["confirmed", "cancelled"]);
    expect(availableTransitions("ready_for_pickup", "pickup")).toEqual(["completed", "cancelled"]);
    expect(availableTransitions("out_for_delivery", "delivery")).toEqual(["completed"]);
  });
});
