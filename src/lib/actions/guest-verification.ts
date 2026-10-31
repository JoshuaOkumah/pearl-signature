"use server";

import { headers } from "next/headers";
import { connectDatabase, logDatabaseError } from "@/lib/db/mongoose";
import { verifyEmailCode, issueEmailCode } from "@/lib/guest/challenges";
import { MY_ORDERS_PAGE_SIZE } from "@/lib/guest/constants";
import { normalizeEmail } from "@/lib/guest/otp";
import { isCheckoutVerificationFresh, maskEmail } from "@/lib/guest/policy";
import { guestVerificationReadiness } from "@/lib/guest/readiness";
import {
  getGuestIdentity,
  hashClientAddress,
  revokeCurrentGuestSession,
  rotateGuestSession,
} from "@/lib/guest/session";
import { consumeOrderRateLimit } from "@/lib/orders/rate-limit";
import { itemsSummary, myOrderGroup } from "@/lib/orders/tracking";
import { OrderModel, type OrderRecord } from "@/models/order";
import {
  myOrdersRequestSchema,
  requestCodeSchema,
  verifyCodeSchema,
  type GuestSessionState,
  type MyOrdersPage,
  type MyOrdersResponse,
  type MyOrderSummary,
  type RequestCodeResponse,
  type VerifyCodeResponse,
} from "@/lib/validations/guest";
import { ORDER_RATE_WINDOW_MS } from "@/models/order-attempt";

/**
 * Guest email verification, remembered devices and My Orders (Phase 7B).
 *
 * Every action follows the same public-endpoint contract used by the Phase 5
 * and 7 actions: rate limit by client address, strict Zod allowlist, neutral
 * response, no privileged field, no stack traces, no secrets in logs.
 *
 * ## Why these live in Server Actions
 *
 * Cookies can only be written in a Server Action or a Route Handler, never
 * during Server Component render. Putting verification, recovery, session state
 * and history behind actions keeps every cookie write in one place and keeps
 * private order data out of any pre-rendered HTML or shared cache.
 *
 * ## What the client never sends
 *
 * No action accepts an email as proof of identity for a read. `loadMyOrders`
 * derives the visible orders from the session's verified email; the request
 * carries only a page number.
 */

/** Raw client address, used only as a rate-limit bucket input (hashed). */
async function clientAddress(): Promise<string> {
  const list = await headers();
  return (
    list.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    list.get("x-real-ip")?.trim() ||
    "unknown"
  );
}

function retryAfterSeconds(now: number): number {
  const windowEnd = (Math.floor(now / ORDER_RATE_WINDOW_MS) + 1) * ORDER_RATE_WINDOW_MS;
  return Math.max(1, Math.ceil((windowEnd - now) / 1_000));
}

/* ── issuing codes ──────────────────────────────────────────────────── */

/**
 * Checkout verification: request a code for the address the customer typed.
 *
 * Unlike recovery, the customer already knows they asked, so a cooldown is
 * reported honestly instead of being hidden behind a generic success.
 */
export async function requestCheckoutCodeAction(payload: unknown): Promise<RequestCodeResponse> {
  const now = Date.now();
  const limit = await consumeOrderRateLimit("otp.request", await clientAddress(), now);
  if (!limit.allowed) {
    return { ok: false, reason: "rate_limited", retryAfterSeconds: retryAfterSeconds(now) };
  }

  if (!guestVerificationReadiness().ready) return { ok: false, reason: "unavailable" };

  const parsed = requestCodeSchema.safeParse(payload);
  if (!parsed.success) return { ok: false, reason: "invalid" };

  const email = normalizeEmail(parsed.data.email);
  const emailLimit = await consumeOrderRateLimit("otp.email", email, now);
  if (!emailLimit.allowed) {
    return { ok: false, reason: "rate_limited", retryAfterSeconds: retryAfterSeconds(now) };
  }

  const issued = await issueEmailCode({ email, purpose: "checkout", now });
  if (issued.ok) return { ok: true };
  if (issued.reason === "cooldown") {
    return {
      ok: false,
      reason: "cooldown",
      retryAfterSeconds: issued.retryAfterSeconds ?? 60,
    };
  }
  return { ok: false, reason: "unavailable" };
}

/**
 * Email-only recovery ("Find My Orders").
 *
 * The response is deliberately generic before verification: it never says
 * whether this address has orders, whether a message was actually sent, or
 * whether a resend was throttled. A code is issued for any valid address so a
 * customer with no history can still verify and reach an honest empty state.
 */
export async function requestRecoveryCodeAction(payload: unknown): Promise<RequestCodeResponse> {
  const now = Date.now();
  const limit = await consumeOrderRateLimit("otp.request", await clientAddress(), now);
  if (!limit.allowed) {
    return { ok: false, reason: "rate_limited", retryAfterSeconds: retryAfterSeconds(now) };
  }

  if (!guestVerificationReadiness().ready) return { ok: false, reason: "unavailable" };

  const parsed = requestCodeSchema.safeParse(payload);
  if (!parsed.success) return { ok: false, reason: "invalid" };

  const email = normalizeEmail(parsed.data.email);
  const emailLimit = await consumeOrderRateLimit("otp.email", email, now);
  if (!emailLimit.allowed) return { ok: true };

  // A send failure and a cooldown stay invisible here on purpose.
  await issueEmailCode({ email, purpose: "recovery", now });
  return { ok: true };
}

/* ── verifying codes ────────────────────────────────────────────────── */

async function completeVerification(
  email: string,
  purpose: "checkout" | "recovery",
  code: string,
  now: number,
): Promise<VerifyCodeResponse> {
  const limit = await consumeOrderRateLimit("otp.verify", await clientAddress(), now);
  if (!limit.allowed) return { ok: false, reason: "rate_limited" };

  if (!guestVerificationReadiness().ready) return { ok: false, reason: "unavailable" };

  const parsed = verifyCodeSchema.safeParse({ email, code });
  if (!parsed.success) return { ok: false, reason: "invalid" };

  const verified = await verifyEmailCode({
    email: parsed.data.email,
    purpose,
    code: parsed.data.code,
    now,
  });
  if (!verified.ok) {
    if (verified.reason === "unavailable") return { ok: false, reason: "unavailable" };
    return { ok: false, reason: verified.reason };
  }

  try {
    const session = await rotateGuestSession(
      verified.email,
      hashClientAddress(await clientAddress()),
      now,
    );
    return {
      ok: true,
      email: session.identity.email,
      verifiedAtIso: session.identity.verifiedAt.toISOString(),
      sessionExpiresAtIso: session.identity.expiresAt.toISOString(),
    };
  } catch (error) {
    logDatabaseError("guest-session-create", error);
    return { ok: false, reason: "unavailable" };
  }
}

export async function verifyCheckoutCodeAction(payload: unknown): Promise<VerifyCodeResponse> {
  const now = Date.now();
  const parsed = verifyCodeSchema.safeParse(payload);
  if (!parsed.success) return { ok: false, reason: "invalid" };
  return completeVerification(parsed.data.email, "checkout", parsed.data.code, now);
}

export async function verifyRecoveryCodeAction(payload: unknown): Promise<VerifyCodeResponse> {
  const now = Date.now();
  const parsed = verifyCodeSchema.safeParse(payload);
  if (!parsed.success) return { ok: false, reason: "invalid" };
  return completeVerification(parsed.data.email, "recovery", parsed.data.code, now);
}

/* ── remembered device ──────────────────────────────────────────────── */

/**
 * Current remembered-device state for this browser.
 *
 * Returns the caller's own verified email, never anyone else's. `checkoutFresh`
 * tells the checkout UI whether a new order needs another code; the UI still
 * shows the verification step unless the identity is fresh, because a
 * remembered device is not the same as a recent verification.
 */
export async function getGuestSessionStateAction(): Promise<GuestSessionState> {
  const readiness = guestVerificationReadiness();
  const now = Date.now();
  const identity = await getGuestIdentity(now);

  if (!identity) {
    return {
      authenticated: false,
      email: null,
      verifiedAtIso: null,
      sessionExpiresAtIso: null,
      checkoutFresh: false,
      verificationAvailable: readiness.ready,
    };
  }

  return {
    authenticated: true,
    email: identity.email,
    verifiedAtIso: identity.verifiedAt.toISOString(),
    sessionExpiresAtIso: identity.expiresAt.toISOString(),
    checkoutFresh: isCheckoutVerificationFresh(identity, now),
    verificationAvailable: readiness.ready,
  };
}

/**
 * Forget This Device: revoke server-side first, then clear the cookie.
 *
 * The response is the new (empty) state so the caller can render the recovery
 * entry point immediately instead of guessing.
 */
export async function forgetGuestDeviceAction(): Promise<GuestSessionState> {
  const now = Date.now();
  try {
    await revokeCurrentGuestSession(now);
  } catch (error) {
    logDatabaseError("guest-session-forget", error);
  }
  return getGuestSessionStateAction();
}

/* ── My Orders ──────────────────────────────────────────────────────── */

/**
 * The customer's own order history, derived from the session identity.
 *
 * Bounded server-side pagination: one page of at most `MY_ORDERS_PAGE_SIZE`
 * orders, newest first. Counts come from one aggregation over the same email,
 * so the group headings are accurate without loading every order.
 */
export async function loadMyOrdersAction(payload: unknown): Promise<MyOrdersResponse> {
  const now = Date.now();
  const limit = await consumeOrderRateLimit("order.lookup", await clientAddress(), now);
  if (!limit.allowed) return { ok: false, reason: "rate_limited" };

  const identity = await getGuestIdentity(now);
  if (!identity) return { ok: false, reason: "unauthenticated" };

  const parsed = myOrdersRequestSchema.safeParse(payload ?? {});
  if (!parsed.success) return { ok: false, reason: "unauthenticated" };

  const { page } = parsed.data;
  const skip = (page - 1) * MY_ORDERS_PAGE_SIZE;

  try {
    await connectDatabase();
    const match = { "customer.email": identity.email };

    const [orders, counts] = await Promise.all([
      OrderModel.find(match)
        .sort({ createdAt: -1, _id: -1 })
        .skip(skip)
        .limit(MY_ORDERS_PAGE_SIZE + 1)
        .select({
          reference: 1,
          status: 1,
          createdAt: 1,
          "customer.email": 1,
          "fulfillment.method": 1,
          "payment.method": 1,
          "payment.status": 1,
          "money.totalCents": 1,
          items: 1,
        })
        .lean(),
      OrderModel.aggregate<{ _id: string; count: number }>([
        { $match: match },
        { $group: { _id: "$status", count: { $sum: 1 } } },
      ]),
    ]);

    const hasMore = orders.length > MY_ORDERS_PAGE_SIZE;
    const visible = hasMore ? orders.slice(0, MY_ORDERS_PAGE_SIZE) : orders;

    const groupCounts = { active: 0, completed: 0, cancelled: 0, total: 0 };
    for (const row of counts) {
      const group = myOrderGroup(row._id as OrderRecord["status"]);
      groupCounts[group] += row.count;
      groupCounts.total += row.count;
    }

    const summaries: MyOrderSummary[] = visible.map((order) => ({
      reference: order.reference,
      status: order.status,
      placedAtIso: new Date(order.createdAt).toISOString(),
      itemsSummary: itemsSummary(order.items.map((item) => ({ name: item.name, quantity: item.quantity }))),
      itemCount: order.items.reduce((total, item) => total + item.quantity, 0),
      paymentMethod: order.payment.method,
      paymentStatus: order.payment.status,
      totalCents: order.money.totalCents,
      fulfillmentMethod: order.fulfillment.method,
    }));

    const data: MyOrdersPage = {
      emailMasked: maskEmail(identity.email),
      page,
      pageSize: MY_ORDERS_PAGE_SIZE,
      hasMore,
      counts: groupCounts,
      orders: summaries,
    };

    return { ok: true, data };
  } catch (error) {
    logDatabaseError("my-orders", error);
    return { ok: false, reason: "unavailable" };
  }
}
