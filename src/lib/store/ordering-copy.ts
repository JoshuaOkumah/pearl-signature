import type { CheckoutSettings } from "@/lib/validations/store-config";

/**
 * Customer-facing wording for the parts of the storefront that depend on the
 * owner's live configuration: order intake, fulfilment methods and online
 * payment.
 *
 * The marketing copy used to hardcode a single state ("Ordering opens soon",
 * "Delivery or arranged pickup"). That becomes untrue the moment the owner
 * opens intake, turns delivery off, or enables card payment, and the storefront
 * then promises a service the business has not configured. Everything below is
 * derived from the sanitised `CheckoutSettings` projection instead, so the copy
 * follows the configuration rather than drifting from it.
 *
 * Pure by design — no database, no environment, no React. The server wrapper
 * (`getPublicOrderingCopy`) adds the Stripe gate and the request-time read.
 */
export interface OrderingCopy {
  /** True when a customer can complete an order right now. */
  canOrder: boolean;
  /** Short status for the menu header badge. */
  statusBadge: string;
  /** Fulfilment fact for the hero strip. */
  fulfilmentFact: string;
  /** Payment fact for the hero strip. */
  paymentFact: string;
  /** Third step of "How ordering works". */
  fulfilmentStepTitle: string;
  fulfilmentStepBody: string;
  /** Fourth step of "How ordering works". */
  paymentStepTitle: string;
  paymentStepBody: string;
  /** Highlighted note under the ordering steps. */
  paymentNoteTitle: string;
  paymentNoteBody: string;
  /** FAQ answers that would otherwise encode a stale business state. */
  faqDelivery: string;
  faqPayment: string;
  faqOpening: string;
}

/**
 * What to show when the store configuration cannot be read (no database, or a
 * request that failed). Every line is true in every configuration: it describes
 * where the answer lives rather than guessing it.
 */
export const UNKNOWN_ORDERING_COPY: OrderingCopy = Object.freeze({
  canOrder: false,
  statusBadge: "Browse the full menu",
  fulfilmentFact: "Fulfilment details at checkout",
  paymentFact: "Payment details at checkout",
  fulfilmentStepTitle: "Fulfilment",
  fulfilmentStepBody: "Delivery and pickup details are confirmed at checkout.",
  paymentStepTitle: "Complete your order",
  paymentStepBody: "Payment details are confirmed at checkout.",
  paymentNoteTitle: "Payment details.",
  paymentNoteBody: "The available payment methods are confirmed at checkout.",
  faqDelivery: "Delivery and pickup details are confirmed at checkout.",
  faqPayment: "The available payment methods are confirmed at checkout.",
  faqOpening: "You can browse the full menu today. Ordering details are confirmed at checkout.",
});

export function orderingCopy(settings: CheckoutSettings): OrderingCopy {
  if (!settings.available) return UNKNOWN_ORDERING_COPY;

  const { deliveryEnabled, pickupEnabled } = settings;
  const onlinePayment = settings.onlinePaymentsAvailable;

  // Mirrors the checkout blockers: intake must be on, at least one fulfilment
  // method must exist, and tax must be configured. Anything less cannot
  // complete an order, so the storefront must not claim that it can.
  const canOrder =
    settings.intakeEnabled &&
    (deliveryEnabled || pickupEnabled) &&
    settings.tax.mode !== "unconfigured";

  const fulfilmentFact =
    deliveryEnabled && pickupEnabled
      ? "Delivery or arranged pickup"
      : pickupEnabled
        ? "Arranged pickup"
        : deliveryEnabled
          ? "Home delivery"
          : "Fulfilment details at checkout";

  const fulfilmentStepTitle =
    deliveryEnabled && pickupEnabled
      ? "Delivery or pickup"
      : pickupEnabled
        ? "Prearranged pickup"
        : deliveryEnabled
          ? "Home delivery"
          : "Fulfilment";

  const fulfilmentStepBody =
    deliveryEnabled && pickupEnabled
      ? "Have your order brought to your door, or prearrange a convenient pickup."
      : pickupEnabled
        ? "Prearrange a convenient pickup; the exact arrangement is confirmed at checkout."
        : deliveryEnabled
          ? "Have your order delivered to an address we serve."
          : "Delivery and pickup details are confirmed at checkout.";

  const faqDelivery =
    deliveryEnabled && pickupEnabled
      ? "We offer home delivery and prearranged pickup. Delivery areas, fees and schedules, and the pickup arrangement, are confirmed at checkout."
      : pickupEnabled
        ? "We offer prearranged pickup. Delivery is not available at the moment. The pickup arrangement is confirmed at checkout."
        : deliveryEnabled
          ? "We offer home delivery to the areas we serve. Delivery areas and fees are confirmed at checkout."
          : "Fulfilment details are being finalised. Please check back before ordering.";

  return {
    canOrder,
    statusBadge: canOrder ? "Ordering now open" : "Ordering opens soon",
    fulfilmentFact,
    paymentFact: onlinePayment ? "Online or cash payment" : "Cash on arrival",
    fulfilmentStepTitle,
    fulfilmentStepBody,
    paymentStepTitle: "Complete your order",
    paymentStepBody: onlinePayment
      ? "Pay securely online, or choose cash on arrival, whichever suits you."
      : "Place your order and pay cash when it arrives.",
    paymentNoteTitle: onlinePayment ? "Payment, your way." : "Cash on arrival.",
    paymentNoteBody: onlinePayment
      ? "Pay securely online, or choose cash on arrival."
      : "Place your order now and pay cash when it arrives. Online card payment is not available at the moment.",
    faqDelivery,
    faqPayment: onlinePayment
      ? "We accept secure online payment and cash on arrival, whichever suits you."
      : "We accept cash on arrival. Online card payment is not available at the moment.",
    faqOpening: canOrder
      ? "Online ordering is open. Browse the menu and place your order at checkout."
      : "Online ordering is not open right now. You can browse the full menu today; ordering opens once fulfilment and payment details are finalised.",
  };
}
