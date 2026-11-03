// @vitest-environment node
import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OTP_MAX_ATTEMPTS, OTP_TTL_MS } from "./constants";
import { otpDigest } from "./otp";

/**
 * Code issuance and verification (Phase 7B).
 *
 * The collection is mocked so the assertions can be exact about what is
 * WRITTEN: a keyed, context-bound digest and never the plaintext code. Every
 * other rule (expiry, single use, attempt cap, resend superseding the previous
 * code, provider failure deleting the challenge, legacy Phase 7 tracking codes)
 * is exercised against the real module.
 */

const SECRET = "s".repeat(32);

const mocks = vi.hoisted(() => {
  function chain(result: unknown) {
    const query = {
      sort: vi.fn(() => query),
      select: vi.fn(() => query),
      lean: vi.fn(async () => result),
    };
    return query;
  }
  return {
    chain,
    connectDatabase: vi.fn(async () => undefined),
    logDatabaseError: vi.fn(),
    findOne: vi.fn(),
    findOneAndUpdate: vi.fn(),
    updateMany: vi.fn(),
    updateOne: vi.fn(),
    create: vi.fn(),
    deleteOne: vi.fn(),
    sendGuestCodeEmail: vi.fn(async (input: { to: string; code: string }) => {
      void input;
      return true;
    }),
    sendTrackingCodeEmail: vi.fn(async () => true),
  };
});

vi.mock("@/lib/db/mongoose", () => ({
  connectDatabase: mocks.connectDatabase,
  logDatabaseError: mocks.logDatabaseError,
}));
vi.mock("@/models/tracking-challenge", () => ({
  TrackingChallengeModel: {
    findOne: mocks.findOne,
    findOneAndUpdate: mocks.findOneAndUpdate,
    updateMany: mocks.updateMany,
    updateOne: mocks.updateOne,
    create: mocks.create,
    deleteOne: mocks.deleteOne,
  },
}));
vi.mock("@/lib/notifications/send-guest-code", () => ({
  sendGuestCodeEmail: mocks.sendGuestCodeEmail,
}));
vi.mock("@/lib/notifications/send-tracking-code", () => ({
  sendTrackingCodeEmail: mocks.sendTrackingCodeEmail,
}));

const { issueEmailCode, verifyEmailCode, verifyTrackingCode } = await import("./challenges");

const NOW = Date.parse("2026-10-31T12:00:00.000Z");
const CHALLENGE_ID = "c".repeat(32);
const EMAIL = "ada@example.com";
const CODE = "123456";

function hmacRow(overrides: Record<string, unknown> = {}) {
  return {
    _id: "challenge-doc",
    challengeId: CHALLENGE_ID,
    email: EMAIL,
    purpose: "checkout",
    reference: null,
    codeHash: otpDigest({
      secret: SECRET,
      challengeId: CHALLENGE_ID,
      email: EMAIL,
      purpose: "checkout",
      code: CODE,
    }),
    digestVersion: "hmac-sha256-v1",
    attempts: 0,
    consumedAt: null,
    lastSentAt: new Date(NOW),
    expiresAt: new Date(NOW + OTP_TTL_MS),
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.GUEST_OTP_SECRET = SECRET;
  process.env.GUEST_OTP_RESEND_COOLDOWN_SECONDS = "0";
  mocks.findOne.mockReturnValue(mocks.chain(null));
  mocks.findOneAndUpdate.mockReturnValue({ lean: async () => ({ _id: "challenge-doc" }) });
  mocks.updateMany.mockResolvedValue({ modifiedCount: 0 });
  mocks.updateOne.mockResolvedValue({ modifiedCount: 1 });
  mocks.create.mockResolvedValue({ _id: "challenge-doc" });
  mocks.deleteOne.mockResolvedValue({ deletedCount: 1 });
  mocks.sendGuestCodeEmail.mockResolvedValue(true);
  mocks.sendTrackingCodeEmail.mockResolvedValue(true);
});

afterEach(() => {
  delete process.env.GUEST_OTP_SECRET;
  delete process.env.GUEST_OTP_RESEND_COOLDOWN_SECONDS;
});

/* ── issuing ────────────────────────────────────────────────────────── */

describe("issueEmailCode", () => {
  it("stores only a keyed, context-bound digest of the emailed code", async () => {
    const result = await issueEmailCode({ email: "  Ada@Example.COM ", purpose: "checkout", now: NOW });
    expect(result).toEqual({ ok: true });

    const created = mocks.create.mock.calls[0][0] as Record<string, unknown>;
    expect(created.email).toBe(EMAIL);
    expect(created.purpose).toBe("checkout");
    expect(created.reference).toBeNull();
    expect(created.digestVersion).toBe("hmac-sha256-v1");
    expect(created.attempts).toBe(0);
    expect(created.consumedAt).toBeNull();
    expect(created.lastSentAt).toEqual(new Date(NOW));
    expect(created.expiresAt).toEqual(new Date(NOW + OTP_TTL_MS));

    const sent = mocks.sendGuestCodeEmail.mock.calls[0][0] as { code: string; to: string };
    expect(sent.to).toBe(EMAIL);
    expect(sent.code).toMatch(/^\d{6}$/);
    expect(created.codeHash).toBe(
      otpDigest({
        secret: SECRET,
        challengeId: created.challengeId as string,
        email: EMAIL,
        purpose: "checkout",
        code: sent.code,
      }),
    );

    // Neither the plaintext code nor a reversible unsalted digest is stored.
    expect(created).not.toHaveProperty("code");
    expect(created.codeHash).not.toBe(sent.code);
    expect(created.codeHash).not.toBe(createHash("sha256").update(sent.code, "utf8").digest("hex"));
  });

  it("fails closed when the digest secret is missing", async () => {
    delete process.env.GUEST_OTP_SECRET;
    const result = await issueEmailCode({ email: EMAIL, purpose: "checkout", now: NOW });
    expect(result).toEqual({ ok: false, reason: "unavailable" });
    expect(mocks.create).not.toHaveBeenCalled();
    expect(mocks.sendGuestCodeEmail).not.toHaveBeenCalled();
  });

  it("requires a reference for a tracking challenge", async () => {
    const result = await issueEmailCode({ email: EMAIL, purpose: "tracking", now: NOW });
    expect(result).toEqual({ ok: false, reason: "unavailable" });
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it("uses the tracking template and stores the reference for tracking", async () => {
    await issueEmailCode({
      email: EMAIL,
      purpose: "tracking",
      reference: "PS-1A2B3C4D5E",
      now: NOW,
    });
    const created = mocks.create.mock.calls[0][0] as Record<string, unknown>;
    expect(created.purpose).toBe("tracking");
    expect(created.reference).toBe("PS-1A2B3C4D5E");
    expect(mocks.sendTrackingCodeEmail).toHaveBeenCalledTimes(1);
    expect(mocks.sendGuestCodeEmail).not.toHaveBeenCalled();
  });

  it("enforces the resend cooldown for the same context", async () => {
    process.env.GUEST_OTP_RESEND_COOLDOWN_SECONDS = "60";
    mocks.findOne.mockReturnValue(mocks.chain({ lastSentAt: new Date(NOW - 30_000) }));

    const result = await issueEmailCode({ email: EMAIL, purpose: "checkout", now: NOW });
    expect(result).toEqual({ ok: false, reason: "cooldown", retryAfterSeconds: 30 });
    expect(mocks.create).not.toHaveBeenCalled();
    expect(mocks.sendGuestCodeEmail).not.toHaveBeenCalled();
  });

  it("supersedes every earlier active challenge for the same context", async () => {
    await issueEmailCode({ email: EMAIL, purpose: "checkout", now: NOW });
    expect(mocks.updateMany).toHaveBeenCalledWith(
      { email: EMAIL, purpose: "checkout", reference: null, consumedAt: null },
      { $set: { consumedAt: new Date(NOW) } },
    );
  });

  it("deletes a challenge the provider refused to accept", async () => {
    mocks.sendGuestCodeEmail.mockResolvedValue(false);
    const result = await issueEmailCode({ email: EMAIL, purpose: "checkout", now: NOW });
    expect(result).toEqual({ ok: false, reason: "send_failed" });
    expect(mocks.deleteOne).toHaveBeenCalledWith({ _id: "challenge-doc" });
  });
});

/* ── verifying ──────────────────────────────────────────────────────── */

describe("verifyEmailCode", () => {
  it("returns invalid when no challenge exists", async () => {
    mocks.findOne.mockReturnValue(mocks.chain(null));
    expect(await verifyEmailCode({ email: EMAIL, purpose: "checkout", code: CODE, now: NOW })).toEqual({
      ok: false,
      reason: "invalid",
    });
  });

  it("refuses a code that was already consumed (single use)", async () => {
    mocks.findOne.mockReturnValue(mocks.chain(hmacRow({ consumedAt: new Date(NOW - 1_000) })));
    expect(await verifyEmailCode({ email: EMAIL, purpose: "checkout", code: CODE, now: NOW })).toEqual({
      ok: false,
      reason: "invalid",
    });
  });

  it("reports expiry only for a code this system issued", async () => {
    mocks.findOne.mockReturnValue(mocks.chain(hmacRow({ expiresAt: new Date(NOW - 1) })));
    expect(await verifyEmailCode({ email: EMAIL, purpose: "checkout", code: CODE, now: NOW })).toEqual({
      ok: false,
      reason: "expired",
    });
  });

  it("stops even a correct code after the attempt cap", async () => {
    mocks.findOne.mockReturnValue(mocks.chain(hmacRow({ attempts: OTP_MAX_ATTEMPTS })));
    expect(await verifyEmailCode({ email: EMAIL, purpose: "checkout", code: CODE, now: NOW })).toEqual({
      ok: false,
      reason: "attempts",
    });
    expect(mocks.findOneAndUpdate).not.toHaveBeenCalled();
  });

  it("counts a wrong submission and answers neutrally", async () => {
    mocks.findOne.mockReturnValue(mocks.chain(hmacRow()));
    expect(await verifyEmailCode({ email: EMAIL, purpose: "checkout", code: "000000", now: NOW })).toEqual({
      ok: false,
      reason: "invalid",
    });
    expect(mocks.updateOne).toHaveBeenCalledWith(
      { _id: "challenge-doc", consumedAt: null },
      { $inc: { attempts: 1 } },
    );
    expect(mocks.findOneAndUpdate).not.toHaveBeenCalled();
  });

  it("consumes a correct code atomically and returns the verified address", async () => {
    mocks.findOne.mockReturnValue(mocks.chain(hmacRow()));
    const result = await verifyEmailCode({
      email: "  Ada@Example.COM ",
      purpose: "checkout",
      code: CODE,
      now: NOW,
    });
    expect(result).toEqual({ ok: true, email: EMAIL });
    expect(mocks.findOneAndUpdate).toHaveBeenCalledWith(
      {
        _id: "challenge-doc",
        consumedAt: null,
        expiresAt: { $gt: new Date(NOW) },
        attempts: { $lt: OTP_MAX_ATTEMPTS },
      },
      { $set: { consumedAt: new Date(NOW) } },
      { returnDocument: "before" },
    );
  });

  it("fails closed when the digest secret is missing for an HMAC challenge", async () => {
    delete process.env.GUEST_OTP_SECRET;
    mocks.findOne.mockReturnValue(mocks.chain(hmacRow()));
    expect(await verifyEmailCode({ email: EMAIL, purpose: "checkout", code: CODE, now: NOW })).toEqual({
      ok: false,
      reason: "unavailable",
    });
    expect(mocks.findOneAndUpdate).not.toHaveBeenCalled();
  });

  it("reports invalid when the atomic consume loses a race", async () => {
    mocks.findOne.mockReturnValue(mocks.chain(hmacRow()));
    mocks.findOneAndUpdate.mockReturnValue({ lean: async () => null });
    expect(await verifyEmailCode({ email: EMAIL, purpose: "checkout", code: CODE, now: NOW })).toEqual({
      ok: false,
      reason: "invalid",
    });
  });
});

/* ── legacy tracking codes ──────────────────────────────────────────── */

describe("verifyTrackingCode", () => {
  it("reads the address from the challenge, never from the client", async () => {
    mocks.findOne.mockReturnValue(
      mocks.chain(
        hmacRow({
          purpose: "tracking",
          reference: "PS-1A2B3C4D5E",
          codeHash: otpDigest({
            secret: SECRET,
            challengeId: CHALLENGE_ID,
            email: EMAIL,
            purpose: "tracking",
            code: CODE,
          }),
        }),
      ),
    );
    const result = await verifyTrackingCode({ reference: "PS-1A2B3C4D5E", code: CODE, now: NOW });
    expect(result).toEqual({ ok: true, email: EMAIL });
  });

  it("accepts a Phase 7 row that predates the HMAC upgrade", async () => {
    mocks.findOne.mockReturnValue(
      mocks.chain({
        _id: "legacy-doc",
        email: EMAIL,
        reference: "PS-1A2B3C4D5E",
        codeHash: createHash("sha256").update(CODE, "utf8").digest("hex"),
        attempts: 0,
        consumedAt: null,
        expiresAt: new Date(NOW + OTP_TTL_MS),
      }),
    );
    const result = await verifyTrackingCode({ reference: "PS-1A2B3C4D5E", code: CODE, now: NOW });
    expect(result).toEqual({ ok: true, email: EMAIL });
  });

  it("refuses a legacy row with no email: a capability alone is not an identity", async () => {
    mocks.findOne.mockReturnValue(
      mocks.chain({
        _id: "legacy-doc",
        email: "",
        reference: "PS-1A2B3C4D5E",
        codeHash: createHash("sha256").update(CODE, "utf8").digest("hex"),
        attempts: 0,
        consumedAt: null,
        expiresAt: new Date(NOW + OTP_TTL_MS),
      }),
    );
    const result = await verifyTrackingCode({ reference: "PS-1A2B3C4D5E", code: CODE, now: NOW });
    expect(result).toEqual({ ok: false, reason: "invalid" });
    expect(mocks.findOneAndUpdate).not.toHaveBeenCalled();
  });

  it("stops after the attempt cap", async () => {
    mocks.findOne.mockReturnValue(mocks.chain(hmacRow({ attempts: OTP_MAX_ATTEMPTS })));
    expect(await verifyTrackingCode({ reference: "PS-1A2B3C4D5E", code: CODE, now: NOW })).toEqual({
      ok: false,
      reason: "attempts",
    });
  });
});
