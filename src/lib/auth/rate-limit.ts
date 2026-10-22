import "server-only";
import { createHash } from "node:crypto";
import { connectDatabase, logDatabaseError } from "@/lib/db/mongoose";
import { LOGIN_MAX_ATTEMPTS, LOGIN_WINDOW_MS, LoginAttemptModel } from "@/models/login-attempt";

/**
 * Login rate limiting without a paid Redis (Phase 3).
 *
 * Design: MongoDB document buckets keyed by hash(address + email + time
 * bucket), counted with an atomic upsert `$inc`, expired by a TTL index.
 *
 * - Survives process restarts and works across instances (unlike an
 *   in-memory counter), satisfying the multi-instance constraint.
 * - Bounded on Atlas M0: one small document per key per 15-minute window,
 *   deleted automatically by TTL; queries hit a unique index.
 * - Concurrency-safe: `$inc` on upsert never loses counts.
 *
 * Limitations (documented in docs/ADMIN_AUTH.md): NAT-shared addresses
 * share a bucket, TTL sweep lags ~60 s past expiry, and the bucket key is
 * a hash (attempted emails are not stored in this collection).
 *
 * Fail-closed or open? If the database is unreachable the login itself
 * cannot succeed either (sessions live in MongoDB), so a limiter error
 * simply surfaces as a failed login, never as silent unlimited attempts.
 */

function bucketKey(address: string, email: string, now: number): string {
  const bucket = Math.floor(now / LOGIN_WINDOW_MS);
  const material = `${address.trim().toLowerCase()}|${email.trim().toLowerCase()}|${bucket}`;
  return `la:${createHash("sha256").update(material, "utf8").digest("hex")}`;
}

export interface RateLimitState {
  allowed: boolean;
  /** Attempts remaining in the current window (0 when blocked). */
  remaining: number;
}

/** Read the current window for a login candidate without incrementing. */
export async function peekLoginRateLimit(
  address: string,
  email: string,
  now = Date.now(),
): Promise<RateLimitState> {
  try {
    await connectDatabase();
    const record = await LoginAttemptModel.findOne({
      key: bucketKey(address, email, now),
      expiresAt: { $gt: new Date(now) },
    })
      .select({ count: 1, _id: 0 })
      .lean();
    const count = record?.count ?? 0;
    return {
      allowed: count < LOGIN_MAX_ATTEMPTS,
      remaining: Math.max(0, LOGIN_MAX_ATTEMPTS - count),
    };
  } catch (error) {
    logDatabaseError("rate-limit-peek", error);
    // The login cannot succeed without the same database, so failing here
    // only short-circuits an attempt that would fail anyway.
    return { allowed: false, remaining: 0 };
  }
}

/**
 * Count one failed attempt. Atomic: concurrent failures in the same window
 * each register exactly once.
 */
export async function recordFailedLogin(
  address: string,
  email: string,
  now = Date.now(),
): Promise<RateLimitState> {
  try {
    await connectDatabase();
    const key = bucketKey(address, email, now);
    const expiresAt = new Date((Math.floor(now / LOGIN_WINDOW_MS) + 1) * LOGIN_WINDOW_MS);
    const record = await LoginAttemptModel.findOneAndUpdate(
      { key },
      { $inc: { count: 1 }, $setOnInsert: { key, expiresAt } },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    ).lean();
    const count = record?.count ?? 1;
    return {
      allowed: count < LOGIN_MAX_ATTEMPTS,
      remaining: Math.max(0, LOGIN_MAX_ATTEMPTS - count),
    };
  } catch (error) {
    logDatabaseError("rate-limit-record", error);
    // Still blocked: treat the failure to count as "no attempts allowed".
    return { allowed: false, remaining: 0 };
  }
}

/**
 * Clear the current window after a successful login so legitimate owners
 * never fight their own earlier typos. Historical windows expire via TTL.
 */
export async function clearLoginAttempts(address: string, email: string, now = Date.now()): Promise<void> {
  try {
    await connectDatabase();
    await LoginAttemptModel.deleteOne({ key: bucketKey(address, email, now) }).exec();
  } catch (error) {
    logDatabaseError("rate-limit-clear", error);
  }
}
