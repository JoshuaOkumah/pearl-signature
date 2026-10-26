import { formatCad } from "@/lib/format";
import { ORDER_STATUS_LABELS } from "@/lib/orders/lifecycle";
import type { FulfillmentMethod } from "@/lib/validations/checkout";
import type { OrderStatus, PaymentMethod, PaymentStatus } from "@/lib/validations/order";

/**
 * Notification events and message copy (Phase 5, Milestone E).
 *
 * Pure and isomorphic: it imports no mongoose model and no environment, so
 * the same builder that runs inside the dispatch pipeline is imported
 * directly by tests (and could later be previewed in an admin UI).
 *
 * ## What a message may state
 *
 * Only facts taken from the stored order: its reference, its current
 * status, its fulfilment method, its total and the customer's name. There
 * are no promises in this copy — no delivery windows, no marketing claims,
 * no contact details the business has not configured. Money always goes
 * through `formatCad`, so an integer cent value can never be rendered as
 * anything but CAD.
 *
 * ## Why there are no links
 *
 * The guest confirmation page needs a secret capability that only the
 * placing browser holds (the server stores `confirmationKeyHash`, never the
 * key), so a notification cannot honestly build that URL. Messages carry
 * facts only.
 */

/** Events that ever enter the outbox, in the order they can occur. */
export const NOTIFICATION_EVENTS = [
  "order.placed",
  "order.status_changed",
  "payment.confirmed",
  "payment.failed",
  "payment.requires_attention",
  "payment.refund_review",
] as const;
export type NotificationEvent = (typeof NOTIFICATION_EVENTS)[number];

/** Who a message is written for. One order can notify both roles. */
export const NOTIFICATION_RECIPIENT_ROLES = ["customer", "admin"] as const;
export type NotificationRecipientRole = (typeof NOTIFICATION_RECIPIENT_ROLES)[number];

/**
 * Which recipients each event enqueues. `order.placed` tells the customer
 * their order landed AND tells the store about it; `order.status_changed`
 * only informs the customer (the operator made the change themselves).
 */
export const NOTIFICATION_EVENT_ROLES: Record<NotificationEvent, readonly NotificationRecipientRole[]> = {
  "order.placed": ["customer", "admin"],
  "order.status_changed": ["customer"],
  "payment.confirmed": ["customer"],
  "payment.failed": ["customer"],
  "payment.requires_attention": ["admin"],
  "payment.refund_review": ["admin"],
};

/**
 * Idempotency key for an outbox entry: one delivery per event, order and
 * recipient role, no matter how many times enqueueing runs.
 */
export function notificationKey(
  event: NotificationEvent,
  reference: string,
  role: NotificationRecipientRole,
): string {
  return `${event}:${reference}:${role}`;
}

/**
 * The order facts a message may state — a deliberately narrow snapshot, so
 * a template can never wander into fields that do not belong in a
 * notification (addresses, phone numbers, capability hashes, …).
 */
export interface NotificationOrderFacts {
  reference: string;
  status: OrderStatus;
  method: FulfillmentMethod;
  totalCents: number;
  customerName: string;
  paymentMethod?: PaymentMethod;
  paymentStatus?: PaymentStatus;
}

export interface NotificationMessage {
  subject: string;
  text: string;
}

function methodLabel(method: FulfillmentMethod): string {
  return method === "delivery" ? "Delivery" : "Pickup";
}

function totalLabel(totalCents: number): string {
  return formatCad(totalCents) ?? "Amount unavailable";
}

/**
 * Build the subject and plain-text body for one event + recipient.
 *
 * Copy rule: factual, present tense, no em dashes, no promised timeframes.
 */
export function buildNotification(
  event: NotificationEvent,
  role: NotificationRecipientRole,
  order: NotificationOrderFacts,
): NotificationMessage {
  const status = ORDER_STATUS_LABELS[order.status];
  const total = totalLabel(order.totalCents);
  const fulfilment = methodLabel(order.method);

  if (event === "order.placed") {
    if (role === "customer") {
      return {
        subject: `Order ${order.reference} received`,
        text: [
          `Hello ${order.customerName},`,
          "",
          `We have received your order ${order.reference}.`,
          "",
          `Total: ${total}`,
          `Fulfilment: ${fulfilment}`,
          `Status: ${status}`,
        ].join("\n"),
      };
    }
    return {
      subject: `New order ${order.reference}`,
      text: [
        "A new order has been placed.",
        "",
        `Order: ${order.reference}`,
        `Customer: ${order.customerName}`,
        `Total: ${total}`,
        `Fulfilment: ${fulfilment}`,
        `Status: ${status}`,
      ].join("\n"),
    };
  }

  if (event === "payment.confirmed") {
    return {
      subject: `Payment received for order ${order.reference}`,
      text: [`Hello ${order.customerName},`, "", `Payment for order ${order.reference} has been confirmed.`, `Total: ${total}`].join("\n"),
    };
  }

  if (event === "payment.failed") {
    return {
      subject: `Payment not completed for order ${order.reference}`,
      text: [`Hello ${order.customerName},`, "", `Payment for order ${order.reference} was not completed. You can return to your order to try again.`, `Total: ${total}`].join("\n"),
    };
  }

  if (event === "payment.refund_review") {
    return {
      subject: `Payment review required for order ${order.reference}`,
      text: [`Order ${order.reference} was cancelled after an online payment was confirmed.`, "", "Review the Stripe payment and determine the appropriate refund action. No refund was initiated automatically."].join("\n"),
    };
  }

  if (event === "payment.requires_attention") {
    return {
      subject: `Payment needs review for order ${order.reference}`,
      text: [`The payment provider reported a payment that needs review for order ${order.reference}.`, "", "Verify the payment in Stripe before taking any financial action."].join("\n"),
    };
  }

  if (role === "customer") {
    return {
      subject: `Order ${order.reference} is now ${status.toLowerCase()}`,
      text: [
        `Hello ${order.customerName},`,
        "",
        `The status of your order ${order.reference} has been updated.`,
        "",
        `Status: ${status}`,
        `Total: ${total}`,
        `Fulfilment: ${fulfilment}`,
      ].join("\n"),
    };
  }
  return {
    subject: `Order ${order.reference} status update`,
    text: [
      `Order ${order.reference} changed status.`,
      "",
      `Status: ${status}`,
      `Customer: ${order.customerName}`,
      `Total: ${total}`,
    ].join("\n"),
  };
}
