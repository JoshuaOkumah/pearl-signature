"use server";

import { createHash, randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import { headers } from "next/headers";
import { connectDatabase, logDatabaseError } from "@/lib/db/mongoose";
import { loadConfirmationView, hashConfirmationKey } from "@/lib/orders/view";
import { consumeOrderRateLimit } from "@/lib/orders/rate-limit";
import { emailReadiness } from "@/lib/notifications/config";
import { sendTrackingCodeEmail } from "@/lib/notifications/send-tracking-code";
import { OrderModel, type OrderRecord } from "@/models/order";
import {
  ORDER_ACCESS_GRANT_TTL_MS,
  OrderAccessGrantModel,
} from "@/models/order-access-grant";
import {
  TRACKING_CODE_MAX_ATTEMPTS,
  TRACKING_CODE_TTL_MS,
  TrackingChallengeModel,
} from "@/models/tracking-challenge";
import {
  orderTrackingRequestSchema,
  trackingRequestSchema,
  trackingVerifySchema,
  type OrderTrackingResponse,
  type TrackingRequestResponse,
  type TrackingVerifyResponse,
} from "@/lib/validations/order";

/**
 * Guest order tracking (Phase 7).
 *
 * Three public Server Actions, all following the same public-endpoint
 * contract: rate limit by client address, strict Zod allowlist, no privileged
 * field, neutral response, no stack traces.
 *
 * ## Authorisation
 *
 * A tracking read requires EITHER:
 *
 *  - the Phase 5 confirmation capability (32-byte secret kept in this tab's
 *    sessionStorage, compared against a sha256), OR
 *  - a scoped grant issued after a verified one-time email code.
 *
 * The public reference alone never authorises a read, so references cannot be
 * enumerated. A wrong capability, an expired grant and a missing order all
 * produce the same `not_found` answer.
 *
 * ## Cross-device recovery
 *
 * `requestTrackingCode` answers identically whether or not the reference/email
 * pair matches. A code is only emailed when it does, but the response gives
 * nothing away. If email is not configured, recovery says so explicitly rather
 * than pretending a message was sent.
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

function digestsEqual(a: string, b: string): boolean {
  const left = Buffer.from(a, "hex");
  const right = Buffer.from(b, "hex");
  return left.length === right.length && left.length > 0 && timingSafeEqual(left, right);
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

  try {
    await connectDatabase();
    const order = await OrderModel.findOne({ reference: parsed.data.reference })
      .select({ reference: 1, "customer.email": 1 })
      .lean();

    const storedEmail = order?.customer?.email?.trim().toLowerCase() ?? null;
    if (!order || !storedEmail || storedEmail !== parsed.data.email) {
      // No existence disclosure: a match and a miss look identical.
      return { ok: true };
    }

    const code = randomInt(0, 1_000_000).toString().padStart(6, "0");
    const challenge = await TrackingChallengeModel.create({
      reference: order.reference,
      codeHash: sha256(code),
      attempts: 0,
      consumedAt: null,
      expiresAt: new Date(now + TRACKING_CODE_TTL_MS),
    });

    const sent = await sendTrackingCodeEmail({
      to: storedEmail,
      code,
      reference: order.reference,
      challengeId: String(challenge._id),
      expiresMinutes: Math.round(TRACKING_CODE_TTL_MS / 60_000),
    });

    if (!sent) {
      // The code never reached the customer, so the challenge must not stay
      // valid. The response still stays generic.
      await TrackingChallengeModel.deleteOne({ _id: challenge._id });
    }
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

  try {
    await connectDatabase();
    const at = new Date(now);
    const challenge = await TrackingChallengeModel.findOne({
      reference: parsed.data.reference,
      consumedAt: null,
      expiresAt: { $gt: at },
    })
      .sort({ createdAt: -1, _id: -1 })
      .lean();

    // One neutral answer for "no challenge", "too many attempts" and "wrong
    // code" keeps the endpoint from confirming that a challenge exists.
    if (!challenge || challenge.attempts >= TRACKING_CODE_MAX_ATTEMPTS) {
      return { ok: false, reason: "invalid" };
    }

    if (!digestsEqual(sha256(parsed.data.code), challenge.codeHash)) {
      await TrackingChallengeModel.updateOne(
        { _id: challenge._id, consumedAt: null },
        { $inc: { attempts: 1 } },
      );
      return { ok: false, reason: "invalid" };
    }

    // Consume atomically: two concurrent submissions cannot both succeed.
    const consumed = await TrackingChallengeModel.findOneAndUpdate(
      { _id: challenge._id, consumedAt: null, expiresAt: { $gt: at } },
      { $set: { consumedAt: at } },
      { returnDocument: "before" },
    ).lean();
    if (!consumed) return { ok: false, reason: "invalid" };

    const order = (await OrderModel.findOne({ reference: parsed.data.reference })
      .select({ reference: 1 })
      .lean()) as OrderRecord | null;
    if (!order) return { ok: false, reason: "invalid" };

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
    let access: "capability" | "grant" = "capability";

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

    if (!order) return { ok: false, reason: "not_found" };
    return { ok: true, order: await loadConfirmationView(order), access };
  } catch (error) {
    logDatabaseError("order-tracking", error);
    return { ok: false, reason: "unavailable" };
  }
}
