/**
 * Guest identity constants (Phase 7B), shared by server and browser-safe code.
 *
 * Nothing here is a secret. The cookie name is public (a cookie is visible in
 * developer tools); the token it carries is not. The TTLs are policy values and
 * may be overridden through the environment by the server-only readers.
 */

/** Remembered-device lifetime: 30 days, absolute and never sliding. */
export const GUEST_SESSION_TTL_DAYS = 30;
export const GUEST_SESSION_TTL_MS = GUEST_SESSION_TTL_DAYS * 24 * 60 * 60 * 1_000;

/** A checkout must be backed by a verification no older than this. */
export const CHECKOUT_VERIFICATION_TTL_MINUTES = 30;
export const CHECKOUT_VERIFICATION_TTL_MS = CHECKOUT_VERIFICATION_TTL_MINUTES * 60 * 1_000;

/** Six-digit code lifetime. */
export const OTP_TTL_MINUTES = 10;
export const OTP_TTL_MS = OTP_TTL_MINUTES * 60 * 1_000;

/** Wrong submissions allowed per challenge before it is exhausted. */
export const OTP_MAX_ATTEMPTS = 5;

/** A new code cannot be requested sooner than this after the previous one. */
export const OTP_RESEND_COOLDOWN_SECONDS = 60;
export const OTP_RESEND_COOLDOWN_MS = OTP_RESEND_COOLDOWN_SECONDS * 1_000;

/** Cookie that carries the opaque remembered-device token. */
export const GUEST_COOKIE_NAME = "pearl_guest";

/** My Orders page size (server-side bounded pagination). */
export const MY_ORDERS_PAGE_SIZE = 10;

export type GuestCodePurpose = "checkout" | "recovery" | "tracking" | "order_email_change";
