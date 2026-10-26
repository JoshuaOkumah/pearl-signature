// @vitest-environment node
import { createHash, randomBytes } from "node:crypto";
import Stripe from "stripe";
import mongoose from "mongoose";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { MongoMemoryServer } from "mongodb-memory-server";
import { connectDatabase } from "@/lib/db/mongoose";
import { OrderModel, type OrderRecord } from "@/models/order";
import { StoreConfigModel } from "@/models/store-config";
import { PaymentAttemptModel } from "@/models/payment-attempt";
import { StripeEventModel } from "@/models/stripe-event";
import { PaymentRefundModel } from "@/models/payment-refund";
import { NotificationOutboxModel } from "@/models/notification-outbox";
import { stripeReadiness, resetStripeClientForTests } from "@/lib/payments/stripe";
import { processStripeEvent } from "@/lib/payments/webhooks";
import { setStripeCheckoutGatewayForTests, startStripeCheckout, type StripeCheckoutGateway } from "@/lib/payments/service";
import { reconcileStripeOrder, setStripeReconciliationGatewayForTests, type StripeReconciliationGateway } from "@/lib/payments/reconcile";
import type { OrderStatus, PaymentStatus } from "@/lib/validations/order";

const TEST_KEY = "sk_test_pearl_fake_only";
const TEST_WEBHOOK = "whsec_pearl_fake_only";
const SITE_URL = "https://pearl.example.test";
const ACCESS_KEY = randomBytes(32).toString("hex");

let mongod: MongoMemoryServer | null = null;
const paramsSeen: Stripe.Checkout.SessionCreateParams[] = [];
const optionsSeen: Stripe.RequestOptions[] = [];
let nextSession: Stripe.Checkout.Session | null = null;
let createFailure: Error | null = null;
let creates = 0;
const sessions = new Map<string, Stripe.Checkout.Session>();

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function fakeSession(
  params: Stripe.Checkout.SessionCreateParams,
  id = `cs_test_${randomBytes(8).toString("hex")}`,
  status: "open" | "complete" | "expired" = "open",
  paymentStatus: "paid" | "unpaid" | "no_payment_required" = "unpaid",
): Stripe.Checkout.Session {
  const price = params.line_items?.[0]?.price_data;
  const amount = price && typeof price !== "string" ? price.unit_amount ?? 0 : 0;
  return {
    id,
    object: "checkout.session",
    url: `https://checkout.stripe.com/c/pay/${id}`,
    mode: "payment",
    status,
    payment_status: paymentStatus,
    amount_total: amount,
    currency: "cad",
    client_reference_id: params.client_reference_id ?? null,
    metadata: params.metadata ?? {},
    payment_intent: `pi_${id}`,
    expires_at: Math.floor(Date.now() / 1000) + 1_800,
    created: Math.floor(Date.now() / 1000),
    livemode: false,
  } as Stripe.Checkout.Session;
}

const gateway: StripeCheckoutGateway = {
  checkout: {
    sessions: {
      create: vi.fn(async (params, options) => {
        creates += 1;
        paramsSeen.push(params);
        if (options) optionsSeen.push(options);
        if (createFailure) {
          const error = createFailure;
          createFailure = null;
          throw error;
        }
        if (nextSession) {
          const custom = nextSession;
          nextSession = null;
          sessions.set(String(options?.idempotencyKey), custom);
          return custom;
        }
        const key = String(options?.idempotencyKey);
        const existing = sessions.get(key);
        if (existing) return existing;
        const created = fakeSession(params);
        sessions.set(key, created);
        return created;
      }),
      retrieve: vi.fn(async (id) => {
        const result = [...sessions.values()].find((session) => session.id === id);
        if (!result) throw new Error("unknown session");
        return result;
      }),
    },
  },
};

const reconciliationGateway: StripeReconciliationGateway = {
  checkout: {
    sessions: {
      retrieve: vi.fn(async (id: string) => {
        const session = [...sessions.values()].find((candidate) => candidate.id === id);
        if (!session) throw new Error("unknown session");
        return session;
      }),
    },
  },
  paymentIntents: {
    retrieve: vi.fn(async (id: string) => ({
      id,
      object: "payment_intent",
      amount: 4_938,
      currency: "cad",
      status: "succeeded",
      latest_charge: `ch_${id}`,
    }) as Stripe.PaymentIntent),
  },
  charges: {
    retrieve: vi.fn(async (id: string) => ({
      id,
      object: "charge",
      amount: 4_938,
      amount_refunded: 0,
      currency: "cad",
      payment_intent: "pi_test",
      refunds: { object: "list", data: [], has_more: false, total_count: 0, url: "/v1/charges/ch_test/refunds" },
    }) as unknown as Stripe.Charge),
  },
};

async function seedOrder(options: { status?: OrderStatus; paymentStatus?: PaymentStatus; cancelled?: boolean } = {}): Promise<OrderRecord> {
  const reference = `PS-${randomBytes(5).toString("hex").toUpperCase()}`;
  const order = await OrderModel.create({
    reference,
    idempotencyKey: randomBytes(32).toString("hex"),
    idempotencyHash: randomBytes(32).toString("hex"),
    confirmationKeyHash: sha256(ACCESS_KEY),
    customer: { fullName: "Synthetic Buyer", email: "buyer@example.test", phone: "+14165550123" },
    fulfillment: {
      method: "delivery",
      address: { line1: "1 Test Road", line2: null, city: "Toronto", province: "ON", postalCode: "M5H 2N2" },
      instructions: null,
      notes: null,
      serviceAreaLabel: "Synthetic test area",
      pickupInstructions: null,
    },
    items: [{ productId: "synthetic", slug: "synthetic-meal", name: "Synthetic Meal", variantName: null, quantity: 1, unitPriceCents: 3_750, lineTotalCents: 3_750, image: null }],
    money: { currency: "CAD", subtotalCents: 3_750, deliveryFeeCents: 700, taxCents: 488, totalCents: 4_938, taxLabel: "Synthetic test HST", taxRateBps: 1_300 },
    payment: { method: "stripe", provider: "stripe", status: options.paymentStatus ?? "unpaid" },
    status: options.cancelled ? "cancelled" : options.status ?? "placed",
    statusHistory: [{ from: null, to: options.cancelled ? "cancelled" : options.status ?? "placed", at: new Date(), adminId: null, note: null }],
    cancellationReason: options.cancelled ? "Synthetic cancellation" : null,
    notes: [],
    version: 1,
  });
  return order as unknown as OrderRecord;
}

async function testEvent(
  session: Stripe.Checkout.Session,
  type: string,
  id = `evt_test_${randomBytes(8).toString("hex")}`,
): Promise<Stripe.Event> {
  return {
    id,
    object: "event",
    api_version: "2025-12-15.clover",
    created: Math.floor(Date.now() / 1000),
    livemode: false,
    pending_webhooks: 1,
    request: { id: null, idempotency_key: null },
    type,
    data: { object: session, previous_attributes: undefined },
  } as unknown as Stripe.Event;
}

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  process.env.MONGODB_URI = mongod.getUri("pearl_phase6_payments_test");
  process.env.STRIPE_PAYMENTS_ENABLED = "true";
  process.env.STRIPE_SECRET_KEY = TEST_KEY;
  process.env.STRIPE_WEBHOOK_SECRET = TEST_WEBHOOK;
  process.env.NEXT_PUBLIC_SITE_URL = SITE_URL;
  await connectDatabase();
  await Promise.all([
    OrderModel.createIndexes(),
    StoreConfigModel.createIndexes(),
    PaymentAttemptModel.createIndexes(),
    StripeEventModel.createIndexes(),
    PaymentRefundModel.createIndexes(),
    NotificationOutboxModel.createIndexes(),
  ]);
  await StoreConfigModel.create({
    _id: "checkout",
    orderIntakeEnabled: true,
    payments: { onlineEnabled: true },
    delivery: { enabled: true, serviceAreas: [{ label: "Synthetic test area", provinces: ["ON"], postalPrefixes: ["M5H"], feeCents: 700 }] },
    pickup: { enabled: false, instructions: null },
    tax: { mode: "rate", rateBps: 1_300, base: "merchandise", label: "Synthetic test HST" },
  });
  setStripeCheckoutGatewayForTests(gateway);
  setStripeReconciliationGatewayForTests(reconciliationGateway);
});

beforeEach(async () => {
  vi.restoreAllMocks();
  await Promise.all([
    OrderModel.deleteMany({}),
    PaymentAttemptModel.deleteMany({}),
    StripeEventModel.deleteMany({}),
    PaymentRefundModel.deleteMany({}),
    NotificationOutboxModel.deleteMany({}),
    StoreConfigModel.updateOne(
      { _id: "checkout" },
      { $set: {
        orderIntakeEnabled: true,
        payments: { onlineEnabled: true },
        delivery: { enabled: true, serviceAreas: [{ label: "Synthetic test area", provinces: ["ON"], postalPrefixes: ["M5H"], feeCents: 700 }] },
        pickup: { enabled: false, instructions: null },
        tax: { mode: "rate", rateBps: 1_300, base: "merchandise", label: "Synthetic test HST" },
      } },
    ),
  ]);
  paramsSeen.length = 0;
  optionsSeen.length = 0;
  creates = 0;
  createFailure = null;
  nextSession = null;
  sessions.clear();
  vi.clearAllMocks();
});

afterAll(async () => {
  setStripeCheckoutGatewayForTests(null);
  setStripeReconciliationGatewayForTests(null);
  resetStripeClientForTests();
  await mongoose.disconnect();
  await mongod?.stop();
  mongod = null;
});

describe("Stripe configuration and hosted session initialization", () => {
  it("fails closed without explicit switch, test key, webhook secret, or canonical URL", () => {
    expect(stripeReadiness({ ...process.env, STRIPE_PAYMENTS_ENABLED: "false" }).ready).toBe(false);
    expect(stripeReadiness({ ...process.env, STRIPE_SECRET_KEY: "sk_live_do_not_use" }).reason).toBe("live_key_rejected");
    expect(stripeReadiness({ ...process.env, STRIPE_WEBHOOK_SECRET: "" }).ready).toBe(false);
    expect(stripeReadiness({ ...process.env, NEXT_PUBLIC_SITE_URL: "http://example.com" }).reason).toBe("invalid_site_url");
    expect(stripeReadiness().ready).toBe(true);
  });

  it("creates a capability-authorized CAD session for the frozen total with fees and tax once", async () => {
    const order = await seedOrder();
    const result = await startStripeCheckout(order.reference, ACCESS_KEY);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.url).toMatch(/^https:\/\/checkout\.stripe\.com\//);
    expect(paramsSeen).toHaveLength(1);
    expect(paramsSeen[0]).toMatchObject({ mode: "payment", client_reference_id: order.reference });
    const item = paramsSeen[0].line_items?.[0];
    expect(item?.quantity).toBe(1);
    expect(item?.price_data?.currency).toBe("cad");
    expect(item?.price_data?.unit_amount).toBe(4_938); // includes $7.00 delivery + $4.88 tax exactly once
    expect(optionsSeen[0].idempotencyKey).toMatch(/^pearl_[0-9a-f]{48}$/);
    expect(paramsSeen[0].metadata).toEqual({
      order_reference: order.reference,
      payment_attempt_id: expect.any(String),
    });
    expect(JSON.stringify(paramsSeen[0].metadata)).not.toMatch(/buyer|address|M5H|capability/i);
    const persisted = await OrderModel.findById(order._id).lean();
    expect(persisted?.payment).toMatchObject({ status: "awaiting_payment", method: "stripe", provider: "stripe" });
    expect(persisted?.money.totalCents).toBe(4_938);
  });

  it("does not authorize from an order reference alone and refuses paid/cancelled orders", async () => {
    const order = await seedOrder();
    expect(await startStripeCheckout(order.reference, "a".repeat(64))).toEqual({ ok: false, reason: "not_found" });
    const paid = await seedOrder({ paymentStatus: "paid" });
    expect(await startStripeCheckout(paid.reference, ACCESS_KEY)).toEqual({ ok: false, reason: "already_paid" });
    const cancelled = await seedOrder({ cancelled: true });
    expect(await startStripeCheckout(cancelled.reference, ACCESS_KEY)).toEqual({ ok: false, reason: "not_payable" });
    expect(creates).toBe(0);
  });

  it("reuses an open active session on repeat and concurrent starts", async () => {
    const order = await seedOrder();
    const results = await Promise.all([
      startStripeCheckout(order.reference, ACCESS_KEY),
      startStripeCheckout(order.reference, ACCESS_KEY),
    ]);
    expect(results.some((result) => result.ok)).toBe(true);
    expect(creates).toBe(1);
    expect(await PaymentAttemptModel.countDocuments({ orderId: String(order._id) })).toBe(1);
  });

  it("recovers an ambiguous Stripe timeout with the same persisted idempotency key", async () => {
    const order = await seedOrder();
    createFailure = new Error("synthetic timeout after provider acceptance");
    expect(await startStripeCheckout(order.reference, ACCESS_KEY)).toEqual({ ok: false, reason: "payment_pending" });
    const attempt = await PaymentAttemptModel.findOne({ orderId: String(order._id) }).lean();
    expect(attempt?.status).toBe("uncertain");
    const firstKey = optionsSeen[0]?.idempotencyKey;
    const recovered = await startStripeCheckout(order.reference, ACCESS_KEY);
    expect(recovered.ok).toBe(true);
    expect(optionsSeen[1]?.idempotencyKey).toBe(firstKey);
    expect(await PaymentAttemptModel.countDocuments({ orderId: String(order._id) })).toBe(1);
  });

  it("recovers when Stripe creates a session but session-id persistence fails", async () => {
    const order = await seedOrder();
    const original = PaymentAttemptModel.updateOne.bind(PaymentAttemptModel);
    let failSessionWrite = true;
    vi.spyOn(PaymentAttemptModel, "updateOne").mockImplementation(((filter: unknown, update: unknown, options?: unknown) => {
      const payload = update as { $set?: { checkoutSessionId?: string } };
      if (failSessionWrite && payload.$set?.checkoutSessionId) {
        failSessionWrite = false;
        return Promise.reject(new Error("synthetic database write failure")) as never;
      }
      return original(filter as never, update as never, options as never) as never;
    }) as never);

    expect(await startStripeCheckout(order.reference, ACCESS_KEY)).toMatchObject({ ok: false, reason: "payment_pending" });
    const reserved = await PaymentAttemptModel.findOne({ orderId: String(order._id) }).lean();
    expect(reserved?.status).toBe("uncertain");
    const idempotencyKey = reserved?.providerIdempotencyKey;
    const recovered = await startStripeCheckout(order.reference, ACCESS_KEY);
    expect(recovered.ok).toBe(true);
    expect(optionsSeen.map((options) => options.idempotencyKey)).toEqual([idempotencyKey, idempotencyKey]);
    expect(new Set([...sessions.values()].map((session) => session.id)).size).toBe(1);
    expect(await PaymentAttemptModel.countDocuments({ orderId: String(order._id) })).toBe(1);
  });

  it("replaces only a provider-confirmed expired Checkout Session", async () => {
    const order = await seedOrder();
    expect((await startStripeCheckout(order.reference, ACCESS_KEY)).ok).toBe(true);
    const [key, activeSession] = [...sessions.entries()][0];
    sessions.set(key, { ...activeSession, status: "expired", url: null } as unknown as Stripe.Checkout.Session);
    const retry = await startStripeCheckout(order.reference, ACCESS_KEY);
    expect(retry.ok, JSON.stringify(retry)).toBe(true);
    const attempts = await PaymentAttemptModel.find({ orderId: String(order._id) }).sort({ sequence: 1 }).lean();
    expect(attempts.map((attempt) => attempt.status)).toEqual(["expired", "open"]);
    expect(attempts.map((attempt) => attempt.active)).toEqual([false, true]);
    expect(creates).toBe(2);
  });

  it("checks configured tax and fulfilment again without changing the order snapshot", async () => {
    const order = await seedOrder();
    await StoreConfigModel.updateOne({ _id: "checkout" }, { $set: { "delivery.serviceAreas.0.feeCents": 701 } });
    expect(await startStripeCheckout(order.reference, ACCESS_KEY)).toEqual({ ok: false, reason: "payment_unavailable" });
    expect((await OrderModel.findById(order._id).lean())?.money.totalCents).toBe(4_938);
    expect(creates).toBe(0);
  });

  it("reconciliation dry-run is read-only and apply records a provider-verified payment", async () => {
    const order = await seedOrder();
    expect((await startStripeCheckout(order.reference, ACCESS_KEY)).ok).toBe(true);
    const [sessionKey, session] = [...sessions.entries()][0];
    sessions.set(sessionKey, { ...session, status: "complete", payment_status: "paid" } as Stripe.Checkout.Session);

    const dry = await reconcileStripeOrder(order.reference);
    expect(dry).toMatchObject({ mode: "dry_run", result: "matched", providerPaidCents: 4_938 });
    expect((await OrderModel.findById(order._id).lean())?.payment.status).toBe("awaiting_payment");

    const applied = await reconcileStripeOrder(order.reference, true);
    expect(applied).toMatchObject({ mode: "applied", result: "matched" });
    expect((await OrderModel.findById(order._id).lean())?.payment.status).toBe("paid");
  });

  it("reconciliation refuses a mismatched provider amount and flags review only when explicitly applied", async () => {
    const order = await seedOrder();
    expect((await startStripeCheckout(order.reference, ACCESS_KEY)).ok).toBe(true);
    const [sessionKey, session] = [...sessions.entries()][0];
    sessions.set(sessionKey, { ...session, amount_total: 100, status: "complete", payment_status: "paid" } as Stripe.Checkout.Session);
    const dry = await reconcileStripeOrder(order.reference);
    expect(dry.result).toBe("mismatch");
    expect((await OrderModel.findById(order._id).lean())?.payment.status).toBe("awaiting_payment");
    await reconcileStripeOrder(order.reference, true);
    expect((await OrderModel.findById(order._id).lean())?.payment).toMatchObject({ status: "review_required", requiresReview: true });
  });
});

describe("verified event transitions and durable idempotency", () => {
  it("confirms only paid Checkout sessions, once, without advancing fulfilment", async () => {
    const order = await seedOrder();
    const started = await startStripeCheckout(order.reference, ACCESS_KEY);
    expect(started.ok).toBe(true);
    const session = [...sessions.values()][0];
    const paid = { ...session, status: "complete", payment_status: "paid" } as Stripe.Checkout.Session;
    const event = await testEvent(paid, "checkout.session.completed");
    expect(await processStripeEvent(event)).toEqual({ status: "processed" });
    expect(await processStripeEvent(event)).toEqual({ status: "duplicate" });
    const stored = await OrderModel.findById(order._id).lean();
    expect(stored?.payment).toMatchObject({ status: "paid", amountReceivedCents: 4_938, provider: "stripe" });
    expect(stored?.status).toBe("placed");
    expect(await PaymentAttemptModel.countDocuments({ orderId: String(order._id), status: "succeeded" })).toBe(1);
    expect(await NotificationOutboxModel.countDocuments({ event: "payment.confirmed", reference: order.reference })).toBe(1);
  });

  it("does not mark a completed but unpaid Checkout Session as paid", async () => {
    const order = await seedOrder();
    expect((await startStripeCheckout(order.reference, ACCESS_KEY)).ok).toBe(true);
    const session = { ...[...sessions.values()][0], status: "complete", payment_status: "unpaid" } as Stripe.Checkout.Session;
    await processStripeEvent(await testEvent(session, "checkout.session.completed"));
    expect((await OrderModel.findById(order._id).lean())?.payment.status).toBe("processing");
  });

  it("accepts asynchronous success, while later failures cannot erase paid", async () => {
    const order = await seedOrder();
    expect((await startStripeCheckout(order.reference, ACCESS_KEY)).ok).toBe(true);
    const base = [...sessions.values()][0];
    await processStripeEvent(await testEvent({ ...base, status: "complete", payment_status: "paid" } as Stripe.Checkout.Session, "checkout.session.async_payment_succeeded"));
    await processStripeEvent(await testEvent({ ...base, status: "complete", payment_status: "unpaid" } as Stripe.Checkout.Session, "checkout.session.async_payment_failed"));
    expect((await OrderModel.findById(order._id).lean())?.payment.status).toBe("paid");
  });

  it("marks an async failure retryable and does not let an older expiry erase a later success", async () => {
    const order = await seedOrder();
    expect((await startStripeCheckout(order.reference, ACCESS_KEY)).ok).toBe(true);
    const session = [...sessions.values()][0];
    const failed = { ...session, status: "complete", payment_status: "unpaid" } as Stripe.Checkout.Session;
    await processStripeEvent(await testEvent(failed, "checkout.session.async_payment_failed"));
    expect((await OrderModel.findById(order._id).lean())?.payment.status).toBe("failed");
    const attempt = await PaymentAttemptModel.findOne({ orderId: String(order._id) }).lean();
    expect(attempt?.active).toBe(false);

    const second = await startStripeCheckout(order.reference, ACCESS_KEY);
    expect(second.ok, JSON.stringify(second)).toBe(true);
    const latestSession = [...sessions.values()][1];
    await processStripeEvent(await testEvent({ ...latestSession, status: "complete", payment_status: "paid" } as Stripe.Checkout.Session, "checkout.session.async_payment_succeeded"));
    await processStripeEvent(await testEvent(failed, "checkout.session.expired"));
    expect((await OrderModel.findById(order._id).lean())?.payment.status).toBe("paid");
  });

  it("records partial and full refunds from trusted provider refund records", async () => {
    const order = await seedOrder();
    expect((await startStripeCheckout(order.reference, ACCESS_KEY)).ok).toBe(true);
    const session = [...sessions.values()][0];
    await processStripeEvent(await testEvent({ ...session, status: "complete", payment_status: "paid" } as Stripe.Checkout.Session, "checkout.session.completed"));
    const refund = {
      id: "re_test_partial",
      object: "refund",
      amount: 1_000,
      currency: "cad",
      created: Math.floor(Date.now() / 1_000),
      payment_intent: String(session.payment_intent),
      status: "succeeded",
    } as Stripe.Refund;
    const event = await testEvent(session, "refund.updated", "evt_refund_partial");
    (event.data as unknown as { object: Stripe.Refund }).object = refund;
    await processStripeEvent(event);
    const partially = await OrderModel.findById(order._id).lean();
    expect(partially?.payment).toMatchObject({ status: "partially_refunded", amountReceivedCents: 4_938, refundedAmountCents: 1_000 });

    const fullRefund = { ...refund, id: "re_test_full", amount: 3_938 } as Stripe.Refund;
    const fullEvent = await testEvent(session, "refund.updated", "evt_refund_full");
    (fullEvent.data as unknown as { object: Stripe.Refund }).object = fullRefund;
    await processStripeEvent(fullEvent);
    expect((await OrderModel.findById(order._id).lean())?.payment.status).toBe("refunded");
    expect(await PaymentRefundModel.countDocuments({ orderReference: order.reference, status: "succeeded" })).toBe(2);
  });

  it("flags amount/association mismatches and late success after cancellation", async () => {
    const badOrder = await seedOrder();
    expect((await startStripeCheckout(badOrder.reference, ACCESS_KEY)).ok).toBe(true);
    const base = [...sessions.values()][0];
    await processStripeEvent(await testEvent({ ...base, amount_total: 10, status: "complete", payment_status: "paid" } as Stripe.Checkout.Session, "checkout.session.completed"));
    expect((await OrderModel.findById(badOrder._id).lean())?.payment.status).toBe("review_required");

    const cancelled = await seedOrder({ cancelled: true });
    // A late signed success can be applied to an already reserved attempt.
    const attempt = await PaymentAttemptModel.create({
      orderId: String(cancelled._id), orderReference: cancelled.reference, sequence: 1,
      amountCents: cancelled.money.totalCents, currency: "CAD", provider: "stripe",
      status: "open", active: false, providerIdempotencyKey: `pearl_${randomBytes(24).toString("hex")}`,
      checkoutSessionId: `cs_test_late_${randomBytes(4).toString("hex")}`, paymentIntentId: "pi_late",
    });
    const lateSession = {
      ...fakeSession({ mode: "payment", line_items: [] }, attempt.checkoutSessionId!, "complete", "paid"),
      amount_total: cancelled.money.totalCents,
      client_reference_id: cancelled.reference,
      payment_intent: "pi_late",
      metadata: { order_reference: cancelled.reference, payment_attempt_id: String(attempt._id) },
    } as Stripe.Checkout.Session;
    await processStripeEvent(await testEvent(lateSession, "checkout.session.completed"));
    const late = await OrderModel.findById(cancelled._id).lean();
    expect(late?.status).toBe("cancelled");
    expect(late?.payment.status).toBe("paid");
    expect(late?.payment.requiresReview).toBe(true);
    expect(await NotificationOutboxModel.countDocuments({ event: "payment.refund_review", reference: cancelled.reference })).toBe(1);
  });

  it("quarantines live-mode events and unsupported signed event types do nothing financially", async () => {
    const order = await seedOrder();
    const live = { id: "evt_live_reject", type: "checkout.session.completed", object: "event", created: 1, livemode: true, data: { object: {} } } as unknown as Stripe.Event;
    expect(await processStripeEvent(live)).toEqual({ status: "quarantined" });
    const ignored = { id: "evt_supported_unknown", type: "customer.created", object: "event", created: 1, livemode: false, data: { object: { id: "cus_test" } } } as unknown as Stripe.Event;
    expect(await processStripeEvent(ignored)).toEqual({ status: "processed" });
    expect((await OrderModel.findById(order._id).lean())?.payment.status).toBe("unpaid");
  });
});

describe("webhook signature Route Handler", () => {
  it("accepts only official signatures over the raw request bytes", async () => {
    const { POST } = await import("@/app/api/stripe/webhook/route");
    const order = await seedOrder();
    expect((await startStripeCheckout(order.reference, ACCESS_KEY)).ok).toBe(true);
    const session = { ...[...sessions.values()][0], status: "complete", payment_status: "paid" };
    const event = await testEvent(session as Stripe.Checkout.Session, "checkout.session.completed");
    const payload = JSON.stringify(event);
    const signature = Stripe.webhooks.generateTestHeaderString({ payload, secret: TEST_WEBHOOK });
    const valid = await POST(new Request("http://localhost/api/stripe/webhook", {
      method: "POST",
      headers: { "stripe-signature": signature, "content-type": "application/json" },
      body: payload,
    }));
    expect(valid.status).toBe(200);
    expect(valid.headers.get("cache-control")).toContain("no-store");
    const invalid = await POST(new Request("http://localhost/api/stripe/webhook", {
      method: "POST",
      headers: { "stripe-signature": "t=1,v1=forged", "content-type": "application/json" },
      body: payload,
    }));
    expect(invalid.status).toBe(400);
    const modified = await POST(new Request("http://localhost/api/stripe/webhook", {
      method: "POST",
      headers: { "stripe-signature": signature, "content-type": "application/json" },
      body: `${payload} `,
    }));
    expect(modified.status).toBe(400);
    const missing = await POST(new Request("http://localhost/api/stripe/webhook", { method: "POST", body: payload }));
    expect(missing.status).toBe(400);
    expect((await OrderModel.findById(order._id).lean())?.payment.status).toBe("paid");
  });
});
