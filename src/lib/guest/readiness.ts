import "server-only";
import { emailReadiness, type NotificationEnv } from "@/lib/notifications/config";

/**
 * Readiness for mandatory guest email verification (Phase 7B).
 *
 * Checkout cannot honestly accept a new order unless a code can actually be
 * sent AND its digest can be protected with a server secret. `RESEND_API_KEY`
 * alone is not proof of deliverability, but a missing key is proof that no
 * message can be attempted at all.
 *
 * The OTP secret is deliberately separate from the provider key: rotating the
 * email provider must not invalidate outstanding codes, and leaking one secret
 * must not compromise the other. A secret shorter than 32 characters is
 * rejected rather than silently used.
 */

export type GuestVerificationReason =
  | "ready"
  | "email_unavailable"
  | "missing_otp_secret"
  | "weak_otp_secret";

export interface GuestVerificationReadiness {
  ready: boolean;
  reason: GuestVerificationReason;
  emailConfigured: boolean;
  otpSecretConfigured: boolean;
}

const MIN_SECRET_LENGTH = 32;

/** The HMAC key for OTP digests, or null when absent/too short. */
export function otpSecret(env: NotificationEnv = process.env): string | null {
  const value = env.GUEST_OTP_SECRET?.trim();
  return value && value.length >= MIN_SECRET_LENGTH ? value : null;
}

export function guestVerificationReadiness(
  env: NotificationEnv = process.env,
): GuestVerificationReadiness {
  const emailConfigured = emailReadiness(env).configured;
  const rawSecret = env.GUEST_OTP_SECRET?.trim() ?? "";
  const secretConfigured = otpSecret(env) !== null;

  if (!emailConfigured) {
    return { ready: false, reason: "email_unavailable", emailConfigured, otpSecretConfigured: secretConfigured };
  }
  if (!rawSecret) {
    return { ready: false, reason: "missing_otp_secret", emailConfigured, otpSecretConfigured: false };
  }
  if (!secretConfigured) {
    return { ready: false, reason: "weak_otp_secret", emailConfigured, otpSecretConfigured: false };
  }
  return { ready: true, reason: "ready", emailConfigured, otpSecretConfigured: true };
}
