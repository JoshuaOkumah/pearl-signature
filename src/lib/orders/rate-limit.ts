import "server-only";
import { createHash } from "node:crypto";
import { connectDatabase, logDatabaseError } from "@/lib/db/mongoose";
import {
  ORDER_CREATE_MAX_ATTEMPTS,
  ORDER_LOOKUP_MAX_ATTEMPTS,
  ORDER_RATE_WINDOW_MS,
  ORDER_RATE_SCOPES,
  OrderAttemptModel,
  type OrderRateScope,
} from "@/models/order-attempt";

/**
 * Public order rate limiting (Phase 5).
 *
 * The same MongoDB bucket design as the Phase 3 login limiter (atomic
 * upsert `$inc`, hashed key, TTL expiry) in a SEPARATE collection, because
 * the two systems must not share budgets: public order traffic can never
 * consume the admin login allowance, and login failures can never lock a
 * customer out of ordering.
 *
 * What it costs to be wrong:
 *
 *  - Fail-closed. If the limiter's database read fails, submission is
 *    refused — which is safe, because order creation needs the same
 *    database and would fail anyway. No silent unlimited attempts.
 *  - Counted on attempt, not on success, so a retry loop cannot buy extra
 *    budget by failing.
 *
 * Known limitations (documented in `docs/ORDER_ARCHITECTURE.md`): one
 * address behind NAT shares a bucket, and the TTL sweep lags up to ~60s
 * past window expiry. Neither weakens the guarantee that matters here,
 * which is bounding automated order spam per address.
 */

const LIMITS: Record<OrderRateScope, number> = {
  "order.create": ORDER_CREATE_MAX_ATTEMPTS,
  "order.lookup": ORDER_LOOKUP_MAX_ATTEMPTS,
};

export interface OrderRateLimitResult {
  allowed: boolean;
  /** Attempts remaining in the current window (0 when blocked). */
  remaining: number;
}

function bucketKey(scope: OrderRateScope, address: string, now: number): string {
  const bucket = Math.floor(now / ORDER_RATE_WINDOW_MS);
  const material = `${scope}|${address.trim().toLowerCase()}|${bucket}`;
  return `oa:${createHash("sha256").update(material, "utf8").digest("hex")}`;
}

/**
 * Count one attempt against `scope` for this address and report whether it
 * is allowed. Every public order-submission or confirmation-read request
 * calls this exactly once, before doing any other work.
 */
export async function consumeOrderRateLimit(
  scope: OrderRateScope,
  address: string,
  now = Date.now(),
): Promise<OrderRateLimitResult> {
  const limit = LIMITS[scope];
  try {
    await connectDatabase();
    const key = bucketKey(scope, address, now);
    const expiresAt = new Date((Math.floor(now / ORDER_RATE_WINDOW_MS) + 1) * ORDER_RATE_WINDOW_MS);
    const record = await OrderAttemptModel.findOneAndUpdate(
      { key },
      { $inc: { count: 1 }, $setOnInsert: { key, expiresAt } },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    ).lean();
    const count = record?.count ?? 1;
    return {
      allowed: count <= limit,
      remaining: Math.max(0, limit - count),
    };
  } catch (error) {
    logDatabaseError(`order-rate-limit:${scope}`, error);
    return { allowed: false, remaining: 0 };
  }
}

/** The scope names, for callers that iterate or log them. */
export const ORDER_RATE_LIMIT_SCOPES = ORDER_RATE_SCOPES;
