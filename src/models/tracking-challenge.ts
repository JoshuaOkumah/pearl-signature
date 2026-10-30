import { Schema, models, model, type InferSchemaType, type Model } from "mongoose";

/**
 * Cross-device tracking challenge (Phase 7).
 *
 * A customer who opened an order on another device proves control of the
 * email address on the order. The server emails a short one-time code and
 * stores ONLY its sha256. The code itself exists in the message and in the
 * customer's inbox, never in this collection.
 *
 * Security properties:
 *  - short expiry (10 minutes) enforced by a TTL index and re-checked on read,
 *  - single use (`consumedAt`),
 *  - at most `TRACKING_CODE_MAX_ATTEMPTS` wrong submissions per challenge.
 *
 * The public order reference is stored (it is not a secret) so the code can be
 * matched to its order. The stored value never includes the email address.
 *
 * Indexes are created explicitly (`autoIndex` is off) by the seed script and
 * the test harness.
 */

export const TRACKING_CODE_TTL_MS = 10 * 60 * 1_000;
export const TRACKING_CODE_MAX_ATTEMPTS = 5;

const TrackingChallengeSchema = new Schema(
  {
    reference: {
      type: String,
      required: true,
      maxlength: [20, "Order reference is malformed"],
    },
    codeHash: {
      type: String,
      required: true,
      maxlength: [64, "Tracking code hash is malformed"],
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
TrackingChallengeSchema.index({ reference: 1, createdAt: -1 });

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
