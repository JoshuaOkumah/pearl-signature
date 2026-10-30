import type { FulfillmentMethod } from "@/lib/validations/checkout";
import type { OrderStatus, PaymentMethod, PaymentStatus } from "@/lib/validations/order";

/**
 * The order facts an email may state (Phase 7).
 *
 * A deliberately narrow snapshot. Templates cannot wander into fields that do
 * not belong in a message: no street address, phone number, capability hash,
 * payment-provider identifier or internal admin note is represented here.
 *
 * The rich fields are optional so older callers and focused tests can build a
 * message from the Phase 5 subset; templates degrade to a shorter message
 * rather than inventing missing detail.
 */

export interface NotificationOrderItem {
  name: string;
  variantName: string | null;
  quantity: number;
  unitPriceCents: number;
  lineTotalCents: number;
}

export interface NotificationMoney {
  currency: "CAD";
  subtotalCents: number;
  deliveryFeeCents: number;
  taxCents: number;
  totalCents: number;
  taxLabel: string | null;
}

export interface NotificationOrderFacts {
  reference: string;
  status: OrderStatus;
  method: FulfillmentMethod;
  totalCents: number;
  customerName: string;
  paymentMethod?: PaymentMethod;
  paymentStatus?: PaymentStatus;
  items?: NotificationOrderItem[];
  money?: NotificationMoney;
  placedAtIso?: string;
  /** Timestamp of the transition this message describes, when known. */
  statusChangedAtIso?: string | null;
  serviceAreaLabel?: string | null;
  pickupInstructions?: string | null;
  /** Canonical origin, used only to build safe links. Never invented. */
  siteUrl?: string | null;
  /** Internal only. Kept out of templates on purpose. */
  cancellationReason?: string | null;
}
