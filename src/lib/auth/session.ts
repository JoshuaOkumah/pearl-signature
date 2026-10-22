import "server-only";
import { randomBytes, createHash, timingSafeEqual } from "node:crypto";
import { cache } from "react";
import { cookies } from "next/headers";
import { connectDatabase, logDatabaseError } from "@/lib/db/mongoose";
import { AdminModel, type AdminRecord } from "@/models/admin";
import { AdminSessionModel } from "@/models/admin-session";

/**
 * Server-side admin sessions (Phase 3).
 *
 * Flow: the browser receives a 256-bit opaque random token in an HttpOnly
 * cookie; MongoDB stores only its SHA-256 hash. Every privileged operation
 * re-derives the admin from the cookie through `getSessionAdmin()` (or
 * `requireActionAdmin()` in actions), so a forged or stale cookie, a
 * revoked session, a disabled account or an expired record are all
 * rejected server-side. A browser-side "logged in" flag alone is never
 * trusted.
 */

export const SESSION_COOKIE_NAME = "pearl_admin_session";

/** Sliding-free, absolute session lifetime: one week. */
export const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1_000;

/** Opaque 256-bit session token (base64url, no structured claims). */
export function generateSessionToken(): string {
  return randomBytes(32).toString("base64url");
}

/** SHA-256 of a session token — the ONLY form persisted. */
export function hashSessionToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

/** One-way hash for client addresses in audit/session metadata. */
export function hashClientValue(value: string | null | undefined): string | null {
  if (!value) return null;
  return createHash("sha256").update(value, "utf8").digest("hex");
}

/** Constant-time comparison for equal-length hex digests. */
export function digestsEqual(a: string, b: string): boolean {
  const bufferA = Buffer.from(a, "hex");
  const bufferB = Buffer.from(b, "hex");
  return bufferA.length === bufferB.length && timingSafeEqual(bufferA, bufferB);
}

export interface CreatedSession {
  /** Raw token for the cookie — never persisted anywhere. */
  token: string;
  expiresAt: Date;
}

/** Persist a new session row and return the raw token for the cookie. */
export async function createSession(
  adminId: AdminRecord["_id"],
  ipHash: string | null,
): Promise<CreatedSession> {
  const token = generateSessionToken();
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  await connectDatabase();
  await AdminSessionModel.create({
    tokenHash: hashSessionToken(token),
    adminId,
    ipHash,
    expiresAt,
  });
  return { token, expiresAt };
}

/**
 * Resolve the admin behind a raw session token.
 *
 * Returns `null` when the token is missing/invalid, the record is gone,
 * the session has expired, the admin was deleted, or the admin is
 * disabled. Disabled accounts also revoke the session immediately.
 */
export async function getSessionAdmin(token: string | null | undefined): Promise<AdminRecord | null> {
  if (!token || token.length < 16 || token.length > 128) return null;

  try {
    await connectDatabase();
    const session = await AdminSessionModel.findOne({
      tokenHash: hashSessionToken(token),
    }).lean();

    if (!session) return null;
    // Application-level expiry is authoritative (TTL sweep lags by ~60 s).
    if (!session.expiresAt || session.expiresAt.getTime() <= Date.now()) {
      void AdminSessionModel.deleteOne({ _id: session._id })
        .exec()
        .catch(() => undefined);
      return null;
    }

    const admin = await AdminModel.findById(session.adminId).lean();
    if (!admin || admin.status !== "active") {
      void AdminSessionModel.deleteOne({ _id: session._id })
        .exec()
        .catch(() => undefined);
      return null;
    }
    return admin as AdminRecord;
  } catch (error) {
    logDatabaseError("session-validate", error);
    return null;
  }
}

/** Read the session cookie (awaited Next 16 cookies()) and resolve the admin. */
export async function getSessionAdminFromCookies(): Promise<AdminRecord | null> {
  const store = await cookies();
  return getSessionAdmin(store.get(SESSION_COOKIE_NAME)?.value);
}

/**
 * For server components: cached per render pass so a layout and its pages
 * resolve the session once per request.
 */
export const getCurrentAdmin = cache(getSessionAdminFromCookies);

/** Write the session cookie with conservative security attributes. */
export async function setSessionCookie(token: string, expiresAt: Date): Promise<void> {
  const store = await cookies();
  store.set(SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    // Scoped to the admin area: storefront requests never carry it.
    path: "/admin",
    expires: expiresAt,
  });
}

/** Remove the session cookie (logout). */
export async function clearSessionCookie(): Promise<void> {
  const store = await cookies();
  store.set(SESSION_COOKIE_NAME, "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/admin",
    expires: new Date(0),
  });
}

/** Revoke one session by its raw token (logout). */
export async function revokeSession(token: string | null | undefined): Promise<void> {
  if (!token) return;
  try {
    await connectDatabase();
    await AdminSessionModel.deleteOne({ tokenHash: hashSessionToken(token) }).exec();
  } catch (error) {
    logDatabaseError("session-revoke", error);
  }
}

/**
 * Revoke every session for an admin. Called by password reset and account
 * disable so stolen cookies die with the credential change.
 */
export async function revokeAllSessions(adminId: AdminRecord["_id"]): Promise<void> {
  try {
    await connectDatabase();
    await AdminSessionModel.deleteMany({ adminId }).exec();
  } catch (error) {
    logDatabaseError("session-revoke-all", error);
  }
}

/** True when the string contains control characters or whitespace. */
function hasUnsafeCharacters(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 32 || code === 127) return true;
  }
  return false;
}

/**
 * Allow only same-site relative redirects (open-redirect protection):
 * accepts `/admin/...` and rejects `//host`, `\\host`, absolute URLs and
 * protocol-relative tricks. Anything unexpected falls back to `/admin`.
 */
export function safeAdminRedirect(target: string | null | undefined): string {
  if (!target) return "/admin";
  const value = target.trim();
  if (!value.startsWith("/")) return "/admin";
  if (value.startsWith("//") || value.startsWith("/\\")) return "/admin";
  if (value.includes("://")) return "/admin";
  if (hasUnsafeCharacters(value)) return "/admin";
  return value;
}
