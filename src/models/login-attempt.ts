import { Schema, models, model, type InferSchemaType, type Model } from "mongoose";

/**
 * Login rate-limit buckets (Phase 3).
 *
 * MongoDB-backed so the limit survives restarts and holds across instances,
 * unlike an in-memory counter. Design:
 *
 * - The bucket key hashes the client address together with the attempted
 *   email and embeds a time bucket, so every window opens a fresh document.
 * - Attempts are counted with an atomic upsert `$inc` (concurrency-safe).
 * - A TTL index on `expiresAt` bounds the collection; old windows
 *   disappear without manual cleanup.
 *
 * Limitations (documented in docs/ADMIN_AUTH.md): shared addresses (NAT)
 * share a bucket, TTL cleanup lags up to ~60 s, and the counter cannot
 * distinguish attackers from legitimate users behind one address. The
 * store remains safe because passwords are Argon2id-hashed and sessions
 * are opaque server-side records.
 */

export const LOGIN_WINDOW_MS = 15 * 60 * 1_000;
export const LOGIN_MAX_ATTEMPTS = 5;

export const LoginAttemptSchema = new Schema(
  {
    key: {
      type: String,
      required: true,
      unique: true,
      maxlength: [200, "Attempt key is malformed"],
    },
    count: {
      type: Number,
      required: true,
      min: 0,
      default: 0,
    },
    expiresAt: {
      type: Date,
      required: true,
    },
  },
  {
    timestamps: false,
    collection: "admin_login_attempts",
  },
);

export type LoginAttemptRecord = InferSchemaType<typeof LoginAttemptSchema>;

export const LoginAttemptModel: Model<LoginAttemptRecord> =
  (models.LoginAttempt as Model<LoginAttemptRecord> | undefined) ??
  model<LoginAttemptRecord>("LoginAttempt", LoginAttemptSchema);
