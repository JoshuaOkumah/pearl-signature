// @vitest-environment node
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { generateOtp, hexDigestEqual, legacyOtpDigest, otpDigest } from "./otp";
import {
  checkoutVerificationTtlMs,
  guestSessionTtlMs,
  isCheckoutVerificationFresh,
  maskEmail,
  normalizeEmail,
  otpResendCooldownMs,
} from "./policy";

/**
 * One-time code and guest policy rules (Phase 7B).
 *
 * These are the properties a database leak or a hostile browser must not be
 * able to break: the digest is keyed and context-bound, comparison is
 * constant-time, and freshness/lifetime values are bounded. The tests are pure
 * because the rules are pure; the database-backed issuance path has its own
 * suite in `challenges.test.ts`.
 */

const SECRET = "a".repeat(32);

describe("generateOtp", () => {
  it("always produces exactly six digits, including leading zeroes", () => {
    for (let i = 0; i < 2_000; i += 1) {
      expect(generateOtp()).toMatch(/^\d{6}$/);
    }
  });

  it("does not return one repeated value", () => {
    const codes = new Set(Array.from({ length: 50 }, () => generateOtp()));
    expect(codes.size).toBeGreaterThan(1);
  });
});

describe("otpDigest", () => {
  const base = {
    secret: SECRET,
    challengeId: "c".repeat(32),
    email: "ada@example.com",
    purpose: "checkout" as const,
    code: "123456",
  };

  it("is a 64-character lowercase hex digest", () => {
    expect(otpDigest(base)).toMatch(/^[0-9a-f]{64}$/);
  });

  it("is stable for identical context", () => {
    expect(otpDigest(base)).toBe(otpDigest({ ...base }));
  });

  it("binds the digest to the challenge, email, purpose, code and secret", () => {
    const digest = otpDigest(base);
    expect(otpDigest({ ...base, challengeId: "d".repeat(32) })).not.toBe(digest);
    expect(otpDigest({ ...base, email: "other@example.com" })).not.toBe(digest);
    expect(otpDigest({ ...base, purpose: "recovery" })).not.toBe(digest);
    expect(otpDigest({ ...base, code: "654321" })).not.toBe(digest);
    expect(otpDigest({ ...base, secret: "b".repeat(32) })).not.toBe(digest);
  });

  it("normalises the address so case and padding cannot split an identity", () => {
    expect(otpDigest({ ...base, email: "  ADA@Example.com " })).toBe(otpDigest(base));
  });

  it("never contains the plaintext code", () => {
    expect(otpDigest(base)).not.toContain(base.code);
  });

  it("differs from an unsalted sha256 of the same code", () => {
    // The whole point of the HMAC: a leaked row cannot be reversed by hashing
    // the million possible codes offline.
    expect(otpDigest(base)).not.toBe(createHash("sha256").update(base.code).digest("hex"));
  });
});

describe("legacyOtpDigest", () => {
  it("keeps Phase 7 tracking codes verifiable", () => {
    expect(legacyOtpDigest("123456")).toBe(
      createHash("sha256").update("123456", "utf8").digest("hex"),
    );
  });
});

describe("hexDigestEqual", () => {
  const left = "a".repeat(64);

  it("accepts identical digests regardless of case", () => {
    expect(hexDigestEqual(left, left.toUpperCase())).toBe(true);
  });

  it("rejects a different digest of the same length", () => {
    expect(hexDigestEqual(left, "b".repeat(64))).toBe(false);
  });

  it("rejects anything that is not a 64-character hex digest", () => {
    expect(hexDigestEqual(left, "short")).toBe(false);
    expect(hexDigestEqual(left, "z".repeat(64))).toBe(false);
    expect(hexDigestEqual("", "")).toBe(false);
  });
});

describe("identity display helpers", () => {
  it("canonicalises an address without altering the mailbox", () => {
    expect(normalizeEmail("  Ada.Obi@Example.COM ")).toBe("ada.obi@example.com");
  });

  it("masks all but the first local character", () => {
    expect(maskEmail("ada.obi@example.com")).toBe("a***@example.com");
    expect(maskEmail("x@y.test")).toBe("x***@y.test");
  });

  it("never returns a malformed address in full", () => {
    expect(maskEmail("not-an-address")).toBe("***");
    expect(maskEmail("@example.com")).toBe("***");
  });
});

describe("guest policy lifetimes", () => {
  /** `NodeJS.ProcessEnv` requires NODE_ENV in this project's typing. */
  const env = (values: Record<string, string> = {}): NodeJS.ProcessEnv =>
    values as NodeJS.ProcessEnv;

  it("defaults to a 30-day remembered device", () => {
    expect(guestSessionTtlMs(env())).toBe(30 * 24 * 60 * 60 * 1_000);
  });

  it("honours a bounded operator override and ignores nonsense", () => {
    expect(guestSessionTtlMs(env({ GUEST_SESSION_TTL_DAYS: "7" }))).toBe(7 * 24 * 60 * 60 * 1_000);
    expect(guestSessionTtlMs(env({ GUEST_SESSION_TTL_DAYS: "0" }))).toBe(30 * 24 * 60 * 60 * 1_000);
    expect(guestSessionTtlMs(env({ GUEST_SESSION_TTL_DAYS: "366" }))).toBe(30 * 24 * 60 * 60 * 1_000);
    expect(guestSessionTtlMs(env({ GUEST_SESSION_TTL_DAYS: "soon" }))).toBe(30 * 24 * 60 * 60 * 1_000);
  });

  it("defaults checkout freshness to 30 minutes and bounds the override", () => {
    expect(checkoutVerificationTtlMs(env())).toBe(30 * 60 * 1_000);
    expect(checkoutVerificationTtlMs(env({ GUEST_CHECKOUT_VERIFICATION_MINUTES: "5" }))).toBe(5 * 60 * 1_000);
    expect(checkoutVerificationTtlMs(env({ GUEST_CHECKOUT_VERIFICATION_MINUTES: "121" }))).toBe(30 * 60 * 1_000);
  });

  it("defaults the resend cooldown to 60 seconds and allows a test override of 0", () => {
    expect(otpResendCooldownMs(env())).toBe(60_000);
    expect(otpResendCooldownMs(env({ GUEST_OTP_RESEND_COOLDOWN_SECONDS: "0" }))).toBe(0);
    expect(otpResendCooldownMs(env({ GUEST_OTP_RESEND_COOLDOWN_SECONDS: "-1" }))).toBe(60_000);
    expect(otpResendCooldownMs(env({ GUEST_OTP_RESEND_COOLDOWN_SECONDS: "301" }))).toBe(60_000);
  });
});

describe("isCheckoutVerificationFresh", () => {
  const now = Date.parse("2026-10-31T12:00:00.000Z");

  it("accepts a verification exactly at the limit", () => {
    expect(isCheckoutVerificationFresh({ verifiedAt: new Date(now - 30 * 60 * 1_000) }, now)).toBe(true);
  });

  it("rejects a verification one millisecond past the limit", () => {
    expect(isCheckoutVerificationFresh({ verifiedAt: new Date(now - 30 * 60 * 1_000 - 1) }, now)).toBe(
      false,
    );
  });
});
