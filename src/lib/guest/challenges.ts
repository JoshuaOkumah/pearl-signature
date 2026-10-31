import "server-only";
import { randomBytes } from "node:crypto";
import { connectDatabase, logDatabaseError } from "@/lib/db/mongoose";
import {
  OTP_MAX_ATTEMPTS,
  OTP_TTL_MINUTES,
  OTP_TTL_MS,
  type GuestCodePurpose,
} from "./constants";
import { generateOtp, legacyOtpDigest, normalizeEmail, otpDigest, hexDigestEqual } from "./otp";
import { otpResendCooldownMs } from "./policy";
import { otpSecret } from "./readiness";
import { sendGuestCodeEmail } from "@/lib/notifications/send-guest-code";
import { sendTrackingCodeEmail } from "@/lib/notifications/send-tracking-code";
import {
  TrackingChallengeModel,
  type TrackingChallengeRecord,
} from "@/models/tracking-challenge";

/**
 * Issue and verify email codes (Phase 7B).
 *
 * The challenge collection is the single source of truth for every purpose:
 * checkout, recovery, order email change and order-specific tracking. Legacy
 * Phase 7 tracking rows (no `purpose`, no `challengeId`, sha256 digest) remain
 * verifiable through the tracking path, so an outstanding code is not broken by
 * the upgrade.
 *
 * ## Why the tracking verifier does not need the email
 *
 * A tracking challenge stores the email it was issued to, and the HMAC binds
 * that email into the digest. The verifier reads the challenge by reference and
 * re-derives the digest from the stored address, so the client never has to
 * resend an address it already proved, and a challenge cannot be replayed
 * against a different email.
 */

export type IssueCodeResult =
  | { ok: true }
  | { ok: false; reason: "unavailable" | "cooldown" | "send_failed"; retryAfterSeconds?: number };

export type VerifyCodeResult =
  | { ok: true; email: string }
  | { ok: false; reason: "invalid" | "expired" | "attempts" | "unavailable" };

/** The filter for a purpose-scoped challenge in a known context. */
function challengeFilter(input: {
  email: string;
  purpose: GuestCodePurpose;
  reference: string | null;
}) {
  return {
    email: normalizeEmail(input.email),
    purpose: input.purpose,
    reference: input.reference,
  };
}

/**
 * Issue a new code and invalidate every earlier active challenge for the same
 * context. Returns success only after the provider accepted the message.
 */
export async function issueEmailCode(input: {
  email: string;
  purpose: GuestCodePurpose;
  reference?: string | null;
  now?: number;
}): Promise<IssueCodeResult> {
  const now = input.now ?? Date.now();
  const email = normalizeEmail(input.email);
  const reference = input.purpose === "tracking" ? (input.reference ?? null) : null;
  if (input.purpose === "tracking" && !reference) return { ok: false, reason: "unavailable" };

  const secret = otpSecret();
  if (!secret) return { ok: false, reason: "unavailable" };

  try {
    await connectDatabase();
    const filter = challengeFilter({ email, purpose: input.purpose, reference });

    const latest = await TrackingChallengeModel.findOne(filter)
      .sort({ createdAt: -1, _id: -1 })
      .select({ lastSentAt: 1 })
      .lean();

    const cooldown = otpResendCooldownMs();
    const lastSentAt = latest?.lastSentAt?.getTime() ?? null;
    if (lastSentAt !== null && now - lastSentAt < cooldown) {
      return {
        ok: false,
        reason: "cooldown",
        retryAfterSeconds: Math.max(1, Math.ceil((cooldown - (now - lastSentAt)) / 1_000)),
      };
    }

    // A resend supersedes every earlier code: none may remain verifiable.
    await TrackingChallengeModel.updateMany(
      { ...filter, consumedAt: null },
      { $set: { consumedAt: new Date(now) } },
    );

    const challengeId = randomBytes(16).toString("hex");
    const code = generateOtp();
    const digest = otpDigest({ secret, challengeId, email, purpose: input.purpose, code });

    const challenge = await TrackingChallengeModel.create({
      challengeId,
      email,
      purpose: input.purpose,
      reference,
      codeHash: digest,
      digestVersion: "hmac-sha256-v1",
      attempts: 0,
      consumedAt: null,
      lastSentAt: new Date(now),
      expiresAt: new Date(now + OTP_TTL_MS),
    });

    const sent =
      input.purpose === "tracking"
        ? await sendTrackingCodeEmail({
            to: email,
            code,
            reference: reference!,
            challengeId,
            expiresMinutes: OTP_TTL_MINUTES,
          })
        : await sendGuestCodeEmail({
            to: email,
            code,
            purpose: input.purpose,
            challengeId,
            expiresMinutes: OTP_TTL_MINUTES,
          });

    if (!sent) {
      // The customer never received this code, so it must not stay valid.
      await TrackingChallengeModel.deleteOne({ _id: challenge._id });
      return { ok: false, reason: "send_failed" };
    }

    return { ok: true };
  } catch (error) {
    logDatabaseError("email-code-issue", error);
    return { ok: false, reason: "unavailable" };
  }
}

/** The digest a stored challenge expects, honouring the legacy Phase 7 format. */
function expectedDigest(
  challenge: TrackingChallengeRecord,
  code: string,
  email: string,
  purpose: GuestCodePurpose,
  secret: string | null,
): string | null {
  if (
    challenge.digestVersion === "hmac-sha256-v1" &&
    challenge.challengeId &&
    email
  ) {
    if (!secret) return null;
    return otpDigest({
      secret,
      challengeId: challenge.challengeId,
      email,
      purpose,
      code,
    });
  }
  return legacyOtpDigest(code);
}

/** Count a wrong submission, then answer with the single neutral reason. */
async function recordWrongAttempt(challengeId: unknown): Promise<void> {
  await TrackingChallengeModel.updateOne(
    { _id: challengeId, consumedAt: null },
    { $inc: { attempts: 1 } },
  );
}

/**
 * Verify and atomically consume a code for a context the caller names.
 *
 * Used by checkout and recovery, where the address is part of the request.
 * `expired` is reported only for a code this system issued; a missing challenge
 * and a wrong code stay indistinguishable as `invalid`.
 */
export async function verifyEmailCode(input: {
  email: string;
  purpose: GuestCodePurpose;
  reference?: string | null;
  code: string;
  now?: number;
}): Promise<VerifyCodeResult> {
  const now = input.now ?? Date.now();
  const email = normalizeEmail(input.email);
  const reference = input.purpose === "tracking" ? (input.reference ?? null) : null;
  const secret = otpSecret();

  try {
    await connectDatabase();
    const at = new Date(now);
    const challenge = (await TrackingChallengeModel.findOne(
      challengeFilter({ email, purpose: input.purpose, reference }),
    )
      .sort({ createdAt: -1, _id: -1 })
      .lean()) as TrackingChallengeRecord | null;

    if (!challenge) return { ok: false, reason: "invalid" };
    if (challenge.consumedAt) return { ok: false, reason: "invalid" };
    if (!challenge.expiresAt || challenge.expiresAt.getTime() <= now) {
      return { ok: false, reason: "expired" };
    }
    if (challenge.attempts >= OTP_MAX_ATTEMPTS) return { ok: false, reason: "attempts" };

    const expected = expectedDigest(challenge, input.code, email, input.purpose, secret);
    if (!expected) return { ok: false, reason: "unavailable" };
    if (!hexDigestEqual(expected, challenge.codeHash)) {
      await recordWrongAttempt(challenge._id);
      return { ok: false, reason: "invalid" };
    }

    const consumed = await TrackingChallengeModel.findOneAndUpdate(
      {
        _id: challenge._id,
        consumedAt: null,
        expiresAt: { $gt: at },
        attempts: { $lt: OTP_MAX_ATTEMPTS },
      },
      { $set: { consumedAt: at } },
      { returnDocument: "before" },
    ).lean();

    return consumed ? { ok: true, email } : { ok: false, reason: "invalid" };
  } catch (error) {
    logDatabaseError("email-code-verify", error);
    return { ok: false, reason: "unavailable" };
  }
}

/**
 * Verify an order-tracking code by reference.
 *
 * Reads the address from the challenge itself (never from the client), so the
 * HMAC is re-derived exactly as it was issued. A Phase 7 code written before
 * the HMAC upgrade is still accepted through its legacy sha256 digest, because
 * the alternative would silently invalidate a code the customer is holding.
 */
export async function verifyTrackingCode(input: {
  reference: string;
  code: string;
  now?: number;
}): Promise<VerifyCodeResult> {
  const now = input.now ?? Date.now();
  const secret = otpSecret();

  try {
    await connectDatabase();
    const at = new Date(now);
    // Only a tracking challenge carries a reference; checkout, recovery and
    // email-change challenges store `null` there. Filtering on the reference is
    // therefore unambiguous, and it also matches a Phase 7 row written before
    // `purpose` existed.
    const challenge = (await TrackingChallengeModel.findOne({
      reference: input.reference,
      consumedAt: null,
      expiresAt: { $gt: at },
    })
      .sort({ createdAt: -1, _id: -1 })
      .lean()) as TrackingChallengeRecord | null;

    if (!challenge) return { ok: false, reason: "invalid" };
    if (challenge.attempts >= OTP_MAX_ATTEMPTS) return { ok: false, reason: "attempts" };

    const email = challenge.email ? normalizeEmail(challenge.email) : "";
    const expected = expectedDigest(challenge, input.code, email, "tracking", secret);
    if (!expected) return { ok: false, reason: "unavailable" };
    if (!hexDigestEqual(expected, challenge.codeHash)) {
      await recordWrongAttempt(challenge._id);
      return { ok: false, reason: "invalid" };
    }
    // A tracking code always belongs to an email on an order. A row without one
    // cannot establish an identity, so it cannot be accepted.
    if (!email) return { ok: false, reason: "invalid" };

    const consumed = await TrackingChallengeModel.findOneAndUpdate(
      {
        _id: challenge._id,
        consumedAt: null,
        expiresAt: { $gt: at },
        attempts: { $lt: OTP_MAX_ATTEMPTS },
      },
      { $set: { consumedAt: at } },
      { returnDocument: "before" },
    ).lean();

    return consumed ? { ok: true, email } : { ok: false, reason: "invalid" };
  } catch (error) {
    logDatabaseError("tracking-code-verify", error);
    return { ok: false, reason: "unavailable" };
  }
}
