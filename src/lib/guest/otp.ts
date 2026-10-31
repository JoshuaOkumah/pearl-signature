import { createHash, createHmac, randomInt, timingSafeEqual } from "node:crypto";
import type { GuestCodePurpose } from "./constants";
import { normalizeEmail } from "./policy";

/**
 * One-time code generation and digesting (Phase 7B).
 *
 * ## Why HMAC
 *
 * A six-digit code has one million possible values. A plain unsalted sha256 of
 * that space is reversible offline in milliseconds, so a database leak would
 * hand an attacker every live code. The digest here is keyed by a server-only
 * secret and bound to the challenge context, so a leaked row is useless without
 * the secret and cannot be replayed against another challenge.
 *
 * ## Randomness
 *
 * `randomInt` uses the platform CSPRNG. `Math.random()` must never appear in
 * this file or any caller.
 */

/** A uniformly random six-digit code, including leading zeroes. */
export function generateOtp(): string {
  return randomInt(0, 1_000_000).toString().padStart(6, "0");
}

export { normalizeEmail };

/** Context-bound HMAC-SHA-256 digest of a code. */
export function otpDigest(input: {
  secret: string;
  challengeId: string;
  email: string;
  purpose: GuestCodePurpose;
  code: string;
}): string {
  return createHmac("sha256", input.secret)
    .update(
      [input.challengeId, normalizeEmail(input.email), input.purpose, input.code].join(":"),
      "utf8",
    )
    .digest("hex");
}

/** The Phase 7 digest, kept only to verify a code issued before this upgrade. */
export function legacyOtpDigest(code: string): string {
  return createHash("sha256").update(code, "utf8").digest("hex");
}

/** Constant-time comparison for equal-length lowercase hex digests. */
export function hexDigestEqual(a: string, b: string): boolean {
  if (!/^[0-9a-f]{64}$/i.test(a) || !/^[0-9a-f]{64}$/i.test(b)) return false;
  const left = Buffer.from(a, "hex");
  const right = Buffer.from(b, "hex");
  return left.length === right.length && timingSafeEqual(left, right);
}
