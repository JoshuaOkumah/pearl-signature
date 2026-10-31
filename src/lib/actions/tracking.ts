"use server";

import { createHash, randomBytes } from "node:crypto";
import { headers } from "next/headers";
import { connectDatabase, logDatabaseError } from "@/lib/db/mongoose";
import { issueEmailCode, verifyTrackingCode } from "@/lib/guest/challenges";
import { normalizeEmail } from "@/lib/guest/otp";
import { guestVerificationReadiness } from "@/lib/guest/readiness";
import { getGuestIdentity, hashClientAddress, rotateGuestSession } from "@/lib/guest/session";
import { loadConfirmationView, hashConfirmationKey } from "@/lib/orders/view";
import { consumeOrderRateLimit } from "@/lib/orders/rate-limit";
import { emailReadiness } from "@/lib/notifications/config";
import { OrderModel, type OrderRecord } from "@/models/order";
import {
  ORDER_ACCESS_GRANT_TTL_MS,
  OrderAccessGrantModel,
} from "@/models/order-access-grant";
import {
  orderTrackingRequestSchema,
  trackingRequestSchema,
  trackingVerifySchema,
  type OrderTrackingResponse,
  type TrackingRequestResponse,
  type TrackingVerifyResponse,
} from "@/lib/validations/order";

/**
 * Guest order tracking (Phase 7, hardened in Phase 7B).
 *
 * Three public Server Actions, all following the same public-endpoint
 * contract: rate limit by client address, strict Zod allowlist, no privileged
 * field, neutral response, no stack traces.
 *
 * ## Authorisation
 *
 * A tracking read requires ONE of:
 *
 *  - the Phase 5 confirmation capability (32-byte secret kept in this tab's
 *    sessionStorage, compared against a sha256),
 *  - a scoped grant issued after a verified one-time email code, or
 *  - a live remembered-device session whose verified email is the order's
 *    email.
 *
 * The public reference alone never authorises a read, so references cannot be
 * enumerated. A wrong capability, an expired grant, a session for a different
 * email and a missing order all produce the same `not_found` answer.
 *
 * ## Cross-device recovery
 *
 * `requestTrackingCode` answers identically whether or not the reference/email
 * pair matches. A code is only emailed when it does, but the response gives
 * nothing away. If email is not configured, recovery says so explicitly rather
 * than pretending a message was sent.
 *
 * A successful verification now ALSO establishes a remembered device: the
 * session is rotated to the verified email, so this browser can open My Orders
 * without another code. The scoped grant stays, because a session can be
 * forgotten while the grant (24 hours, one order) remains a deliberate,
 * narrower fallback.
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

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

/* ── request a code ─────────────────────────────────────────────────── */

export async function requestTrackingCodeAction(payload: unknown): Promise<TrackingRequestResponse> {
  const now = Date.now();
  const limit = await consumeOrderRateLimit("tracking.request", await clientAddress(), now);
  if (!limit.allowed) return { ok: false, reason: "rate_limited" };

  // Global configuration, not order-specific: it is safe to say this out loud
  // because it reveals nothing about any order.
  if (!emailReadiness().configured) return { ok: false, reason: "unavailable" };

  const parsed = trackingRequestSchema.safeParse(payload);
  // A malformed request gets the same generic answer as a non-matching pair.
  if (!parsed.success) return { ok: true };

  const email = normalizeEmail(parsed.data.email);

  try {
    // Per-email issuance budget, independent of the address bucket. The bucket
    // key hashes its material, so no raw address is stored.
    const emailLimit = await consumeOrderRateLimit("otp.email", email, now);
    if (!emailLimit.allowed) return { ok: true };

    await connectDatabase();
    const order = await OrderModel.findOne({ reference: parsed.data.reference })
      .select({ reference: 1, "customer.email": 1 })
      .lean();

    const storedEmail = order?.customer?.email ? normalizeEmail(order.customer.email) : null;
    if (!order || !storedEmail || storedEmail !== email) {
      // No existence disclosure: a match and a miss look identical.
      return { ok: true };
    }

    // A send failure, a cooldown or a missing OTP secret all keep the generic
    // answer; the caller learns nothing about whether the pair matched.
    await issueEmailCode({ email, purpose: "tracking", reference: order.reference, now });
    return { ok: true };
  } catch (error) {
    logDatabaseError("tracking-request", error);
    return { ok: false, reason: "unavailable" };
  }
}

/* ── verify a code ──────────────────────────────────────────────────── */

export async function verifyTrackingCodeAction(payload: unknown): Promise<TrackingVerifyResponse> {
  const now = Date.now();
  const limit = await consumeOrderRateLimit("tracking.verify", await clientAddress(), now);
  if (!limit.allowed) return { ok: false, reason: "rate_limited" };

  if (!emailReadiness().configured) return { ok: false, reason: "unavailable" };

  const parsed = trackingVerifySchema.safeParse(payload);
  if (!parsed.success) return { ok: false, reason: "invalid" };

  const verified = await verifyTrackingCode({
    reference: parsed.data.reference,
    code: parsed.data.code,
    now,
  });

  // One neutral answer for "no challenge", "too many attempts", "expired" and
  // "wrong code" keeps the endpoint from confirming that a challenge exists.
  if (!verified.ok) {
    return { ok: false, reason: verified.reason === "unavailable" ? "unavailable" : "invalid" };
  }

  try {
    await connectDatabase();
    const order = (await OrderModel.findOne({
      reference: parsed.data.reference,
      "customer.email": verified.email,
    })
      .select({ reference: 1, "customer.email": 1 })
      .lean()) as OrderRecord | null;
    if (!order) return { ok: false, reason: "invalid" };

    // Remembered device: rotate the session to the address just proven. The
    // raw token never reaches client JavaScript.
    await rotateGuestSession(verified.email, hashClientAddress(await clientAddress()), now);

    const grantKey = randomBytes(32).toString("base64url");
    await OrderAccessGrantModel.create({
      reference: order.reference,
      orderId: String(order._id),
      tokenHash: sha256(grantKey),
      expiresAt: new Date(now + ORDER_ACCESS_GRANT_TTL_MS),
      revokedAt: null,
    });

    return { ok: true, grantKey };
  } catch (error) {
    logDatabaseError("tracking-verify", error);
    return { ok: false, reason: "unavailable" };
  }
}

/* ── read the order ─────────────────────────────────────────────────── */

export async function loadOrderTrackingAction(payload: unknown): Promise<OrderTrackingResponse> {
  const now = Date.now();
  const limit = await consumeOrderRateLimit("order.lookup", await clientAddress(), now);
  if (!limit.allowed) return { ok: false, reason: "rate_limited" };

  const parsed = orderTrackingRequestSchema.safeParse(payload);
  if (!parsed.success) return { ok: false, reason: "not_found" };

  try {
    await connectDatabase();
    let order: OrderRecord | null = null;
    let access: "capability" | "grant" | "session" = "capability";

    if (parsed.data.accessKey) {
      order = (await OrderModel.findOne({
        reference: parsed.data.reference,
        confirmationKeyHash: hashConfirmationKey(parsed.data.accessKey),
      }).lean()) as OrderRecord | null;
    }

    if (!order && parsed.data.grantKey) {
      const grant = await OrderAccessGrantModel.findOne({
        tokenHash: sha256(parsed.data.grantKey),
        reference: parsed.data.reference,
        revokedAt: null,
        expiresAt: { $gt: new Date(now) },
      }).lean();
      if (grant) {
        order = (await OrderModel.findOne({
          _id: grant.orderId,
          reference: parsed.data.reference,
        }).lean()) as OrderRecord | null;
        if (order) access = "grant";
      }
    }

    if (!order) {
      // Remembered device: the session email must be the order's email.
      const identity = await getGuestIdentity(now);
      if (identity) {
        order = (await OrderModel.findOne({
          reference: parsed.data.reference,
          "customer.email": identity.email,
        }).lean()) as OrderRecord | null;
        if (order) access = "session";
      }
    }

    if (!order) return { ok: false, reason: "not_found" };
    return { ok: true, order: await loadConfirmationView(order), access };
  } catch (error) {
    logDatabaseError("order-tracking", error);
    return { ok: false, reason: "unavailable" };
  }
}

/**
 * Readiness for the tracking recovery UI. Global, order-independent, and safe
 * to disclose: it says whether codes can be delivered, not whether any order
 * exists.
 */
export async function trackingRecoveryAvailabilityAction(): Promise<boolean> {
  return guestVerificationReadiness().ready;
}
