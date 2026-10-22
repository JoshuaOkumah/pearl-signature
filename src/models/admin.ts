import { Schema, models, model, type InferSchemaType, type Model, type Types } from "mongoose";

/**
 * Admin account (Phase 3).
 *
 * - `passwordHash` is an encoded Argon2id hash produced by
 *   `src/lib/auth/password.ts`. Plaintext passwords and hashes never leave
 *   server-only code.
 * - `role` supports the primary `owner` now and `staff` later without a
 *   migration; authorization currently only grants access to `owner`.
 * - `status: "disabled"` disables an account without deleting it.
 *
 * Indexes are created deliberately (`autoIndex` is off); the bootstrap and
 * reset scripts call `createIndexes()`.
 */

export const AdminSchema = new Schema(
  {
    email: {
      type: String,
      required: [true, "Email is required"],
      unique: true,
      lowercase: true,
      trim: true,
      maxlength: [160, "Email is too long"],
      // Deliberately simple: format is validated by Zod at every boundary;
      // the schema only normalises and bounds.
      match: [/^[^\s@]+@[^\s@]+\.[^\s@]+$/, "Email is not valid"],
    },
    passwordHash: {
      type: String,
      required: [true, "Password hash is required"],
      maxlength: [512, "Password hash is malformed"],
    },
    role: {
      type: String,
      enum: ["owner", "staff"],
      default: "owner",
    },
    status: {
      type: String,
      enum: ["active", "disabled"],
      default: "active",
    },
    lastLoginAt: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
    collection: "admins",
  },
);

export type AdminRecord = InferSchemaType<typeof AdminSchema> & {
  _id: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
};

export const AdminModel: Model<AdminRecord> =
  (models.Admin as Model<AdminRecord> | undefined) ?? model<AdminRecord>("Admin", AdminSchema);
