import "server-only";
import type Stripe from "stripe";
import { connectDatabase } from "@/lib/db/mongoose";
import { notifyOrderEventDurably } from "@/lib/notifications/dispatch";
import { PaymentAttemptModel, type PaymentAttemptRecord } from "@/models/payment-attempt";
import { PaymentRefundModel } from "@/models/payment-refund";
import { OrderModel, type OrderRecord } from "@/models/order";
import { StripeEventModel } from "@/models/stripe-event";
import { refundStatus } from "@/lib/payments/state";

type WebhookResult = { status: "processed" | "duplicate" | "quarantined" };

function safeCode(error: unknown): string {
  if (typeof error !== "object" || error === null || !("code" in error)) return "processing_error";
  const code = String((error as { code?: unknown }).code);
  return /^[a-z0-9_]{1,80}$/i.test(code) ? code : "processing_error";
}

function metadataMatches(
  metadata: Stripe.Metadata | null,
  orderReference: string,
  attemptId: string,
): boolean {
  return metadata?.order_reference === orderReference && metadata.payment_attempt_id === attemptId;
}

/**
 * Process a cryptographically verified Stripe Event. The durable event row
 * is written before applying financial state. Handlers are monotonic and
 * repeat-safe, so a process crash between writes is safe for Stripe retry.
 */
export async function processStripeEvent(event: Stripe.Event): Promise<WebhookResult> {
  await connectDatabase();

  let objectId = "unsupported";
  const object = event.data.object as { id?: unknown };
  if (typeof object.id === "string") objectId = object.id;
  const eventFields = {
    eventId: event.id,
    type: event.type,
    objectId,
    livemode: event.livemode,
    eventCreatedAt: new Date(event.created * 1_000),
  };

  try {
    await StripeEventModel.create({ ...eventFields, status: "received", attempts: 0 });
  } catch (error) {
    if (!isDuplicateKey(error)) throw error;
    const prior = await StripeEventModel.findOne({ eventId: event.id }).lean();
    if (prior?.status === "processed" || prior?.status === "quarantined") return { status: "duplicate" };
  }

  if (event.livemode) {
    await StripeEventModel.updateOne(
      { eventId: event.id },
      { $set: { status: "quarantined", processedAt: new Date(), lastErrorCode: "live_event_rejected" }, $inc: { attempts: 1 } },
    );
    return { status: "quarantined" };
  }

  try {
    const result = await dispatch(event);
    await StripeEventModel.updateOne(
      { eventId: event.id },
      {
        $set: {
          status: result === "quarantined" ? "quarantined" : "processed",
          processedAt: new Date(),
          lastErrorCode: null,
          ...(result !== "quarantined" && result.reference ? { orderReference: result.reference } : {}),
        },
        $inc: { attempts: 1 },
      },
    );
    return { status: result === "quarantined" ? "quarantined" : "processed" };
  } catch (error) {
    // Provider error messages and raw event details can contain sensitive
    // context. Persist only the normalized error code below.
    await StripeEventModel.updateOne(
      { eventId: event.id },
      { $set: { status: "retry", lastErrorCode: safeCode(error) }, $inc: { attempts: 1 } },
    ).catch(() => undefined);
    throw error;
  }
}

type DispatchResult = "quarantined" | { status: "processed"; reference?: string };

async function dispatch(event: Stripe.Event): Promise<DispatchResult> {
  switch (event.type) {
    case "checkout.session.completed":
    case "checkout.session.async_payment_succeeded":
    case "checkout.session.async_payment_failed":
    case "checkout.session.expired":
      return processCheckoutSession(event.data.object as Stripe.Checkout.Session, event.type);
    case "refund.updated":
      return processRefund(event.data.object as Stripe.Refund);
    case "charge.refunded":
      return processChargeRefund(event.data.object as Stripe.Charge);
    default:
      return { status: "processed" };
  }
}

async function processCheckoutSession(
  session: Stripe.Checkout.Session,
  type: string,
): Promise<DispatchResult> {
  const attempt = await PaymentAttemptModel.findOne({ checkoutSessionId: session.id }).lean() as PaymentAttemptRecord | null;
  if (!attempt) throw new Error("payment_attempt_not_persisted");
  const order = await OrderModel.findById(attempt.orderId).lean() as OrderRecord | null;
  if (!order) return "quarantined";
  if (
    session.livemode ||
    session.currency !== "cad" ||
    session.amount_total !== attempt.amountCents ||
    attempt.currency !== "CAD" ||
    attempt.amountCents !== order.money.totalCents ||
    order.money.currency !== "CAD" ||
    session.client_reference_id !== order.reference ||
    !metadataMatches(session.metadata, order.reference, String(attempt._id))
  ) {
    await markReview(order, attempt, "provider_association_mismatch");
    return "quarantined";
  }

  const paymentIntentId = typeof session.payment_intent === "string" ? session.payment_intent : null;
  const activeAttempt = await PaymentAttemptModel.findOne({ orderId: String(order._id), active: true }).lean() as PaymentAttemptRecord | null;
  const isCurrentAttempt =
    order.payment.stripeSessionId === session.id ||
    (order.payment.stripeSessionId == null && activeAttempt?._id != null && String(activeAttempt._id) === String(attempt._id));
  if (type === "checkout.session.async_payment_succeeded" || (type === "checkout.session.completed" && session.payment_status === "paid")) {
    if (session.payment_status !== "paid") return "quarantined";
    await applySuccessfulPayment(order, attempt, paymentIntentId);
    return { status: "processed", reference: order.reference };
  }

  if (type === "checkout.session.async_payment_failed") {
    if (!isCurrentAttempt) return { status: "processed", reference: order.reference };
    if (attempt.status === "succeeded" || order.payment.status === "paid" || order.payment.status === "partially_refunded" || order.payment.status === "refunded") {
      return { status: "processed", reference: order.reference };
    }
    await PaymentAttemptModel.updateOne(
      { _id: attempt._id, status: { $ne: "succeeded" } },
      { $set: { status: "failed", active: false, failureCode: "async_payment_failed", lastReconciledAt: new Date(), reconciliationStatus: "matched" } },
    );
    await OrderModel.updateOne(
      { _id: order._id, "payment.method": "stripe", "payment.status": { $nin: ["paid", "partially_refunded", "refunded"] } },
      { $set: { "payment.status": "failed", "payment.stripeSessionId": session.id, "payment.paymentIntentId": paymentIntentId, "payment.reconciliationStatus": "matched", "payment.lastReconciledAt": new Date() }, $inc: { version: 1 } },
    );
    await notifyOrderEventDurably("payment.failed", order.reference);
    return { status: "processed", reference: order.reference };
  }

  if (type === "checkout.session.expired") {
    if (!isCurrentAttempt) return { status: "processed", reference: order.reference };
    if (attempt.status === "succeeded" || order.payment.status === "paid" || order.payment.status === "partially_refunded" || order.payment.status === "refunded") {
      return { status: "processed", reference: order.reference };
    }
    await PaymentAttemptModel.updateOne(
      { _id: attempt._id, status: { $ne: "succeeded" } },
      { $set: { status: "expired", active: false, failureCode: "session_expired", lastReconciledAt: new Date(), reconciliationStatus: "matched" } },
    );
    await OrderModel.updateOne(
      { _id: order._id, "payment.method": "stripe", "payment.status": { $nin: ["paid", "partially_refunded", "refunded"] } },
      { $set: { "payment.status": "expired", "payment.stripeSessionId": session.id, "payment.paymentIntentId": paymentIntentId, "payment.reconciliationStatus": "matched", "payment.lastReconciledAt": new Date() }, $inc: { version: 1 } },
    );
    return { status: "processed", reference: order.reference };
  }

  // A completed Checkout Session is not proof of settlement. Async payment
  // methods remain processing until a signed success event arrives.
  if (!isCurrentAttempt) return { status: "processed", reference: order.reference };
  await PaymentAttemptModel.updateOne(
    { _id: attempt._id, status: { $ne: "succeeded" } },
    { $set: { status: "processing", active: true, paymentIntentId, lastReconciledAt: new Date(), reconciliationStatus: "matched" } },
  );
  await OrderModel.updateOne(
    { _id: order._id, "payment.method": "stripe", "payment.status": { $nin: ["paid", "partially_refunded", "refunded"] } },
    { $set: { "payment.status": "processing", "payment.stripeSessionId": session.id, "payment.paymentIntentId": paymentIntentId, "payment.reconciliationStatus": "matched", "payment.lastReconciledAt": new Date() }, $inc: { version: 1 } },
  );
  return { status: "processed", reference: order.reference };
}

async function applySuccessfulPayment(
  order: OrderRecord,
  attempt: PaymentAttemptRecord,
  paymentIntentId: string | null,
): Promise<void> {
  const orderAlreadySettled = order.payment.status === "paid" || order.payment.status === "partially_refunded" || order.payment.status === "refunded";
  const duplicateSettlement = orderAlreadySettled && attempt.status !== "succeeded";
  const lateCancelled = order.status === "cancelled";
  await PaymentAttemptModel.updateOne(
    { _id: attempt._id },
    {
      $set: {
        status: "succeeded",
        active: false,
        paymentIntentId,
        succeededAt: attempt.succeededAt ?? new Date(),
        lastReconciledAt: new Date(),
        reconciliationStatus: "matched",
        failureCode: null,
      },
    },
  );
  const laterActiveAttempt = await PaymentAttemptModel.exists({ orderId: String(order._id), active: true, _id: { $ne: attempt._id } });
  await OrderModel.updateOne(
    { _id: order._id, "payment.method": "stripe", "money.totalCents": attempt.amountCents, "money.currency": "CAD" },
    {
      $set: {
        "payment.status": order.payment.status === "partially_refunded" || order.payment.status === "refunded"
          ? order.payment.status
          : "paid",
        "payment.provider": "stripe",
        "payment.amountReceivedCents": attempt.amountCents,
        "payment.paidAt": order.payment.paidAt ?? new Date(),
        "payment.stripeSessionId": order.payment.stripeSessionId ?? attempt.checkoutSessionId,
        "payment.paymentIntentId": order.payment.paymentIntentId ?? paymentIntentId,
        "payment.requiresReview": order.payment.requiresReview || lateCancelled || duplicateSettlement || Boolean(laterActiveAttempt),
        "payment.reconciliationStatus": "matched",
      },
      $inc: { version: 1 },
    },
  );
  if (lateCancelled) await notifyOrderEventDurably("payment.refund_review", order.reference);
  else if (duplicateSettlement || laterActiveAttempt) await notifyOrderEventDurably("payment.requires_attention", order.reference);
  else await notifyOrderEventDurably("payment.confirmed", order.reference);
}

async function markReview(
  order: OrderRecord,
  attempt: PaymentAttemptRecord,
  code: string,
): Promise<void> {
  await Promise.all([
    PaymentAttemptModel.updateOne(
      { _id: attempt._id },
      { $set: { status: "uncertain", failureCode: code, reconciliationStatus: "mismatch", lastReconciledAt: new Date() } },
    ),
    OrderModel.updateOne(
      { _id: order._id, "payment.status": { $nin: ["paid", "partially_refunded", "refunded"] } },
      { $set: { "payment.status": "review_required", "payment.requiresReview": true, "payment.reconciliationStatus": "mismatch" }, $inc: { version: 1 } },
    ),
  ]);
  await notifyOrderEventDurably("payment.requires_attention", order.reference);
}

async function processRefund(refund: Stripe.Refund): Promise<DispatchResult> {
  if (!refund.payment_intent || typeof refund.payment_intent !== "string") return "quarantined";
  const attempt = await PaymentAttemptModel.findOne({ paymentIntentId: refund.payment_intent }).lean() as PaymentAttemptRecord | null;
  if (!attempt) throw new Error("refund_attempt_not_found");
  if (refund.currency !== "cad" || !Number.isInteger(refund.amount) || refund.amount <= 0 || refund.amount > attempt.amountCents) {
    const order = await OrderModel.findById(attempt.orderId).lean() as OrderRecord | null;
    if (order) await markReview(order, attempt, "refund_amount_mismatch");
    return "quarantined";
  }
  const order = await OrderModel.findById(attempt.orderId).lean() as OrderRecord | null;
  if (!order) return "quarantined";
  await PaymentRefundModel.updateOne(
    { stripeRefundId: refund.id },
    {
      $set: {
        orderId: String(order._id),
        orderReference: order.reference,
        attemptId: String(attempt._id),
        stripePaymentIntentId: refund.payment_intent,
        amountCents: refund.amount,
        currency: "CAD",
        status: refund.status === "succeeded" ? "succeeded" : refund.status === "failed" ? "failed" : refund.status === "canceled" ? "canceled" : "pending",
        providerCreatedAt: new Date(refund.created * 1_000),
        reconciledAt: new Date(),
      },
      $setOnInsert: { stripeRefundId: refund.id },
    },
    { upsert: true },
  );
  await updateRefundTotals(order, attempt);
  return { status: "processed", reference: order.reference };
}

async function processChargeRefund(charge: Stripe.Charge): Promise<DispatchResult> {
  const paymentIntentId = typeof charge.payment_intent === "string" ? charge.payment_intent : null;
  if (!paymentIntentId) return "quarantined";
  const attempt = await PaymentAttemptModel.findOne({ paymentIntentId }).lean();
  if (!attempt) throw new Error("refund_attempt_not_found");
  if (charge.currency !== "cad" || charge.amount !== attempt.amountCents || !Number.isInteger(charge.amount_refunded)) {
    const order = await OrderModel.findById(attempt.orderId).lean();
    if (order) await markReview(order, attempt, "charge_refund_mismatch");
    return "quarantined";
  }
  const order = await OrderModel.findById(attempt.orderId).lean();
  if (!order) return "quarantined";
  for (const refund of charge.refunds?.data ?? []) await processRefund(refund);
  const refunds = await PaymentRefundModel.aggregate<{ cents: number }>([
    { $match: { attemptId: String(attempt._id), status: "succeeded" } },
    { $group: { _id: null, cents: { $sum: "$amountCents" } } },
  ]);
  const knownCents = refunds[0]?.cents ?? 0;
  if (charge.amount_refunded > knownCents) {
    await markReview(order, attempt, "refund_details_incomplete");
    return "quarantined";
  }
  await updateRefundTotals(order, attempt);
  return { status: "processed", reference: order.reference };
}

async function updateRefundTotals(
  order: OrderRecord,
  attempt: PaymentAttemptRecord,
): Promise<void> {
  const rows = await PaymentRefundModel.aggregate<{ cents: number }>([
    { $match: { attemptId: String(attempt._id), status: "succeeded" } },
    { $group: { _id: null, cents: { $sum: "$amountCents" } } },
  ]);
  const refundedCents = rows[0]?.cents ?? 0;
  if (refundedCents > order.money.totalCents) {
    await markReview(order, attempt, "refund_total_exceeds_order");
    return;
  }
  const status = refundedCents === 0 ? "paid" : refundStatus(attempt.amountCents, refundedCents);
  await OrderModel.updateOne(
    { _id: order._id, "payment.method": "stripe", "payment.status": { $in: ["paid", "partially_refunded", "refunded"] } },
    {
      $set: {
        "payment.status": status,
        "payment.refundedAmountCents": refundedCents,
        "payment.reconciliationStatus": "matched",
        "payment.requiresReview": order.payment.requiresReview || order.status === "cancelled",
      },
      $inc: { version: 1 },
    },
  );
}

/** Trusted Stripe API reconciliation adapters share the same write rules as
 * signed webhook handling. Caller must first retrieve and verify the object
 * using the configured server-side Stripe client. */
export async function reconcileVerifiedPayment(orderReference: string, attemptId: string): Promise<boolean> {
  await connectDatabase();
  const attempt = await PaymentAttemptModel.findOne({ _id: attemptId, orderReference }).lean() as PaymentAttemptRecord | null;
  if (!attempt?.checkoutSessionId) return false;
  const order = await OrderModel.findById(attempt.orderId).lean() as OrderRecord | null;
  if (!order || order.payment.method !== "stripe" || order.money.totalCents !== attempt.amountCents || order.money.currency !== "CAD") return false;
  await applySuccessfulPayment(order, attempt, attempt.paymentIntentId ?? null);
  return true;
}

export async function reconcileVerifiedExpiry(orderReference: string, attemptId: string): Promise<boolean> {
  await connectDatabase();
  const attempt = await PaymentAttemptModel.findOne({ _id: attemptId, orderReference }).lean() as PaymentAttemptRecord | null;
  if (!attempt) return false;
  const order = await OrderModel.findById(attempt.orderId).lean() as OrderRecord | null;
  if (!order || order.payment.method !== "stripe") return false;
  await PaymentAttemptModel.updateOne(
    { _id: attempt._id, status: { $ne: "succeeded" } },
    { $set: { status: "expired", active: false, failureCode: "session_expired", lastReconciledAt: new Date(), reconciliationStatus: "matched" } },
  );
  if (
    order.payment.stripeSessionId === attempt.checkoutSessionId &&
    !["paid", "partially_refunded", "refunded"].includes(order.payment.status)
  ) {
    await OrderModel.updateOne(
      { _id: order._id, "payment.stripeSessionId": attempt.checkoutSessionId, "payment.status": { $nin: ["paid", "partially_refunded", "refunded"] } },
      { $set: { "payment.status": "expired", "payment.reconciliationStatus": "matched", "payment.lastReconciledAt": new Date() }, $inc: { version: 1 } },
    );
  }
  return true;
}

export async function reconcileVerifiedProcessing(orderReference: string, attemptId: string): Promise<boolean> {
  await connectDatabase();
  const attempt = await PaymentAttemptModel.findOne({ _id: attemptId, orderReference }).lean() as PaymentAttemptRecord | null;
  if (!attempt) return false;
  const order = await OrderModel.findById(attempt.orderId).lean() as OrderRecord | null;
  if (!order || order.payment.method !== "stripe" || order.payment.stripeSessionId !== attempt.checkoutSessionId) return false;
  await PaymentAttemptModel.updateOne(
    { _id: attempt._id, status: { $ne: "succeeded" } },
    { $set: { status: "processing", active: true, lastReconciledAt: new Date(), reconciliationStatus: "matched" } },
  );
  await OrderModel.updateOne(
    { _id: order._id, "payment.stripeSessionId": attempt.checkoutSessionId, "payment.status": { $nin: ["paid", "partially_refunded", "refunded"] } },
    { $set: { "payment.status": "processing", "payment.reconciliationStatus": "matched", "payment.lastReconciledAt": new Date() }, $inc: { version: 1 } },
  );
  return true;
}

export async function reconcileVerifiedRefundCharge(charge: Stripe.Charge): Promise<DispatchResult> {
  await connectDatabase();
  return processChargeRefund(charge);
}

export async function markReconciliationMismatch(orderReference: string, attemptId: string, code: string): Promise<void> {
  await connectDatabase();
  const attempt = await PaymentAttemptModel.findOne({ _id: attemptId, orderReference }).lean() as PaymentAttemptRecord | null;
  if (!attempt) throw new Error("payment_attempt_not_found");
  const order = await OrderModel.findById(attempt.orderId).lean() as OrderRecord | null;
  if (!order) throw new Error("order_not_found");
  await markReview(order, attempt, code);
}

function isDuplicateKey(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && (error as { code?: unknown }).code === 11000;
}
