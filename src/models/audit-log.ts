import { Schema, models, model, type InferSchemaType, type Model, type Types } from "mongoose";

/**
 * Lightweight admin audit log (Phase 3).
 *
 * Records who did what and when for security-relevant events. It never
 * stores secrets: no passwords, no hashes, no session tokens. Client
 * addresses appear only as one-way hashes, and free-text `detail` is
 * short and operator-authored.
 *
 * Storage stays bounded on Atlas M0: a TTL index expires entries after
 * `AUDIT_RETENTION_DAYS`, and the event list is a closed enum.
 */

export const AUDIT_RETENTION_DAYS = 180;

export const AUDIT_EVENTS = [
  "admin.login.success",
  "admin.login.failed",
  "admin.login.rate_limited",
  "admin.logout",
  "admin.password_reset",
  "product.created",
  "product.updated",
  "product.status_changed",
  "product.archived",
  "category.created",
  "category.updated",
  "category.visibility_changed",
  "image.attached",
  "image.updated",
  "image.removed",
  "store.settings_updated",
  "order.placed",
  "order.status_changed",
  "order.payment_recorded",
  "order.note_added",
  "payment.reconciled",
] as const;

export type AuditEvent = (typeof AUDIT_EVENTS)[number];

const AuditTargetSchema = new Schema(
  {
    type: {
      type: String,
      enum: ["product", "category", "admin", "order", "store"],
      default: undefined,
    },
    id: {
      type: String,
      default: null,
      maxlength: [120, "Audit target id is malformed"],
    },
    label: {
      type: String,
      default: null,
      maxlength: [120, "Audit target label is too long"],
    },
  },
  { _id: false },
);

export const AuditLogSchema = new Schema(
  {
    event: {
      type: String,
      enum: { values: AUDIT_EVENTS, message: "Unknown audit event" },
      required: true,
    },
    outcome: {
      type: String,
      enum: ["success", "failure"],
      required: true,
    },
    adminId: {
      type: Schema.Types.ObjectId,
      ref: "Admin",
      default: null,
    },
    /** Normalised email involved in the event (account context, not a secret). */
    email: {
      type: String,
      default: null,
      maxlength: [160, "Email is too long"],
    },
    ipHash: {
      type: String,
      default: null,
      maxlength: [128, "IP hash is malformed"],
    },
    target: {
      type: AuditTargetSchema,
      default: () => ({}),
    },
    detail: {
      type: String,
      default: null,
      maxlength: [200, "Audit detail is too long"],
    },
  },
  {
    timestamps: { createdAt: true, updatedAt: false },
    collection: "admin_audit_logs",
  },
);

/* Retention + query indexes. */
AuditLogSchema.index({ createdAt: 1 }, { expireAfterSeconds: AUDIT_RETENTION_DAYS * 24 * 60 * 60 });
AuditLogSchema.index({ createdAt: -1 });
AuditLogSchema.index({ adminId: 1, createdAt: -1 });

export type AuditLogRecord = InferSchemaType<typeof AuditLogSchema> & {
  _id: Types.ObjectId;
  adminId: Types.ObjectId | null;
  createdAt: Date;
};

export const AuditLogModel: Model<AuditLogRecord> =
  (models.AuditLog as Model<AuditLogRecord> | undefined) ??
  model<AuditLogRecord>("AuditLog", AuditLogSchema);
