import "server-only";
import { connectDatabase, logDatabaseError } from "@/lib/db/mongoose";
import { AuditLogModel, type AuditEvent } from "@/models/audit-log";
import { hashClientValue } from "@/lib/auth/session";

/**
 * Admin audit trail (Phase 3).
 *
 * `recordAudit` is intentionally fire-and-forget: an audit write failure
 * is logged server-side but never fails the operation it describes or
 * leaks anything to the client.
 *
 * Never pass passwords, tokens, hashes or raw IPs here — the record shape
 * only accepts enum events, operator-safe details and hashed addresses.
 */

export interface AuditInput {
  event: AuditEvent;
  outcome: "success" | "failure";
  adminId?: string | null;
  email?: string | null;
  /** Raw client address — hashed before it reaches the database. */
  address?: string | null;
  target?: { type?: "product" | "category" | "admin" | "order" | "store" | "notification"; id?: string | null; label?: string | null };
  /** Short operator-facing context. No secrets, no free-form payloads. */
  detail?: string | null;
}

export async function recordAudit(input: AuditInput): Promise<void> {
  try {
    await connectDatabase();
    await AuditLogModel.create({
      event: input.event,
      outcome: input.outcome,
      adminId: input.adminId ?? null,
      email: input.email?.trim().toLowerCase() ?? null,
      ipHash: hashClientValue(input.address),
      target: input.target ?? {},
      detail: input.detail?.slice(0, 200) ?? null,
    });
  } catch (error) {
    // Audit failures must never break the admin action or surface to users.
    logDatabaseError("audit", error);
  }
}
