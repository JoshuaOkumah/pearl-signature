import "server-only";
import type Stripe from "stripe";
import { createHash, randomBytes } from "node:crypto";
import { connectDatabase } from "@/lib/db/mongoose";
import { getCheckoutSettings } from "@/lib/store/config";
import { priceCheckout } from "@/lib/checkout/pricing";
import { stripeAppUrl, stripeClient, stripeReadiness } from "@/lib/payments/stripe";
import { PaymentAttemptModel, type PaymentAttemptRecord } from "@/models/payment-attempt";
import { OrderModel, type OrderRecord } from "@/models/order";
import { ORDER_REFERENCE_PATTERN } from "@/lib/validations/order";

export type StartPaymentResult =
  | { ok: true; url: string; reused: boolean }
  | { ok: false; reason: "not_found" | "unavailable" | "not_payable" | "already_paid" | "payment_pending" | "payment_unavailable" | "attempt_limit" | "conflict" };

const MAX_PAYMENT_ATTEMPTS = 5;
const STRIPE_IDEMPOTENCY_SAFE_MS = 23 * 60 * 60 * 1_000;

export interface StripeCheckoutGateway {
  checkout: {
    sessions: {
      create: (params: Stripe.Checkout.SessionCreateParams, options?: Stripe.RequestOptions) => Promise<Stripe.Checkout.Session>;
      retrieve: (sessionId: string) => Promise<Stripe.Checkout.Session>;
    };
  };
}

let testGateway: StripeCheckoutGateway | null = null;

function checkoutGateway(): StripeCheckoutGateway {
  return testGateway ?? stripeClient();
}

/** Test seam for deterministic provider simulations. Server-only module. */
export function setStripeCheckoutGatewayForTests(gateway: StripeCheckoutGateway | null): void {
  testGateway = gateway;
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function isDuplicateKey(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && (error as { code?: unknown }).code === 11000;
}

function orderCanStartPayment(order: OrderRecord): boolean {
  return order.status !== "cancelled" && order.status !== "completed";
}

function sessionRequest(order: OrderRecord, attempt: PaymentAttemptRecord) {
  const success = stripeAppUrl(`/order-confirmation?ref=${encodeURIComponent(order.reference)}&payment_return=success`);
  const cancel = stripeAppUrl(`/order-confirmation?ref=${encodeURIComponent(order.reference)}&payment_return=cancelled`);
  if (!success || !cancel) throw new Error("Application URL is not configured");

  return {
    mode: "payment" as const,
    success_url: success,
    cancel_url: cancel,
    client_reference_id: order.reference,
    customer_email: order.customer.email,
    metadata: {
      order_reference: order.reference,
      payment_attempt_id: String(attempt._id),
    },
    payment_intent_data: {
      metadata: {
        order_reference: order.reference,
        payment_attempt_id: String(attempt._id),
      },
    },
    line_items: [
      {
        quantity: 1,
        price_data: {
          currency: "cad",
          unit_amount: order.money.totalCents,
          product_data: {
            name: `PEARL Signature order ${order.reference}`,
            description: "Your accepted PEARL Signature order total.",
          },
        },
      },
    ],
  };
}

async function loadOpenSession(
  order: OrderRecord,
  attempt: PaymentAttemptRecord,
): Promise<StartPaymentResult | null> {
  if (!attempt.checkoutSessionId) return null;
  try {
    const session = await checkoutGateway().checkout.sessions.retrieve(attempt.checkoutSessionId);
    if (
      session.currency !== "cad" ||
      session.amount_total !== attempt.amountCents ||
      session.metadata?.order_reference !== order.reference ||
      session.metadata?.payment_attempt_id !== String(attempt._id)
    ) {
      await flagPaymentReview(order, attempt, "provider_mismatch");
      return { ok: false, reason: "payment_pending" };
    }
    if (session.payment_status === "paid") return { ok: false, reason: "payment_pending" };
    if (session.status === "open" && session.url) {
      const url = new URL(session.url);
      if (url.protocol === "https:" && url.hostname === "checkout.stripe.com") {
        return { ok: true, url: session.url, reused: true };
      }
      await flagPaymentReview(order, attempt, "hosted_url_mismatch");
      return { ok: false, reason: "payment_pending" };
    }
    if (session.status === "complete") return { ok: false, reason: "payment_pending" };

    await expireAttempt(order, attempt);
    return null;
  } catch {
    // A provider read failure is uncertain. Never make another chargeable
    // attempt merely because Stripe could not be reached.
    return { ok: false, reason: "payment_pending" };
  }
}

async function expireAttempt(order: OrderRecord, attempt: PaymentAttemptRecord): Promise<void> {
  const changed = await PaymentAttemptModel.updateOne(
    { _id: attempt._id, active: true, status: { $in: ["open", "processing"] } },
    { $set: { active: false, status: "expired" } },
  );
  if (changed.modifiedCount === 0) return;
  await OrderModel.updateOne(
    { _id: order._id, "payment.method": "stripe", "payment.status": { $in: ["awaiting_payment", "processing"] } },
    {
      $set: { "payment.status": "expired", "payment.reconciliationStatus": "not_checked" },
      $inc: { version: 1 },
    },
  );
}

async function flagPaymentReview(order: OrderRecord, attempt: PaymentAttemptRecord, code: string): Promise<void> {
  await Promise.all([
    PaymentAttemptModel.updateOne(
      { _id: attempt._id },
      { $set: { status: "uncertain", reconciliationStatus: "mismatch", lastReconciledAt: new Date(), failureCode: code } },
    ),
    OrderModel.updateOne(
      { _id: order._id, "payment.status": { $ne: "paid" } },
      { $set: { "payment.status": "review_required", "payment.requiresReview": true, "payment.reconciliationStatus": "mismatch" }, $inc: { version: 1 } },
    ),
  ]);
}

/**
 * Capability-authorized Checkout initialization for an existing Phase 5
 * order. The order reference is never sufficient authority. A database
 * reservation and stable Stripe idempotency key exist before any provider
 * request, so an ambiguous timeout recovers the same attempt.
 */
export async function startStripeCheckout(referenceRaw: string, accessKeyRaw: string): Promise<StartPaymentResult> {
  const reference = referenceRaw.trim().toUpperCase();
  if (!ORDER_REFERENCE_PATTERN.test(reference) || !/^[0-9a-f]{64}$/.test(accessKeyRaw)) {
    return { ok: false, reason: "not_found" };
  }

  try {
    await connectDatabase();
    let order = await OrderModel.findOne({
      reference,
      confirmationKeyHash: sha256(accessKeyRaw),
    }).lean() as OrderRecord | null;
    if (!order) return { ok: false, reason: "not_found" };
    if (order.payment.method !== "stripe" || !orderCanStartPayment(order)) return { ok: false, reason: "not_payable" };
    if (order.payment.status === "paid" || order.payment.status === "partially_refunded" || order.payment.status === "refunded") {
      return { ok: false, reason: "already_paid" };
    }

    const settings = await getCheckoutSettings();
    if (!settings.available || !settings.intakeEnabled || !settings.onlinePaymentsEnabled || !stripeReadiness().ready) {
      return { ok: false, reason: "payment_unavailable" };
    }
    const currentPrice = priceCheckout({
      subtotalCents: order.money.subtotalCents,
      method: order.fulfillment.method,
      address: order.fulfillment.method === "delivery" && order.fulfillment.address
        ? { province: order.fulfillment.address.province, postalCode: order.fulfillment.address.postalCode }
        : null,
      settings,
    });
    if (!currentPrice.ok || currentPrice.totals.totalCents !== order.money.totalCents) {
      // Never mutate an accepted snapshot. If the business changed price
      // configuration between order insert and session creation, require a
      // fresh customer review instead of charging a different amount.
      return { ok: false, reason: "payment_unavailable" };
    }
    if (
      order.money.currency !== "CAD" ||
      !Number.isInteger(order.money.totalCents) ||
      order.money.totalCents <= 0 ||
      order.money.totalCents > 99_999_999
    ) {
      return { ok: false, reason: "not_payable" };
    }

    let attempt = await PaymentAttemptModel.findOne({ orderId: String(order._id), active: true }).lean() as PaymentAttemptRecord | null;
    if (attempt) {
      if (attempt.amountCents !== order.money.totalCents || attempt.currency !== "CAD") {
        await flagPaymentReview(order, attempt, "snapshot_mismatch");
        return { ok: false, reason: "payment_pending" };
      }
      const existing = await loadOpenSession(order, attempt);
      if (existing) return existing;
      attempt = await PaymentAttemptModel.findOne({ _id: attempt._id, active: true }).lean() as PaymentAttemptRecord | null;
      if (attempt) {
        if (Date.now() - new Date(attempt.createdAt).getTime() > STRIPE_IDEMPOTENCY_SAFE_MS) {
          await flagPaymentReview(order, attempt, "idempotency_window_expired");
          return { ok: false, reason: "payment_pending" };
        }
        return createOrRecoverSession(order, attempt);
      }
      // Expiring the prior attempt bumps the order version. Reload before
      // reserving its successor so optimistic concurrency uses fresh state.
      order = await OrderModel.findOne({ reference, confirmationKeyHash: sha256(accessKeyRaw) }).lean() as OrderRecord | null;
      if (!order) return { ok: false, reason: "not_found" };
      if (order.payment.status === "paid" || order.payment.status === "partially_refunded" || order.payment.status === "refunded") {
        return { ok: false, reason: "already_paid" };
      }
      if (!orderCanStartPayment(order)) return { ok: false, reason: "not_payable" };
    }

    const priorAttempts = await PaymentAttemptModel.countDocuments({ orderId: String(order._id) });
    if (priorAttempts >= MAX_PAYMENT_ATTEMPTS) return { ok: false, reason: "attempt_limit" };
    const latest = await PaymentAttemptModel.findOne({ orderId: String(order._id) }).sort({ sequence: -1 }).select({ sequence: 1 }).lean();
    const sequence = (latest?.sequence ?? 0) + 1;
    const created = await PaymentAttemptModel.create({
      orderId: String(order._id),
      orderReference: order.reference,
      sequence,
      amountCents: order.money.totalCents,
      currency: "CAD",
      provider: "stripe",
      status: "creating",
      active: true,
      providerIdempotencyKey: `pearl_${randomBytes(24).toString("hex")}`,
    });
    const reservation = await OrderModel.updateOne(
      {
        _id: order._id,
        version: order.version,
        "payment.method": "stripe",
        "payment.status": { $in: ["unpaid", "failed", "expired"] },
        status: { $nin: ["cancelled", "completed"] },
      },
      {
        $set: {
          "payment.status": "awaiting_payment",
          "payment.provider": "stripe",
          "payment.stripeSessionId": null,
          "payment.paymentIntentId": null,
          "payment.requiresReview": false,
          "payment.reconciliationStatus": "not_checked",
        },
        $inc: { version: 1 },
      },
    );
    if (reservation.matchedCount === 0) {
      await PaymentAttemptModel.updateOne({ _id: created._id, active: true }, { $set: { active: false, status: "failed", failureCode: "reservation_conflict" } });
      return { ok: false, reason: "conflict" };
    }
    return createOrRecoverSession(order, created.toObject() as PaymentAttemptRecord);
  } catch (error) {
    if (isDuplicateKey(error)) return { ok: false, reason: "payment_pending" };
    // Provider/database exception messages are not logged: third-party text
    // can contain request details. Customer receives a generic outcome.
    void error;
    return { ok: false, reason: "unavailable" };
  }
}

async function createOrRecoverSession(order: OrderRecord, attempt: PaymentAttemptRecord): Promise<StartPaymentResult> {
  try {
    const session = await checkoutGateway().checkout.sessions.create(
      sessionRequest(order, attempt),
      { idempotencyKey: attempt.providerIdempotencyKey },
    );
    let hostedUrl: URL | null = null;
    try {
      hostedUrl = session.url ? new URL(session.url) : null;
    } catch {
      hostedUrl = null;
    }
    if (
      !session.url ||
      !hostedUrl ||
      hostedUrl.protocol !== "https:" ||
      hostedUrl.hostname !== "checkout.stripe.com" ||
      !session.id ||
      session.currency !== "cad" ||
      session.amount_total !== attempt.amountCents
    ) {
      await flagPaymentReview(order, attempt, "session_response_mismatch");
      return { ok: false, reason: "payment_pending" };
    }
    const sessionUpdated = await PaymentAttemptModel.updateOne(
      { _id: attempt._id, active: true, providerIdempotencyKey: attempt.providerIdempotencyKey },
      {
        $set: {
          checkoutSessionId: session.id,
          paymentIntentId: typeof session.payment_intent === "string" ? session.payment_intent : null,
          status: session.status === "open" ? "open" : "processing",
          expiresAt: session.expires_at ? new Date(session.expires_at * 1_000) : null,
          providerCreatedAt: new Date(session.created * 1_000),
          failureCode: null,
        },
      },
    );
    if (sessionUpdated.matchedCount === 0) return { ok: false, reason: "payment_pending" };
    await OrderModel.updateOne(
      { _id: order._id, "payment.method": "stripe", "payment.status": "awaiting_payment" },
      {
        $set: {
          "payment.stripeSessionId": session.id,
          "payment.paymentIntentId": typeof session.payment_intent === "string" ? session.payment_intent : null,
        },
      },
    );
    return { ok: true, url: session.url, reused: attempt.status === "uncertain" || attempt.status === "creating" };
  } catch {
    // Keep the active reservation. Stripe may have accepted the request
    // before the network timed out. The next call reuses its provider key.
    await PaymentAttemptModel.updateOne(
      { _id: attempt._id, active: true },
      { $set: { status: "uncertain", failureCode: "provider_unavailable" } },
    ).catch(() => undefined);
    return { ok: false, reason: "payment_pending" };
  }
}
