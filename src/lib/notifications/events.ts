import type { OrderStatus } from "@/lib/validations/order";

/**
 * Notification event vocabulary (Phase 5, extended in Phase 7).
 *
 * Each meaningful business transition has its own stable event name, so the
 * outbox key (`event:reference:role`) can express "this transition notified
 * once" without a second discriminator. `order.status_changed` remains for
 * entries written before Phase 7 and for the generic fallback; new transitions
 * always use the specific names below.
 */

export const NOTIFICATION_EVENTS = [
  "order.placed",
  "order.status_changed",
  "order.confirmed",
  "order.preparing",
  "order.ready_for_pickup",
  "order.out_for_delivery",
  "order.completed",
  "order.cancelled",
  "payment.confirmed",
  "payment.collected",
  "payment.failed",
  "payment.requires_attention",
  "payment.refund_review",
] as const;

export type NotificationEvent = (typeof NOTIFICATION_EVENTS)[number];

/** Who a message is written for. One order can notify both roles. */
export const NOTIFICATION_RECIPIENT_ROLES = ["customer", "admin"] as const;
export type NotificationRecipientRole = (typeof NOTIFICATION_RECIPIENT_ROLES)[number];

/**
 * Which recipients each event enqueues. `order.placed` tells the customer their
 * order landed AND tells the store; status and payment events only inform the
 * customer (the operator already knows what they just did). Payment review
 * events are operator alerts.
 */
export const NOTIFICATION_EVENT_ROLES: Record<NotificationEvent, readonly NotificationRecipientRole[]> = {
  "order.placed": ["customer", "admin"],
  "order.status_changed": ["customer"],
  "order.confirmed": ["customer"],
  "order.preparing": ["customer"],
  "order.ready_for_pickup": ["customer"],
  "order.out_for_delivery": ["customer"],
  "order.completed": ["customer"],
  "order.cancelled": ["customer"],
  "payment.confirmed": ["customer"],
  "payment.collected": ["customer"],
  "payment.failed": ["customer"],
  "payment.requires_attention": ["admin"],
  "payment.refund_review": ["admin"],
};

/**
 * Stable outbox key: one delivery per event, order and recipient role, no
 * matter how many times enqueueing runs.
 */
export function notificationKey(
  event: NotificationEvent,
  reference: string,
  role: NotificationRecipientRole,
): string {
  return `${event}:${reference}:${role}`;
}

/**
 * The event that describes a lifecycle transition. `placed` is never a
 * transition target (it is the creation event), so it maps to the legacy
 * generic event if it ever reaches here.
 */
export function eventForStatus(status: OrderStatus): NotificationEvent {
  switch (status) {
    case "confirmed":
      return "order.confirmed";
    case "preparing":
      return "order.preparing";
    case "ready_for_pickup":
      return "order.ready_for_pickup";
    case "out_for_delivery":
      return "order.out_for_delivery";
    case "completed":
      return "order.completed";
    case "cancelled":
      return "order.cancelled";
    case "placed":
      return "order.placed";
  }
}

/** Statuses whose notifications are purely informational and may be muted. */
export function isOptionalStatusEvent(event: NotificationEvent): boolean {
  return event === "order.preparing";
}
