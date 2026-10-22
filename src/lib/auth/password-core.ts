import { hash, verify } from "@node-rs/argon2";

/**
 * Password hashing core (Phase 3) — shared by the Next.js server code
 * (via src/lib/auth/password.ts, which adds the `server-only` guard) and
 * the operator CLI scripts (bootstrap / password reset), which run under
 * plain tsx where the `server-only` import would throw.
 *
 * Algorithm decision: **Argon2id** via `@node-rs/argon2`, selected because
 * it is the current OWASP-recommended password hashing algorithm, the
 * package ships prebuilt native binaries (no compiler toolchain needed on
 * the runtime or CI), and it verified correctly on this project's Node
 * runtime before it was adopted. Parameters follow the OWASP Password
 * Storage Cheat Sheet baseline for Argon2id: 19 MiB memory, 2 iterations,
 * 1 degree of parallelism.
 *
 * Rules enforced here:
 * - Only encoded hashes are stored; plaintext never leaves this module's
 *   callers (login/CLI scripts) and is never logged.
 * - Verification failures (wrong password, malformed stored hash) resolve
 *   to `false` instead of throwing, so authentication flow stays uniform.
 */

/** OWASP baseline: m=19456 KiB (19 MiB), t=2, p=1. */
const HASH_OPTIONS = {
  algorithm: 2, // argon2id
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
} as const;

/** Password policy: length is the strongest single factor we can enforce. */
export const MIN_PASSWORD_LENGTH = 10;
export const MAX_PASSWORD_LENGTH = 200;

/**
 * Validate a candidate password against the admin policy.
 * Returns `null` when acceptable, or a safe operator-facing message.
 */
export function validatePasswordPolicy(candidate: unknown): string | null {
  if (typeof candidate !== "string" || candidate.length === 0) {
    return "Password is required.";
  }
  if (candidate.length < MIN_PASSWORD_LENGTH) {
    return `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`;
  }
  if (candidate.length > MAX_PASSWORD_LENGTH) {
    return `Password must be at most ${MAX_PASSWORD_LENGTH} characters.`;
  }
  return null;
}

/** Hash a password for storage. Never log the input or the result. */
export async function hashPassword(password: string): Promise<string> {
  return hash(password, HASH_OPTIONS);
}

/**
 * Verify a password against a stored encoded hash.
 * Returns `false` for wrong passwords and unusable hashes (no throws).
 */
export async function verifyPassword(storedHash: string, password: string): Promise<boolean> {
  if (!storedHash || !password) return false;
  try {
    return await verify(storedHash, password, HASH_OPTIONS);
  } catch {
    return false;
  }
}

/**
 * A throwaway hash used to equalize response time when the email does not
 * exist: without it, "unknown email" would answer faster than "wrong
 * password" and leak which accounts are registered. Computed once per
 * process, lazily, so startup stays fast.
 */
let dummyHashPromise: Promise<string> | null = null;
function dummyHash(): Promise<string> {
  dummyHashPromise ??= hashPassword("pearl-timing-equalizer");
  return dummyHashPromise;
}

/**
 * Verify credentials without revealing whether the email exists: always
 * runs a full Argon2 verification (against a dummy hash when needed).
 * Returns whether the supplied password matched the supplied hash.
 */
export async function verifyPasswordConstantTime(
  storedHash: string | null,
  password: string,
): Promise<boolean> {
  const target = storedHash ?? (await dummyHash());
  return verifyPassword(target, password);
}
