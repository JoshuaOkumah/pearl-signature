import {
  CHECKOUT_VERIFICATION_TTL_MINUTES,
  CHECKOUT_VERIFICATION_TTL_MS,
  GUEST_SESSION_TTL_DAYS,
  OTP_RESEND_COOLDOWN_MS,
} from "./constants";

/**
 * Guest policy values (Phase 7B), free of Next.js or mongoose.
 *
 * Keeping these readers isomorphic lets `createOrder` enforce freshness without
 * importing a module that reads cookies, and lets unit tests exercise the same
 * policy the server uses.
 */

/**
 * Canonical email identity: trim and lower case only, never altered further.
 *
 * Deliberately isomorphic and free of Node built-ins so a client component can
 * compare the address the customer typed with the address the server verified.
 */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export interface VerifiedGuestIdentity {
  email: string;
  verifiedAt: Date;
}

function positiveInt(value: string | undefined, fallback: number, max: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 && parsed <= max ? parsed : fallback;
}

/** Remembered-device lifetime in ms (default 30 days, configurable 1..365). */
export function guestSessionTtlMs(env: NodeJS.ProcessEnv = process.env): number {
  const days = positiveInt(env.GUEST_SESSION_TTL_DAYS, GUEST_SESSION_TTL_DAYS, 365);
  return days * 24 * 60 * 60 * 1_000;
}

/** Freshness required for a NEW checkout (default 30 minutes, 1..120). */
export function checkoutVerificationTtlMs(env: NodeJS.ProcessEnv = process.env): number {
  const minutes = positiveInt(
    env.GUEST_CHECKOUT_VERIFICATION_MINUTES,
    CHECKOUT_VERIFICATION_TTL_MINUTES,
    120,
  );
  return minutes * 60 * 1_000;
}

/** True when the identity is recent enough to place an order. */
export function isCheckoutVerificationFresh(
  identity: Pick<VerifiedGuestIdentity, "verifiedAt">,
  now = Date.now(),
): boolean {
  return now - identity.verifiedAt.getTime() <= checkoutVerificationTtlMs();
}

/** Cooldown in ms; tests may set 0 through the environment, production is 60 s. */
export function otpResendCooldownMs(env: NodeJS.ProcessEnv = process.env): number {
  const raw = Number(env.GUEST_OTP_RESEND_COOLDOWN_SECONDS);
  if (Number.isInteger(raw) && raw >= 0 && raw <= 300) return raw * 1_000;
  return OTP_RESEND_COOLDOWN_MS;
}

/**
 * Mask an address for display: the first local character plus the domain.
 *
 * Kept here (isomorphic) so the browser can show a remembered identity without
 * the server shipping a second copy of the rule.
 */
export function maskEmail(email: string): string {
  const value = email.trim().toLowerCase();
  const at = value.lastIndexOf("@");
  if (at <= 0) return "***";
  const local = value.slice(0, at);
  const domain = value.slice(at + 1);
  return `${local.slice(0, 1)}***@${domain}`;
}

export { CHECKOUT_VERIFICATION_TTL_MS };
