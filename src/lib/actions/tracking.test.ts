// @vitest-environment node
import { createHash, randomBytes } from "node:crypto";
import mongoose from "mongoose";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { MongoMemoryServer } from "mongodb-memory-server";
import { connectDatabase } from "@/lib/db/mongoose";
import { OrderModel } from "@/models/order";
import { OrderAttemptModel } from "@/models/order-attempt";
import { OrderAccessGrantModel } from "@/models/order-access-grant";
import {
  TRACKING_CODE_MAX_ATTEMPTS,
  TrackingChallengeModel,
} from "@/models/tracking-challenge";
import {
  loadOrderTrackingAction,
  requestTrackingCodeAction,
  verifyTrackingCodeAction,
} from "./tracking";

/**
 * Guest tracking and cross-device recovery (Phase 7).
 *
 * The properties under test are security properties, so this suite runs against
 * a REAL MongoDB: unique indexes, the single-use consume, the attempt counter
 * and the rate-limit buckets only exist at the database level.
 *
 * The email send is mocked because no test may send a real message. The mock
 * captures the generated code, which is the only way to prove the stored value
 * is a hash and never the code itself.
 */

const { sendMock, headerState } = vi.hoisted(() => ({
  sendMock: vi.fn<(input: { code: string; to: string; reference: string }) => Promise<boolean>>(
    async () => true,
  ),
  headerState: { address: "203.0.113.1" },
}));

vi.mock("@/lib/notifications/send-tracking-code", () => ({
  sendTrackingCodeEmail: sendMock,
}));

vi.mock("next/headers", () => ({
  headers: async () => ({
    get: (name: string) => (name === "x-forwarded-for" ? headerState.address : null),
  }),
}));

const EMAIL = "ada.obi@example.com";
const CONFIRMATION_KEY = randomBytes(32).toString("hex");

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function reference(): string {
  return `PS-${randomBytes(5).toString("hex").toUpperCase()}`;
}

function orderPayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    reference: reference(),
    idempotencyKey: randomBytes(32).toString("hex"),
    idempotencyHash: randomBytes(32).toString("hex"),
    confirmationKeyHash: sha256(CONFIRMATION_KEY),
    customer: { fullName: "Ada Obi", email: EMAIL, phone: "+14165550123" },
    fulfillment: {
      method: "pickup",
      address: null,
      instructions: null,
      notes: null,
      serviceAreaLabel: null,
      pickupInstructions: "Synthetic test counter opens at noon.",
    },
    items: [
      {
        productId: "prod_synthetic",
        slug: "jollof-test",
        name: "Synthetic Jollof",
        variantName: null,
        quantity: 1,
        unitPriceCents: 3750,
        lineTotalCents: 3750,
        image: null,
      },
    ],
    money: {
      currency: "CAD",
      subtotalCents: 3750,
      deliveryFeeCents: 0,
      taxCents: 488,
      totalCents: 4238,
      taxLabel: "Test HST",
      taxRateBps: 1300,
    },
    payment: { method: "cash_on_arrival", status: "unpaid", paidAt: null, paidByAdminId: null, paidByLabel: null },
    status: "preparing",
    statusHistory: [
      { from: null, to: "placed", at: new Date(Date.now() - 60_000), adminId: null, note: null },
      { from: "placed", to: "confirmed", at: new Date(Date.now() - 30_000), adminId: null, note: null },
      { from: "confirmed", to: "preparing", at: new Date(), adminId: null, note: null },
    ],
    cancellationReason: null,
    notes: [],
    version: 3,
    ...overrides,
  };
}

let mongod: MongoMemoryServer | null = null;
let addressCounter = 0;

function nextAddress(): string {
  addressCounter += 1;
  headerState.address = `198.51.100.${addressCounter % 250}`;
  return headerState.address;
}

async function makeOrder(overrides: Record<string, unknown> = {}) {
  return OrderModel.create(orderPayload(overrides));
}

/** Request a code for an existing order and return the code the mock captured. */
async function requestCodeFor(orderReference: string): Promise<string> {
  nextAddress();
  sendMock.mockClear();
  const response = await requestTrackingCodeAction({ reference: orderReference, email: EMAIL });
  expect(response).toEqual({ ok: true });
  expect(sendMock).toHaveBeenCalledTimes(1);
  const input = sendMock.mock.calls[0][0];
  expect(input.to).toBe(EMAIL);
  expect(input.reference).toBe(orderReference);
  return input.code;
}

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  process.env.MONGODB_URI = mongod.getUri("pearl_tracking_test");
  process.env.NOTIFICATION_PROVIDER = "resend";
  process.env.RESEND_API_KEY = "re_test_only_not_a_real_key";
  process.env.EMAIL_FROM = "PEARL Signature <orders@example.test>";
  await connectDatabase();
  await OrderModel.createIndexes();
  await OrderAttemptModel.createIndexes();
  await TrackingChallengeModel.createIndexes();
  await OrderAccessGrantModel.createIndexes();
});

afterEach(() => {
  vi.clearAllMocks();
  sendMock.mockResolvedValue(true);
});

beforeEach(async () => {
  await OrderModel.deleteMany({});
  await OrderAttemptModel.deleteMany({});
  await TrackingChallengeModel.deleteMany({});
  await OrderAccessGrantModel.deleteMany({});
});

afterAll(async () => {
  delete process.env.NOTIFICATION_PROVIDER;
  delete process.env.RESEND_API_KEY;
  delete process.env.EMAIL_FROM;
  await mongoose.disconnect();
  await mongod?.stop();
  mongod = null;
});

/* ── reading an order ───────────────────────────────────────────────── */

describe("loadOrderTrackingAction", () => {
  it("refuses a reference on its own", async () => {
    const order = await makeOrder();
    nextAddress();

    const response = await loadOrderTrackingAction({ reference: order.reference });

    expect(response).toEqual({ ok: false, reason: "not_found" });
  });

  it("refuses a wrong capability with the same answer as a missing order", async () => {
    const order = await makeOrder();
    nextAddress();

    const wrong = await loadOrderTrackingAction({
      reference: order.reference,
      accessKey: randomBytes(32).toString("hex"),
    });
    const missing = await loadOrderTrackingAction({
      reference: reference(),
      accessKey: CONFIRMATION_KEY,
    });

    expect(wrong).toEqual({ ok: false, reason: "not_found" });
    expect(missing).toEqual({ ok: false, reason: "not_found" });
  });

  it("opens the order for the browser that holds the confirmation capability", async () => {
    const order = await makeOrder();
    nextAddress();

    const response = await loadOrderTrackingAction({
      reference: order.reference,
      accessKey: CONFIRMATION_KEY,
    });

    expect(response.ok).toBe(true);
    if (!response.ok) return;
    expect(response.access).toBe("capability");
    expect(response.order.reference).toBe(order.reference);
    expect(response.order.status).toBe("preparing");
    expect(response.order.statusHistory.map((event) => event.to)).toEqual([
      "placed",
      "confirmed",
      "preparing",
    ]);
  });

  it("opens the order on another device with a scoped grant", async () => {
    const order = await makeOrder();
    const code = await requestCodeFor(order.reference);

    nextAddress();
    const verified = await verifyTrackingCodeAction({ reference: order.reference, code });
    expect(verified.ok).toBe(true);
    if (!verified.ok) return;

    nextAddress();
    const response = await loadOrderTrackingAction({
      reference: order.reference,
      grantKey: verified.grantKey,
    });

    expect(response.ok).toBe(true);
    if (!response.ok) return;
    expect(response.access).toBe("grant");
    expect(response.order.reference).toBe(order.reference);
  });

  it("does not accept a grant for a different order", async () => {
    const first = await makeOrder();
    const second = await makeOrder();
    const code = await requestCodeFor(first.reference);

    nextAddress();
    const verified = await verifyTrackingCodeAction({ reference: first.reference, code });
    expect(verified.ok).toBe(true);
    if (!verified.ok) return;

    nextAddress();
    const response = await loadOrderTrackingAction({
      reference: second.reference,
      grantKey: verified.grantKey,
    });

    expect(response).toEqual({ ok: false, reason: "not_found" });
  });

  it("rejects an expired grant", async () => {
    const order = await makeOrder();
    const grantKey = randomBytes(32).toString("base64url");
    await OrderAccessGrantModel.create({
      reference: order.reference,
      orderId: String(order._id),
      tokenHash: sha256(grantKey),
      expiresAt: new Date(Date.now() - 1_000),
      revokedAt: null,
    });

    nextAddress();
    const response = await loadOrderTrackingAction({ reference: order.reference, grantKey });

    expect(response).toEqual({ ok: false, reason: "not_found" });
  });

  it("bounds repeated reads from one address", async () => {
    const order = await makeOrder();
    nextAddress();
    let last: Awaited<ReturnType<typeof loadOrderTrackingAction>> | null = null;
    for (let index = 0; index < 31; index += 1) {
      last = await loadOrderTrackingAction({ reference: order.reference, accessKey: CONFIRMATION_KEY });
    }
    expect(last).toEqual({ ok: false, reason: "rate_limited" });
  });
});

/* ── requesting a code ──────────────────────────────────────────────── */

describe("requestTrackingCodeAction", () => {
  it("answers generically when the pair does not match", async () => {
    const order = await makeOrder();
    nextAddress();

    const response = await requestTrackingCodeAction({ reference: order.reference, email: "someone@example.com" });

    expect(response).toEqual({ ok: true });
    expect(sendMock).not.toHaveBeenCalled();
    expect(await TrackingChallengeModel.countDocuments({})).toBe(0);
  });

  it("answers generically for a reference that does not exist", async () => {
    nextAddress();

    const response = await requestTrackingCodeAction({ reference: reference(), email: EMAIL });

    expect(response).toEqual({ ok: true });
    expect(sendMock).not.toHaveBeenCalled();
  });

  it("answers generically for a malformed request", async () => {
    nextAddress();

    const response = await requestTrackingCodeAction({ reference: "not-a-reference", email: "nope" });

    expect(response).toEqual({ ok: true });
    expect(sendMock).not.toHaveBeenCalled();
  });

  it("emails a six digit code and stores only its hash", async () => {
    const order = await makeOrder();
    const code = await requestCodeFor(order.reference);

    expect(code).toMatch(/^\d{6}$/);
    const challenge = await TrackingChallengeModel.findOne({ reference: order.reference }).lean();
    expect(challenge).not.toBeNull();
    expect(challenge?.codeHash).toMatch(/^[0-9a-f]{64}$/);
    expect(challenge?.codeHash).toBe(sha256(code));
    expect(challenge?.consumedAt).toBeNull();
    expect(challenge?.attempts).toBe(0);
  });

  it("reports recovery as unavailable when email is not configured", async () => {
    const order = await makeOrder();
    const provider = process.env.NOTIFICATION_PROVIDER;
    delete process.env.NOTIFICATION_PROVIDER;
    try {
      nextAddress();
      const response = await requestTrackingCodeAction({ reference: order.reference, email: EMAIL });
      expect(response).toEqual({ ok: false, reason: "unavailable" });
      expect(sendMock).not.toHaveBeenCalled();
    } finally {
      process.env.NOTIFICATION_PROVIDER = provider;
    }
  });

  it("deletes the challenge when the provider does not accept the message", async () => {
    const order = await makeOrder();
    sendMock.mockResolvedValueOnce(false);
    nextAddress();

    const response = await requestTrackingCodeAction({ reference: order.reference, email: EMAIL });

    expect(response).toEqual({ ok: true });
    expect(await TrackingChallengeModel.countDocuments({})).toBe(0);
  });

  it("bounds repeated code requests from one address", async () => {
    const order = await makeOrder();
    nextAddress();
    for (let index = 0; index < 5; index += 1) {
      await requestTrackingCodeAction({ reference: order.reference, email: "no-match@example.com" });
    }
    const blocked = await requestTrackingCodeAction({ reference: order.reference, email: "no-match@example.com" });
    expect(blocked).toEqual({ ok: false, reason: "rate_limited" });
  });
});

/* ── verifying a code ───────────────────────────────────────────────── */

describe("verifyTrackingCodeAction", () => {
  it("issues a single-use grant and stores only its hash", async () => {
    const order = await makeOrder();
    const code = await requestCodeFor(order.reference);

    nextAddress();
    const verified = await verifyTrackingCodeAction({ reference: order.reference, code });
    expect(verified.ok).toBe(true);
    if (!verified.ok) return;
    expect(verified.grantKey).toMatch(/^[A-Za-z0-9_-]{43}$/);

    const grant = await OrderAccessGrantModel.findOne({}).lean();
    expect(grant?.tokenHash).toBe(sha256(verified.grantKey));
    expect(grant?.tokenHash).not.toBe(verified.grantKey);
    expect(JSON.stringify(grant)).not.toContain(verified.grantKey);

    const challenge = await TrackingChallengeModel.findOne({ reference: order.reference }).lean();
    expect(challenge?.consumedAt).toBeInstanceOf(Date);

    // Reuse is refused: the challenge is gone from the verify query.
    nextAddress();
    const reused = await verifyTrackingCodeAction({ reference: order.reference, code });
    expect(reused).toEqual({ ok: false, reason: "invalid" });
  });

  it("rejects a wrong code and counts the attempt", async () => {
    const order = await makeOrder();
    await requestCodeFor(order.reference);

    nextAddress();
    const response = await verifyTrackingCodeAction({ reference: order.reference, code: "000000" });

    expect(response).toEqual({ ok: false, reason: "invalid" });
    const challenge = await TrackingChallengeModel.findOne({ reference: order.reference }).lean();
    expect(challenge?.attempts).toBe(1);
    expect(challenge?.consumedAt).toBeNull();
  });

  it("stops accepting a correct code after the attempt cap", async () => {
    const order = await makeOrder();
    const code = await requestCodeFor(order.reference);

    nextAddress();
    for (let index = 0; index < TRACKING_CODE_MAX_ATTEMPTS; index += 1) {
      const wrong = await verifyTrackingCodeAction({ reference: order.reference, code: "000000" });
      expect(wrong).toEqual({ ok: false, reason: "invalid" });
    }

    nextAddress();
    const correct = await verifyTrackingCodeAction({ reference: order.reference, code });
    expect(correct).toEqual({ ok: false, reason: "invalid" });
  });

  it("rejects an expired challenge", async () => {
    const order = await makeOrder();
    const code = "123456";
    await TrackingChallengeModel.create({
      reference: order.reference,
      codeHash: sha256(code),
      attempts: 0,
      consumedAt: null,
      expiresAt: new Date(Date.now() - 1_000),
    });

    nextAddress();
    const response = await verifyTrackingCodeAction({ reference: order.reference, code });

    expect(response).toEqual({ ok: false, reason: "invalid" });
  });

  it("rejects a code with no challenge", async () => {
    const order = await makeOrder();
    nextAddress();

    const response = await verifyTrackingCodeAction({ reference: order.reference, code: "123456" });

    expect(response).toEqual({ ok: false, reason: "invalid" });
  });

  it("only honours the newest challenge", async () => {
    const order = await makeOrder();
    const firstCode = await requestCodeFor(order.reference);
    const secondCode = await requestCodeFor(order.reference);
    expect(firstCode).not.toBe(secondCode);

    nextAddress();
    const old = await verifyTrackingCodeAction({ reference: order.reference, code: firstCode });
    expect(old).toEqual({ ok: false, reason: "invalid" });

    nextAddress();
    const current = await verifyTrackingCodeAction({ reference: order.reference, code: secondCode });
    expect(current.ok).toBe(true);
  });

  it("reports recovery as unavailable when email is not configured", async () => {
    const provider = process.env.NOTIFICATION_PROVIDER;
    delete process.env.NOTIFICATION_PROVIDER;
    try {
      nextAddress();
      const response = await verifyTrackingCodeAction({ reference: reference(), code: "123456" });
      expect(response).toEqual({ ok: false, reason: "unavailable" });
    } finally {
      process.env.NOTIFICATION_PROVIDER = provider;
    }
  });

  it("bounds repeated submissions from one address", async () => {
    nextAddress();
    for (let index = 0; index < 10; index += 1) {
      await verifyTrackingCodeAction({ reference: reference(), code: "123456" });
    }
    const blocked = await verifyTrackingCodeAction({ reference: reference(), code: "123456" });
    expect(blocked).toEqual({ ok: false, reason: "rate_limited" });
  });
});
