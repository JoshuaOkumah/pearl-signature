import { Schema, models, model, type InferSchemaType, type Model } from "mongoose";

/**
 * Remembered guest device (Phase 7B).
 *
 * The browser holds a 256-bit opaque token in an HttpOnly cookie. This
 * collection stores only its sha256. A session has exactly ONE verified email
 * at a time, which is what keeps two people who share a phone from seeing each
 * other's orders: verifying a different address rotates the token and replaces
 * the identity.
 *
 * ## Expiry and revocation
 *
 * - `expiresAt` is absolute (30 days from issue); it is never extended by a
 *   read, so a stolen cookie cannot live forever.
 * - `revokedAt` is set by Forget This Device, by rotation, and by any future
 *   owner-assisted revocation. A revoked row is never accepted, even before its
 *   TTL sweep.
 * - Application code checks both dates; the TTL index is only housekeeping.
 *
 * Indexes are created explicitly (`autoIndex` is off) by the seed script and
 * the test harness.
 */

const GuestSessionSchema = new Schema(
  {
    tokenHash: {
      type: String,
      required: true,
      maxlength: [64, "Session token digest is malformed"],
    },
    email: {
      type: String,
      required: true,
      lowercase: true,
      trim: true,
      maxlength: [254, "Email is malformed"],
    },
    verifiedAt: {
      type: Date,
      required: true,
    },
    expiresAt: {
      type: Date,
      required: true,
    },
    revokedAt: {
      type: Date,
      default: null,
    },
    /** One-way hash of the client address, for bounded abuse investigation. */
    ipHash: {
      type: String,
      default: null,
      maxlength: [64, "Client hash is malformed"],
    },
  },
  {
    timestamps: true,
    collection: "guest_sessions",
  },
);

GuestSessionSchema.index({ tokenHash: 1 }, { unique: true, name: "tokenHash_unique" });
GuestSessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
GuestSessionSchema.index({ email: 1, revokedAt: 1, createdAt: -1 });

export type GuestSessionRecord = InferSchemaType<typeof GuestSessionSchema> & {
  _id: unknown;
  createdAt: Date;
  updatedAt: Date;
};

export const GuestSessionModel: Model<GuestSessionRecord> =
  (models.GuestSession as Model<GuestSessionRecord> | undefined) ??
  model<GuestSessionRecord>("GuestSession", GuestSessionSchema);
