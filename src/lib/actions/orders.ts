"use server";

import { headers } from "next/headers";
import { connectDatabase, logDatabaseError } from "@/lib/db/mongoose";
import { createOrder } from "@/lib/orders/create";
import { consumeOrderRateLimit } from "@/lib/orders/rate-limit";
import { hashConfirmationKey, loadConfirmationView } from "@/lib/orders/view";
import { startStripeCheckout } from "@/lib/payments/service";
import { OrderModel, type OrderRecord } from "@/models/order";
import {
  orderConfirmationRequestSchema,
  placeOrderRequestSchema,
  startPaymentRequestSchema,
  type OrderConfirmationResponse,
  type PlaceOrderResponse,
  type StartPaymentActionResponse,
} from "@/lib/validations/order";
import { ORDER_RATE_WINDOW_MS } from "@/models/order-attempt";

/**
 * Public order Server Actions (Phase 5).
 *
 * Both actions follow the same public-endpoint contract:
 *
 *   rate limit (by client address) → strict Zod allowlist → service call →
 *   minimal response. There is no session requirement (customers have no
 *   accounts) and no privileged field in either request schema, so nothing
 *   privileged can be assigned from the client.
 *
 * Neither action ever logs customer details. Failures return neutral
 * reasons with no stack traces, no database identifiers and no hint about
 * whether some other order exists.
 */

/** Raw client address, used only as a rate-limit bucket input (hashed). */
async function clientAddress(): Promise<string> {
  const list = await headers();
  return (
    list.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    list.get("x-real-ip")?.trim() ||
    "unknown"
  );
}

function retryAfterSeconds(now: number): number {
  const windowEnd = (Math.floor(now / ORDER_RATE_WINDOW_MS) + 1) * ORDER_RATE_WINDOW_MS;
  return Math.max(1, Math.ceil((windowEnd - now) / 1000));
}

/* ── order submission ───────────────────────────────────────────────── */

/**
 * Place an order. The ONLY write path from a customer.
 *
 * The request body is bounded by Next's Server Action payload limit and by
 * the schema itself (30 lines, 99 units, short text fields), so one call
 * can never trigger an unbounded read or write.
 */
export async function placeOrderAction(payload: unknown): Promise<PlaceOrderResponse> {
  const now = Date.now();
  const limit = await consumeOrderRateLimit("order.create", await clientAddress(), now);
  if (!limit.allowed) {
    return { ok: false, reason: "rate_limited", retryAfterSeconds: retryAfterSeconds(now) };
  }

  const parsed = placeOrderRequestSchema.safeParse(payload);
  if (!parsed.success) return { ok: false, reason: "invalid" };

  return createOrder(parsed.data);
}

/** Initialize or safely reuse a hosted Stripe session for an existing order. */
export async function startStripeCheckoutAction(payload: unknown): Promise<StartPaymentActionResponse> {
  const now = Date.now();
  const limit = await consumeOrderRateLimit("payment.create", await clientAddress(), now);
  if (!limit.allowed) return { ok: false, reason: "rate_limited" };
  const parsed = startPaymentRequestSchema.safeParse(payload);
  if (!parsed.success) return { ok: false, reason: "invalid" };
  return startStripeCheckout(parsed.data.reference, parsed.data.accessKey);
}

/* ── guest confirmation read ────────────────────────────────────────── */

/**
 * Read a placed order for its confirmation page.
 *
 * Authorisation is the confirmation capability: a 32-byte random secret
 * generated in the customer's browser, stored only as a sha256 on the
 * order. The public reference alone matches nothing, so references cannot
 * be enumerated, and the capability never appears in the URL, in a referrer
 * header or in a log line.
 *
 * The response deliberately excludes customer PII (see
 * `OrderConfirmationView`), so even a leaked response body reveals only
 * what the customer already knows about their own order.
 */
export async function loadOrderConfirmationAction(
  payload: unknown,
): Promise<OrderConfirmationResponse> {
  const now = Date.now();
  const limit = await consumeOrderRateLimit("order.lookup", await clientAddress(), now);
  if (!limit.allowed) {
    return { ok: false, reason: "rate_limited" };
  }

  const parsed = orderConfirmationRequestSchema.safeParse(payload);
  // A malformed reference and a wrong key produce the SAME answer, so the
  // endpoint cannot be used to discover which references exist.
  if (!parsed.success) return { ok: false, reason: "not_found" };

  try {
    await connectDatabase();
    const order = (await OrderModel.findOne({
      reference: parsed.data.reference,
      confirmationKeyHash: hashConfirmationKey(parsed.data.accessKey),
    }).lean()) as OrderRecord | null;

    if (!order) return { ok: false, reason: "not_found" };
    return { ok: true, order: await loadConfirmationView(order) };
  } catch (error) {
    logDatabaseError("order-confirmation", error);
    return { ok: false, reason: "unavailable" };
  }
}
