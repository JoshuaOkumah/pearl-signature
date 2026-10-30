import { buildOrderEmail, type BuiltEmail } from "./email/order-email";
import type { NotificationOrderFacts } from "./facts";
import type { NotificationEvent, NotificationRecipientRole } from "./events";

/**
 * Notification templates (Phase 5 facade, Phase 7 implementation).
 *
 * The vocabulary and idempotency helpers live in `events.ts`; the order facts
 * live in `facts.ts`; the branded HTML/text builders live under `email/`. This
 * module stays as the stable import point used by the dispatcher, the outbox
 * model and the tests, so the Phase 5 seam did not have to move.
 *
 * The builder is pure and isomorphic: no mongoose, no environment. Money always
 * goes through `formatCad`, and every dynamic value is escaped before it reaches
 * HTML.
 */

export {
  NOTIFICATION_EVENTS,
  NOTIFICATION_EVENT_ROLES,
  NOTIFICATION_RECIPIENT_ROLES,
  eventForStatus,
  isOptionalStatusEvent,
  notificationKey,
  type NotificationEvent,
  type NotificationRecipientRole,
} from "./events";

export type {
  NotificationMoney,
  NotificationOrderFacts,
  NotificationOrderItem,
} from "./facts";

export type NotificationMessage = BuiltEmail;

/**
 * Build the subject, HTML and plain-text body for one event + recipient.
 *
 * Copy rule: factual, present tense, no em dashes, no promised timeframes, no
 * invented business details.
 */
export function buildNotification(
  event: NotificationEvent,
  role: NotificationRecipientRole,
  order: NotificationOrderFacts,
): NotificationMessage {
  return buildOrderEmail(event, role, order);
}
