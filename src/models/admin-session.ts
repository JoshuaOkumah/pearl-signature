import { Schema, models, model, type InferSchemaType, type Model, type Types } from "mongoose";

/**
 * Server-side admin sessions (Phase 3).
 *
 * The browser only ever holds an opaque random token in an HttpOnly cookie;
 * MongoDB stores its SHA-256 hash. A leaked database dump therefore never
 * yields usable session tokens.
 *
 * - `expiresAt` carries a TTL index (`expireAfterSeconds: 0`) so MongoDB
 *   bounds the collection automatically. Application validation is
 *   authoritative: an expired row is rejected even before the TTL sweep
 *   (which runs roughly once a minute) removes it.
 * - Revocation deletes the row (logout) or every row for an admin
 *   (password reset / account disabled).
 */

export const AdminSessionSchema = new Schema(
  {
    tokenHash: {
      type: String,
      required: true,
      unique: true,
      maxlength: [128, "Token hash is malformed"],
    },
    adminId: {
      type: Schema.Types.ObjectId,
      ref: "Admin",
      required: true,
    },
    /** Hashed client address for audit context only (never the raw IP). */
    ipHash: {
      type: String,
      default: null,
      maxlength: [128, "IP hash is malformed"],
    },
    expiresAt: {
      type: Date,
      required: true,
    },
  },
  {
    timestamps: true,
    collection: "admin_sessions",
  },
);

AdminSessionSchema.index({ adminId: 1, createdAt: -1 });

export type AdminSessionRecord = InferSchemaType<typeof AdminSessionSchema> & {
  _id: Types.ObjectId;
  adminId: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
};

export const AdminSessionModel: Model<AdminSessionRecord> =
  (models.AdminSession as Model<AdminSessionRecord> | undefined) ??
  model<AdminSessionRecord>("AdminSession", AdminSessionSchema);
