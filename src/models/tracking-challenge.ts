import { Schema, models, model, type InferSchemaType, type Model } from "mongoose";
import {
  OTP_MAX_ATTEMPTS,
  OTP_TTL_MS,
  type GuestCodePurpose,
} from "@/lib/guest/constants";

/**
 * Email verification challenge (Phase 7, generalised in Phase 7B).
 *
 * One short-lived, single-use secret proves control of an email address. The
 * code itself exists only in the message and the customer's inbox; this
 * collection stores a digest.
 *
 * ## Digest versions
 *
 * New challenges use HMAC-SHA-256 keyed by a server secret and bound to the
 * challenge context (`challengeId`, email, purpose, code). A six-digit code has
 * only one million possible values, so a plain unsalted sha256 would be
 * reversible from a database leak in milliseconds. `legacy-sha256` exists ONLY
 * so a code issued by Phase 7 before this upgrade can still be verified; no new
 * challenge is ever written with it.
 *
 * ## Purposes
 *
 * - `tracking`: proves the email on a specific order (reference stored).
 * - `checkout`: proves the email a customer is about to order with.
 * - `recovery`: proves the email behind an order history.
 * - `order_email_change`: proves a NEW address before an order is moved to it.
 *
 * ## Security properties
 *
 * - ten-minute expiry, enforced by a TTL index AND re-checked on read,
 * - single use (`consumedAt`, atomic consume),
 * - at most `OTP_MAX_ATTEMPTS` wrong submissions,
 * - resend supersedes every earlier active challenge for the same context.
 *
 * Indexes are created explicitly (`autoIndex` is off) by the seed script and
 * the test harness.
 */

export const TRACKING_CODE_TTL_MS = OTP_TTL_MS;
export const TRACKING_CODE_MAX_ATTEMPTS = OTP_MAX_ATTEMPTS;

export const CHALLENGE_PURPOSES = [
  "tracking",
  "checkout",
  "recovery",
  "order_email_change",
] as const satisfies readonly GuestCodePurpose[];

export const CHALLENGE_DIGEST_VERSIONS = ["legacy-sha256", "hmac-sha256-v1"] as const;
export type ChallengeDigestVersion = (typeof CHALLENGE_DIGEST_VERSIONS)[number];

const TrackingChallengeSchema = new Schema(
  {
    /** Random opaque id, bound into the HMAC and the provider idempotency key. */
    challengeId: {
      type: String,
      default: null,
      maxlength: [64, "Challenge id is malformed"],
    },
    /** Canonical email identity. Absent on legacy Phase 7 tracking records. */
    email: {
      type: String,
      default: null,
      lowercase: true,
      trim: true,
      maxlength: [254, "Email is malformed"],
    },
    purpose: {
      type: String,
      enum: CHALLENGE_PURPOSES,
      default: "tracking",
    },
    /** Public order reference for a tracking challenge; null otherwise. */
    reference: {
      type: String,
      default: null,
      maxlength: [20, "Order reference is malformed"],
    },
    codeHash: {
      type: String,
      required: true,
      maxlength: [64, "Verification code digest is malformed"],
    },
    digestVersion: {
      type: String,
      enum: CHALLENGE_DIGEST_VERSIONS,
      default: "legacy-sha256",
    },
    attempts: {
      type: Number,
      required: true,
      min: 0,
      default: 0,
    },
    consumedAt: {
      type: Date,
      default: null,
    },
    lastSentAt: {
      type: Date,
      default: null,
    },
    expiresAt: {
      type: Date,
      required: true,
    },
  },
  {
    timestamps: true,
    collection: "tracking_challenges",
  },
);

// Newest challenge for an order is the only one that can be verified.
TrackingChallengeSchema.index({ reference: 1, purpose: 1, createdAt: -1 });

// Newest challenge for an email and purpose (checkout, recovery, email change).
TrackingChallengeSchema.index({ email: 1, purpose: 1, createdAt: -1 });

// A random id is unique when present; legacy rows have no value and are exempt.
TrackingChallengeSchema.index(
  { challengeId: 1 },
  { unique: true, sparse: true, name: "challengeId_unique" },
);

// Expired challenges delete themselves; the read path also checks the date.
TrackingChallengeSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export type TrackingChallengeRecord = InferSchemaType<typeof TrackingChallengeSchema> & {
  _id: unknown;
  createdAt: Date;
  updatedAt: Date;
};

export const TrackingChallengeModel: Model<TrackingChallengeRecord> =
  (models.TrackingChallenge as Model<TrackingChallengeRecord> | undefined) ??
  model<TrackingChallengeRecord>("TrackingChallenge", TrackingChallengeSchema);

/** Semantic alias: the same collection now serves every verification purpose. */
export const EmailVerificationChallengeModel = TrackingChallengeModel;
