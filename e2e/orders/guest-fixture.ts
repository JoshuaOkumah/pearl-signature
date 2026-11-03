/**
 * Phase 7B guest-verification fixtures shared by the E2E harness and specs.
 *
 * Checkout now requires a verified email, so the orders server must be able to
 * ISSUE and DELIVER a code. The file-sink provider stands in for Resend: it
 * writes the rendered message to a git-ignored JSONL file that the Playwright
 * process reads, so no real inbox is ever touched and no real customer address
 * is used.
 *
 * The secret below is synthetic and exists only in this repository. It is long
 * enough to satisfy the production minimum (32 characters), which is what makes
 * the harness exercise the real readiness path instead of a bypass.
 */

/** HMAC key for OTP digests on the disposable E2E servers. */
export const E2E_GUEST_OTP_SECRET = "e2e-guest-otp-secret-0123456789abcdef";

/** Repo-relative JSONL sink for the orders server (separate from tracking). */
export const E2E_ORDERS_SINK_FILE = "test-results/e2e-orders-notifications.jsonl";

/** Server-side resend cooldown is disabled so a test can request once cleanly. */
export const E2E_GUEST_OTP_COOLDOWN_SECONDS = "0";

/** Subjects the branded code emails use, so a spec can pick the right one. */
export const CHECKOUT_CODE_SUBJECT = "Your PEARL Signature verification code";
export const RECOVERY_CODE_SUBJECT = "Your PEARL Signature sign-in code";
export const EMAIL_CHANGE_CODE_SUBJECT = "Confirm your new email address";
