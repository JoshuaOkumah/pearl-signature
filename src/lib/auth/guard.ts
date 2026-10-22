import "server-only";
import { redirect } from "next/navigation";
import type { AdminRecord } from "@/models/admin";
import { getCurrentAdmin, getSessionAdminFromCookies } from "@/lib/auth/session";

/**
 * Authorization guards (Phase 3).
 *
 * Two layers, both server-side:
 *
 * 1. `requirePageAdmin()` — used by admin layouts/pages; redirects anonymous
 *    visitors to the login screen. This is navigation UX, not the security
 *    boundary.
 * 2. `requireActionAdmin()` — used INSIDE every Server Action and mutation
 *    handler; re-validates the session cookie and returns a discriminated
 *    result. No mutation can succeed merely because the caller reached an
 *    admin URL: page guards alone are never trusted.
 *
 * Only the `owner` role with `status: "active"` passes. Client-submitted
 * roles, ids or flags are never consulted anywhere in this module.
 */

export type ActionAuthResult =
  | { ok: true; admin: AdminRecord }
  | { ok: false; reason: "unauthorized" };

/** Page/layout guard: redirect anonymous visitors to the login screen. */
export async function requirePageAdmin(): Promise<AdminRecord> {
  const admin = await getCurrentAdmin();
  if (!admin) redirect("/admin/login");
  if (admin.role !== "owner") redirect("/admin/login");
  return admin;
}

/**
 * Mutation guard for Server Actions / route handlers: independent of any
 * page-level redirect, returns a safe result instead of throwing.
 */
export async function requireActionAdmin(): Promise<ActionAuthResult> {
  const admin = await getSessionAdminFromCookies();
  if (!admin || admin.role !== "owner" || admin.status !== "active") {
    return { ok: false, reason: "unauthorized" };
  }
  return { ok: true, admin };
}
