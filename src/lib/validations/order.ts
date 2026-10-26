import { z } from "zod";
import { cartItemsRefine, cartQuoteRequestSchema, type QuoteLineIssue } from "@/lib/validations/cart";
import { checkoutFormSchema, type FulfillmentMethod } from "@/lib/validations/checkout";
import { MAX_ORDER_TOTAL_CENTS, type OrderTotals, type PriceBlocker } from "@/lib/checkout/pricing";

/**
 * Order contract (Phase 5) — isomorphic, so the checkout client can render
 * exactly the shapes the server returns without a second definition
 * drifting out of sync.
 *
 * This module deliberately imports NO mongoose model: it is imported by
 * client components, and pulling mongoose into a browser bundle would be a
 * correctness disaster. The model imports its constants from here instead.
 *
 * ## What the client may send
 *
 * `placeOrderRequestSchema` is the complete allowlist. In order:
 *
 *  - `items` — the same bounded, price-free cart contract the quote service
 *    already accepts. No prices, no product ids, no totals from the cart.
 *  - `customer` — the Phase 4 checkout form, already normalising phone and
 *    postal code server-side.
 *  - `paymentMethod` — a closed enum with ONE member today. There is no
 *    "paid" or "payment succeeded" field in this schema at all, so a
 *    forged payment status is stripped before it can exist.
 *  - `expectedTotalCents` — what the customer reviewed. It is never USED to
 *    price anything; a mismatch with the server's recomputed total is a
 *    price change, rejected for re-review.
 *  - `idempotencyKey` / `confirmationKey` — unpredictable hex capabilities
 *    generated in the browser (see `docs/ORDER_ARCHITECTURE.md`).
 *
 * Everything else (unknown keys) is stripped by Zod.
 */

/* ── lifecycle vocabulary (shared with the model) ───────────────────── */

export const ORDER_STATUSES = [
  "placed",
  "confirmed",
  "preparing",
  "ready_for_pickup",
  "out_for_delivery",
  "completed",
  "cancelled",
] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

export const PAYMENT_METHODS = ["cash_on_arrival", "stripe"] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export const PAYMENT_STATUSES = [
  "unpaid",
  "awaiting_payment",
  "processing",
  "paid",
  "failed",
  "expired",
  "partially_refunded",
  "refunded",
  "review_required",
] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

export const PAYMENT_PROVIDERS = ["none", "stripe"] as const;
export type PaymentProvider = (typeof PAYMENT_PROVIDERS)[number];

export const PAYMENT_STATUS_LABELS: Record<PaymentStatus, string> = {
  unpaid: "Unpaid",
  awaiting_payment: "Awaiting payment",
  processing: "Processing",
  paid: "Paid",
  failed: "Payment failed",
  expired: "Session expired",
  partially_refunded: "Partially refunded",
  refunded: "Refunded",
  review_required: "Review required",
};

/** Public reference, e.g. `PS-1A2B3C4D5E`. */
export const ORDER_REFERENCE_PATTERN = /^PS-[0-9A-F]{10}$/;
/** Client-generated idempotency / confirmation capabilities: 32-64 hex chars. */
export const ORDER_KEY_PATTERN = /^[0-9a-f]{32,64}$/;

/** Operational notes are bounded so a document can never grow without limit. */
export const MAX_ORDER_NOTES = 20;
export const MAX_STATUS_HISTORY = 40;
export const MAX_ORDER_ITEMS = 30;

/* ── request ────────────────────────────────────────────────────────── */

const orderKeySchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(ORDER_KEY_PATTERN, "Malformed order key");

export const placeOrderRequestSchema = z
  .object({
    /** Unpredictable checkout-attempt id; unique-indexed on the order. */
    idempotencyKey: orderKeySchema,
    /** Opaque guest confirmation capability; only its sha256 is stored. */
    confirmationKey: orderKeySchema,
    /** What the customer reviewed. Never used to compute anything. */
    expectedTotalCents: z.coerce
      .number({ message: "Total must be a number" })
      .int("Total must be whole cents")
      .min(1, "Total must be positive")
      .max(MAX_ORDER_TOTAL_CENTS, "Total is out of range"),
    items: cartQuoteRequestSchema.shape.items,
    customer: checkoutFormSchema,
    paymentMethod: z.enum(PAYMENT_METHODS, { message: "Choose a supported payment method" }),
  })
  .superRefine((value, ctx) => {
    // Same cart-wide rules as the quote endpoint: bounded totals, no
    // duplicate line identities. Shared function, so the two boundaries can
    // never disagree about what a valid cart is.
    cartItemsRefine({ items: value.items }, ctx);
  });

export type PlaceOrderRequest = z.output<typeof placeOrderRequestSchema>;

/** Server Action response for `placeOrderAction`. */
export type PlaceOrderResponse =
  | { ok: true; order: PlacedOrderSummary; replayed: boolean }
  | { ok: false; reason: "invalid" }
  | { ok: false; reason: "rate_limited"; retryAfterSeconds: number }
  | { ok: false; reason: "blocked"; blocker: PriceBlocker }
  | {
      ok: false;
      reason: "cart_issue";
      issues: Array<{ slug: string; variantName: string | null; issue: QuoteLineIssue }>;
    }
  | { ok: false; reason: "price_changed"; totals: OrderTotals; taxLabel: string | null }
  | { ok: false; reason: "conflict" }
  | { ok: false; reason: "payment_unavailable" }
  | { ok: false; reason: "unavailable" };

export interface PlacedOrderSummary {
  reference: string;
  status: OrderStatus;
  totalCents: number;
  placedAtIso: string;
}

/* ── confirmation read ──────────────────────────────────────────────── */

export interface OrderConfirmationItem {
  name: string;
  variantName: string | null;
  quantity: number;
  unitPriceCents: number;
  lineTotalCents: number;
}

/**
 * Everything `/order-confirmation` shows, and nothing more. Customer PII is
 * deliberately absent: the reader has already proven possession of the
 * confirmation capability, and echoing the address or phone number back
 * adds risk without adding clarity.
 */
export interface OrderConfirmationView {
  reference: string;
  status: OrderStatus;
  placedAtIso: string;
  items: OrderConfirmationItem[];
  money: {
    currency: "CAD";
    subtotalCents: number;
    deliveryFeeCents: number;
    taxCents: number;
    totalCents: number;
    taxLabel: string | null;
  };
  fulfillment: {
    method: FulfillmentMethod;
    serviceAreaLabel: string | null;
    pickupInstructions: string | null;
  };
  payment: {
    method: PaymentMethod;
    status: PaymentStatus;
    provider: PaymentProvider;
    amountReceivedCents: number;
    refundedAmountCents: number;
    requiresReview: boolean;
    reconciliationStatus: "not_checked" | "matched" | "mismatch" | "error";
    lastReconciledAtIso: string | null;
    paidAtIso: string | null;
    attempts: Array<{
      status: "creating" | "open" | "processing" | "succeeded" | "failed" | "expired" | "uncertain";
      createdAtIso: string;
      expiresAtIso: string | null;
      failureCode: string | null;
    }>;
    retryAvailable: boolean;
  };
}

/**
 * One neutral failure reason covers "no such reference" and "wrong
 * capability", so the endpoint cannot be used to discover which references
 * exist.
 */
export type OrderConfirmationResponse =
  | { ok: true; order: OrderConfirmationView }
  | { ok: false; reason: "not_found" | "rate_limited" | "unavailable" };

export const orderConfirmationRequestSchema = z.object({
  reference: z
    .string()
    .trim()
    .toUpperCase()
    .regex(ORDER_REFERENCE_PATTERN, "Malformed reference"),
  accessKey: orderKeySchema,
});

export type OrderConfirmationRequest = z.output<typeof orderConfirmationRequestSchema>;

export const startPaymentRequestSchema = z.object({
  reference: z.string().trim().toUpperCase().regex(ORDER_REFERENCE_PATTERN, "Malformed reference"),
  accessKey: z.string().trim().toLowerCase().regex(/^[0-9a-f]{64}$/, "Malformed access key"),
});

export type StartPaymentRequest = z.output<typeof startPaymentRequestSchema>;

export type StartPaymentActionResponse =
  | { ok: true; url: string; reused: boolean }
  | { ok: false; reason: "invalid" | "rate_limited" | "not_found" | "unavailable" | "not_payable" | "already_paid" | "payment_pending" | "payment_unavailable" | "attempt_limit" | "conflict" };
