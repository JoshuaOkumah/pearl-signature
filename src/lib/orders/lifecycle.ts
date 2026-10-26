import type { FulfillmentMethod } from "@/lib/validations/checkout";
import type { OrderStatus } from "@/lib/validations/order";

/**
 * Order lifecycle rules (Phase 5, Milestones C/D) — pure and isomorphic.
 *
 * The SAME rules run in two places:
 *
 *  1. In the admin UI, to decide which transition buttons to offer for the
 *     order on screen (so the operator is never shown a move that would be
 *     rejected).
 *  2. Inside the Server Action, where the decision is RE-MADE against the
 *     freshly loaded order. The UI list is a convenience; this module
 *     executed server-side is the authority.
 *
 * ## The shape of the lifecycle
 *
 * ```
 * placed ─▶ confirmed ─▶ preparing ─┬─▶ ready_for_pickup ─▶ completed
 *    │           │          │       └─▶ out_for_delivery  ─▶ completed
 *    └───────────┴──────────┴─▶ cancelled   (not from out_for_delivery)
 * ```
 *
 * Two properties are enforced here and nowhere re-implemented:
 *
 *  - **Method awareness.** A pickup order can never be "Out for delivery"
 *    and a delivery order can never be "Ready for pickup". Without this a
 *    generic transition map would happily offer both to every order.
 *  - **Terminal states.** `completed` and `cancelled` have no outgoing
 *    edges: history is never rewritten after an order is finished.
 *
 * Cancellation is allowed up to and including `ready_for_pickup`, but NOT
 * from `out_for_delivery`: the order has physically left the store, so a
 * "cancelled" state would misdescribe what happened.
 */

/** Every allowed edge of the lifecycle, before method filtering. */
export const ORDER_TRANSITIONS: Record<OrderStatus, readonly OrderStatus[]> = {
  placed: ["confirmed", "cancelled"],
  confirmed: ["preparing", "cancelled"],
  preparing: ["ready_for_pickup", "out_for_delivery", "cancelled"],
  ready_for_pickup: ["completed", "cancelled"],
  out_for_delivery: ["completed"],
  completed: [],
  cancelled: [],
};

/** Operator-facing labels — the single spelling used across the admin UI. */
export const ORDER_STATUS_LABELS: Record<OrderStatus, string> = {
  placed: "Placed",
  confirmed: "Confirmed",
  preparing: "Preparing",
  ready_for_pickup: "Ready for pickup",
  out_for_delivery: "Out for delivery",
  completed: "Completed",
  cancelled: "Cancelled",
};

export const PAYMENT_STATUS_LABELS: Record<"unpaid" | "paid", string> = {
  unpaid: "Unpaid",
  paid: "Paid",
};

/** A terminal state accepts no further transitions. */
export function isTerminalStatus(status: OrderStatus): boolean {
  return ORDER_TRANSITIONS[status].length === 0;
}

/** Whether the order may still be cancelled from its current state. */
export function isCancellable(status: OrderStatus): boolean {
  return ORDER_TRANSITIONS[status].includes("cancelled");
}

/**
 * Is `from → to` a legal move for an order fulfilled by `method`?
 *
 * Both checks must pass: the edge exists in the graph AND it makes sense
 * for this fulfilment method. `from === to` is never a transition.
 */
export function canTransition(from: OrderStatus, to: OrderStatus, method: FulfillmentMethod): boolean {
  if (from === to) return false;
  if (!ORDER_TRANSITIONS[from].includes(to)) return false;
  if (to === "ready_for_pickup" && method !== "pickup") return false;
  if (to === "out_for_delivery" && method !== "delivery") return false;
  return true;
}

/**
 * The transitions to offer for THIS order: legal edges from its current
 * state, filtered by its fulfilment method.
 */
export function availableTransitions(status: OrderStatus, method: FulfillmentMethod): OrderStatus[] {
  return ORDER_TRANSITIONS[status].filter((to) => canTransition(status, to, method));
}

/**
 * Why a transition was refused, for an operator-facing message. Returns
 * `null` when the move IS allowed. The distinction matters: "you skipped a
 * step" and "that state does not apply to a pickup order" are different
 * mistakes with different fixes.
 */
export function transitionRejection(
  from: OrderStatus,
  to: OrderStatus,
  method: FulfillmentMethod,
): string | null {
  if (canTransition(from, to, method)) return null;
  if (from === to) return "The order is already in that state.";
  if (!ORDER_TRANSITIONS[from].includes(to)) {
    if (isTerminalStatus(from)) {
      return `This order is already ${ORDER_STATUS_LABELS[from].toLowerCase()}. Its status cannot change again.`;
    }
    return `An order cannot go from ${ORDER_STATUS_LABELS[from]} to ${ORDER_STATUS_LABELS[to]}.`;
  }
  // The edge exists but does not apply to this fulfilment method.
  if (to === "ready_for_pickup") {
    return "Only pickup orders can be marked ready for pickup.";
  }
  return "Only delivery orders can be marked out for delivery.";
}
