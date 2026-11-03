// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Guest verification actions (Phase 7B).
 *
 * These are the public endpoints a browser can call, so the tests focus on what
 * an attacker must NOT be able to learn or do: recovery never confirms that an
 * address has orders, My Orders derives the query from the session identity
 * rather than the request body, and every verification rotates the remembered
 * device to the address that was actually proved.
 */

const mocks = vi.hoisted(() => {
  function orderQuery(result: unknown) {
    const query = {
      sort: vi.fn(() => query),
      skip: vi.fn(() => query),
      limit: vi.fn(() => query),
      select: vi.fn(() => query),
      lean: vi.fn(async () => result),
    };
    return query;
  }
  return {
    orderQuery,
    headers: vi.fn(async () => new Headers({ "x-forwarded-for": "203.0.113.5" })),
    connectDatabase: vi.fn(async () => undefined),
    logDatabaseError: vi.fn(),
    issueEmailCode: vi.fn(),
    verifyEmailCode: vi.fn(),
    readiness: vi.fn(() => ({
      ready: true,
      reason: "ready",
      emailConfigured: true,
      otpSecretConfigured: true,
    })),
    getGuestIdentity: vi.fn(),
    hashClientAddress: vi.fn(() => "ip-hash"),
    revokeCurrentGuestSession: vi.fn(async () => true),
    rotateGuestSession: vi.fn(),
    readGuestSessionState: vi.fn(),
    consumeOrderRateLimit: vi.fn(async () => ({ allowed: true })),
    orderFind: vi.fn(),
    orderAggregate: vi.fn(),
  };
});

vi.mock("next/headers", () => ({ headers: mocks.headers }));
vi.mock("@/lib/db/mongoose", () => ({
  connectDatabase: mocks.connectDatabase,
  logDatabaseError: mocks.logDatabaseError,
}));
vi.mock("@/lib/guest/challenges", () => ({
  issueEmailCode: mocks.issueEmailCode,
  verifyEmailCode: mocks.verifyEmailCode,
}));
vi.mock("@/lib/guest/readiness", () => ({ guestVerificationReadiness: mocks.readiness }));
vi.mock("@/lib/guest/session", () => ({
  getGuestIdentity: mocks.getGuestIdentity,
  hashClientAddress: mocks.hashClientAddress,
  revokeCurrentGuestSession: mocks.revokeCurrentGuestSession,
  rotateGuestSession: mocks.rotateGuestSession,
}));
vi.mock("@/lib/guest/state", () => ({ readGuestSessionState: mocks.readGuestSessionState }));
vi.mock("@/lib/orders/rate-limit", () => ({ consumeOrderRateLimit: mocks.consumeOrderRateLimit }));
vi.mock("@/models/order", () => ({
  OrderModel: { find: mocks.orderFind, aggregate: mocks.orderAggregate },
}));

const {
  forgetGuestDeviceAction,
  loadMyOrdersAction,
  requestCheckoutCodeAction,
  requestRecoveryCodeAction,
  verifyCheckoutCodeAction,
  verifyRecoveryCodeAction,
} = await import("./guest-verification");

const { MY_ORDERS_PAGE_SIZE } = await import("@/lib/guest/constants");

const IDENTITY = {
  sessionId: "session-id",
  email: "ada@example.com",
  verifiedAt: new Date("2026-10-31T11:50:00.000Z"),
  expiresAt: new Date("2026-11-30T11:50:00.000Z"),
};

const EMPTY_STATE = {
  authenticated: false,
  email: null,
  verifiedAtIso: null,
  sessionExpiresAtIso: null,
  checkoutFresh: false,
  verificationAvailable: true,
};

function orderRow(overrides: Record<string, unknown> = {}) {
  return {
    reference: "PS-1A2B3C4D5E",
    status: "preparing",
    createdAt: new Date("2026-10-31T11:00:00.000Z"),
    customer: { email: IDENTITY.email },
    fulfillment: { method: "delivery" },
    payment: { method: "cash_on_arrival", status: "unpaid" },
    money: { totalCents: 2_113 },
    items: [{ name: "Synthetic Jollof", quantity: 2 }],
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.consumeOrderRateLimit.mockResolvedValue({ allowed: true });
  mocks.readiness.mockReturnValue({
    ready: true,
    reason: "ready",
    emailConfigured: true,
    otpSecretConfigured: true,
  });
  mocks.issueEmailCode.mockResolvedValue({ ok: true });
  mocks.getGuestIdentity.mockResolvedValue(IDENTITY);
  mocks.revokeCurrentGuestSession.mockResolvedValue(true);
  mocks.readGuestSessionState.mockResolvedValue(EMPTY_STATE);
  mocks.orderFind.mockReturnValue(mocks.orderQuery([]));
  mocks.orderAggregate.mockResolvedValue([]);
});

/* ── checkout code requests ─────────────────────────────────────────── */

describe("requestCheckoutCodeAction", () => {
  it("reports a cooldown honestly because the customer knows they asked", async () => {
    mocks.issueEmailCode.mockResolvedValue({ ok: false, reason: "cooldown", retryAfterSeconds: 42 });
    expect(await requestCheckoutCodeAction({ email: "ada@example.com" })).toEqual({
      ok: false,
      reason: "cooldown",
      retryAfterSeconds: 42,
    });
  });

  it("fails closed when verification cannot be delivered", async () => {
    mocks.readiness.mockReturnValue({
      ready: false,
      reason: "missing_otp_secret",
      emailConfigured: true,
      otpSecretConfigured: false,
    });
    expect(await requestCheckoutCodeAction({ email: "ada@example.com" })).toEqual({
      ok: false,
      reason: "unavailable",
    });
    expect(mocks.issueEmailCode).not.toHaveBeenCalled();
  });

  it("rejects a malformed address before issuing anything", async () => {
    expect(await requestCheckoutCodeAction({ email: "not-an-address" })).toEqual({
      ok: false,
      reason: "invalid",
    });
    expect(mocks.issueEmailCode).not.toHaveBeenCalled();
  });

  it("rate limits the client address", async () => {
    mocks.consumeOrderRateLimit.mockResolvedValue({ allowed: false });
    const response = await requestCheckoutCodeAction({ email: "ada@example.com" });
    expect(response.ok).toBe(false);
    expect(!response.ok && response.reason).toBe("rate_limited");
  });

  it("rate limits per email identity as well", async () => {
    mocks.consumeOrderRateLimit
      .mockResolvedValueOnce({ allowed: true })
      .mockResolvedValueOnce({ allowed: false });
    const response = await requestCheckoutCodeAction({ email: "ada@example.com" });
    expect(!response.ok && response.reason).toBe("rate_limited");
    expect(mocks.issueEmailCode).not.toHaveBeenCalled();
  });

  it("issues a checkout code for a valid address", async () => {
    expect(await requestCheckoutCodeAction({ email: "  Ada@Example.COM " })).toEqual({ ok: true });
    expect(mocks.issueEmailCode).toHaveBeenCalledWith(
      expect.objectContaining({ email: "ada@example.com", purpose: "checkout" }),
    );
  });
});

/* ── email-only recovery ────────────────────────────────────────────── */

describe("requestRecoveryCodeAction", () => {
  it("returns the same generic success when the provider refuses to send", async () => {
    mocks.issueEmailCode.mockResolvedValue({ ok: false, reason: "send_failed" });
    expect(await requestRecoveryCodeAction({ email: "nobody@example.com" })).toEqual({ ok: true });
  });

  it("hides a cooldown instead of confirming a recent request", async () => {
    mocks.issueEmailCode.mockResolvedValue({ ok: false, reason: "cooldown", retryAfterSeconds: 30 });
    expect(await requestRecoveryCodeAction({ email: "ada@example.com" })).toEqual({ ok: true });
  });

  it("still answers success when the per-email budget is exhausted", async () => {
    mocks.consumeOrderRateLimit
      .mockResolvedValueOnce({ allowed: true })
      .mockResolvedValueOnce({ allowed: false });
    expect(await requestRecoveryCodeAction({ email: "ada@example.com" })).toEqual({ ok: true });
    expect(mocks.issueEmailCode).not.toHaveBeenCalled();
  });

  it("issues a recovery code for any valid address, with or without orders", async () => {
    await requestRecoveryCodeAction({ email: "no-history@example.com" });
    expect(mocks.issueEmailCode).toHaveBeenCalledWith(
      expect.objectContaining({ email: "no-history@example.com", purpose: "recovery" }),
    );
  });
});

/* ── verifying codes ────────────────────────────────────────────────── */

describe("verifyRecoveryCodeAction", () => {
  it("rotates the remembered device to the verified address", async () => {
    mocks.verifyEmailCode.mockResolvedValue({ ok: true, email: "ada@example.com" });
    mocks.rotateGuestSession.mockResolvedValue({
      identity: IDENTITY,
      token: "token-not-returned",
    });

    const response = await verifyRecoveryCodeAction({ email: "ada@example.com", code: "123456" });
    expect(response).toEqual({
      ok: true,
      email: "ada@example.com",
      verifiedAtIso: IDENTITY.verifiedAt.toISOString(),
      sessionExpiresAtIso: IDENTITY.expiresAt.toISOString(),
    });
    expect(mocks.rotateGuestSession).toHaveBeenCalledWith("ada@example.com", "ip-hash", expect.any(Number));
  });

  it("never rotates on a wrong, expired or exhausted code", async () => {
    for (const reason of ["invalid", "expired", "attempts"] as const) {
      mocks.verifyEmailCode.mockResolvedValue({ ok: false, reason });
      expect(await verifyRecoveryCodeAction({ email: "ada@example.com", code: "000000" })).toEqual({
        ok: false,
        reason,
      });
    }
    expect(mocks.rotateGuestSession).not.toHaveBeenCalled();
  });

  it("does not touch the verifier when the client address is rate limited", async () => {
    mocks.consumeOrderRateLimit.mockResolvedValue({ allowed: false });
    expect(await verifyRecoveryCodeAction({ email: "ada@example.com", code: "123456" })).toEqual({
      ok: false,
      reason: "rate_limited",
    });
    expect(mocks.verifyEmailCode).not.toHaveBeenCalled();
  });

  it("rejects a malformed code before any verification work", async () => {
    expect(await verifyRecoveryCodeAction({ email: "ada@example.com", code: "12345" })).toEqual({
      ok: false,
      reason: "invalid",
    });
    expect(mocks.verifyEmailCode).not.toHaveBeenCalled();
  });

  it("uses the checkout purpose for checkout verification", async () => {
    mocks.verifyEmailCode.mockResolvedValue({ ok: false, reason: "invalid" });
    await verifyCheckoutCodeAction({ email: "ada@example.com", code: "123456" });
    expect(mocks.verifyEmailCode).toHaveBeenCalledWith(
      expect.objectContaining({ purpose: "checkout", code: "123456" }),
    );
  });
});

/* ── Forget This Device ─────────────────────────────────────────────── */

describe("forgetGuestDeviceAction", () => {
  it("revokes server-side before reporting the empty state", async () => {
    const state = await forgetGuestDeviceAction();
    expect(mocks.revokeCurrentGuestSession).toHaveBeenCalledTimes(1);
    expect(mocks.readGuestSessionState).toHaveBeenCalledTimes(1);
    expect(state).toEqual(EMPTY_STATE);
  });
});

/* ── My Orders ──────────────────────────────────────────────────────── */

describe("loadMyOrdersAction", () => {
  it("refuses without a live remembered device and reads nothing", async () => {
    mocks.getGuestIdentity.mockResolvedValue(null);
    expect(await loadMyOrdersAction({ page: 1 })).toEqual({
      ok: false,
      reason: "unauthenticated",
    });
    expect(mocks.orderFind).not.toHaveBeenCalled();
  });

  it("derives the query from the verified email, ignoring any client-supplied identity", async () => {
    await loadMyOrdersAction({ page: 1, email: "attacker@example.com", reference: "PS-FFFFFFFFFFFF" });
    expect(mocks.orderFind).toHaveBeenCalledWith({ "customer.email": "ada@example.com" });
    expect(mocks.orderAggregate).toHaveBeenCalledWith([
      { $match: { "customer.email": "ada@example.com" } },
      { $group: { _id: "$status", count: { $sum: 1 } } },
    ]);
  });

  it("paginates on the server with a bounded page size", async () => {
    const query = mocks.orderQuery([]);
    mocks.orderFind.mockReturnValue(query);

    await loadMyOrdersAction({ page: 3 });
    expect(query.skip).toHaveBeenCalledWith(2 * MY_ORDERS_PAGE_SIZE);
    expect(query.limit).toHaveBeenCalledWith(MY_ORDERS_PAGE_SIZE + 1);
  });

  it("reports more pages without leaking the extra row", async () => {
    const rows = Array.from({ length: MY_ORDERS_PAGE_SIZE + 1 }, (_, index) =>
      orderRow({ reference: `PS-000000000${index}` }),
    );
    mocks.orderFind.mockReturnValue(mocks.orderQuery(rows));
    mocks.orderAggregate.mockResolvedValue([
      { _id: "preparing", count: 2 },
      { _id: "completed", count: 1 },
      { _id: "cancelled", count: 1 },
    ]);

    const response = await loadMyOrdersAction({ page: 1 });
    expect(response.ok).toBe(true);
    if (!response.ok) return;
    expect(response.data.hasMore).toBe(true);
    expect(response.data.orders).toHaveLength(MY_ORDERS_PAGE_SIZE);
    expect(response.data.counts).toEqual({ active: 2, completed: 1, cancelled: 1, total: 4 });
    expect(response.data.emailMasked).toBe("a***@example.com");
  });

  it("summarises one order without exposing another customer's data", async () => {
    mocks.orderFind.mockReturnValue(mocks.orderQuery([orderRow()]));
    mocks.orderAggregate.mockResolvedValue([{ _id: "preparing", count: 1 }]);

    const response = await loadMyOrdersAction({ page: 1 });
    expect(response.ok).toBe(true);
    if (!response.ok) return;
    expect(response.data.orders[0]).toEqual({
      reference: "PS-1A2B3C4D5E",
      status: "preparing",
      placedAtIso: "2026-10-31T11:00:00.000Z",
      itemsSummary: "Synthetic Jollof x2",
      itemCount: 2,
      paymentMethod: "cash_on_arrival",
      paymentStatus: "unpaid",
      totalCents: 2_113,
      fulfillmentMethod: "delivery",
    });
  });

  it("reports an unavailable database without inventing an empty history", async () => {
    mocks.orderFind.mockImplementation(() => {
      throw new Error("down");
    });
    expect(await loadMyOrdersAction({ page: 1 })).toEqual({ ok: false, reason: "unavailable" });
  });

  it("rate limits history reads by client address", async () => {
    mocks.consumeOrderRateLimit.mockResolvedValue({ allowed: false });
    expect(await loadMyOrdersAction({ page: 1 })).toEqual({ ok: false, reason: "rate_limited" });
    expect(mocks.orderFind).not.toHaveBeenCalled();
  });
});
