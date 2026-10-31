import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { connectDatabase, logDatabaseError } from "@/lib/db/mongoose";
import { GuestSessionModel, type GuestSessionRecord } from "@/models/guest-session";
import {
  CHECKOUT_VERIFICATION_TTL_MS,
  GUEST_COOKIE_NAME,
  GUEST_SESSION_TTL_MS,
} from "./constants";
import { guestSessionTtlMs } from "./policy";
import { normalizeEmail } from "./otp";

/**
 * Persistent guest sessions (Phase 7B).
 *
 * The raw token exists only in an HttpOnly cookie. MongoDB stores its sha256,
 * so a database dump cannot be turned into a working cookie. Every read
 * re-validates expiry and revocation server-side; the presence of a cookie is
 * never treated as proof of anything.
 *
 * Cookie writes happen ONLY in Server Actions (Next.js 16 forbids setting
 * cookies during Server Component rendering). Reads are safe in either place.
 */

export interface GuestIdentity {
  sessionId: unknown;
  email: string;
  verifiedAt: Date;
  expiresAt: Date;
}

/** sha256 of the opaque session token: the only form persisted. */
export function hashGuestToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

/** One-way hash for a client address; no raw address is stored. */
export function hashClientAddress(value: string | null | undefined): string | null {
  if (!value) return null;
  return createHash("sha256").update(value, "utf8").digest("hex");
}

/** Cookie attributes: HttpOnly, host-only, SameSite=Lax, Secure in production. */
export function guestCookieOptions(expiresAt: Date) {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    expires: expiresAt,
    maxAge: Math.max(0, Math.floor((expiresAt.getTime() - Date.now()) / 1_000)),
  };
}

/**
 * Resolve a raw token to a live identity.
 *
 * Returns null for a missing token, a malformed token, an unknown hash, an
 * expired row or a revoked row. Errors are logged without the token.
 */
export async function resolveGuestSession(
  token: string | null | undefined,
  now = Date.now(),
): Promise<GuestIdentity | null> {
  if (!token || token.length < 32 || token.length > 128) return null;

  try {
    await connectDatabase();
    const session = (await GuestSessionModel.findOne({
      tokenHash: hashGuestToken(token),
    }).lean()) as GuestSessionRecord | null;

    if (!session) return null;
    if (session.revokedAt) return null;
    if (!session.expiresAt || session.expiresAt.getTime() <= now) return null;
    if (!session.email) return null;

    return {
      sessionId: session._id,
      email: normalizeEmail(session.email),
      verifiedAt: session.verifiedAt,
      expiresAt: session.expiresAt,
    };
  } catch (error) {
    logDatabaseError("guest-session-validate", error);
    return null;
  }
}

/** Read the cookie and resolve the remembered identity, or null. */
export async function getGuestIdentity(now = Date.now()): Promise<GuestIdentity | null> {
  const store = await cookies();
  return resolveGuestSession(store.get(GUEST_COOKIE_NAME)?.value, now);
}

/**
 * Create a session for a freshly verified email and rotate any existing one.
 *
 * Rotation is mandatory after authentication: a token that existed before the
 * verification must never become the authenticated token (session fixation).
 */
export async function rotateGuestSession(
  email: string,
  ipHash: string | null,
  now = Date.now(),
): Promise<{ identity: GuestIdentity; token: string }> {
  const store = await cookies();
  const currentToken = store.get(GUEST_COOKIE_NAME)?.value;

  if (currentToken) {
    try {
      await connectDatabase();
      await GuestSessionModel.updateOne(
        { tokenHash: hashGuestToken(currentToken), revokedAt: null },
        { $set: { revokedAt: new Date(now) } },
      );
    } catch (error) {
      logDatabaseError("guest-session-rotate-revoke", error);
    }
  }

  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(now + guestSessionTtlMs());
  await connectDatabase();
  const created = await GuestSessionModel.create({
    tokenHash: hashGuestToken(token),
    email: normalizeEmail(email),
    verifiedAt: new Date(now),
    expiresAt,
    revokedAt: null,
    ipHash,
  });

  store.set(GUEST_COOKIE_NAME, token, guestCookieOptions(expiresAt));

  return {
    identity: {
      sessionId: created._id,
      email: normalizeEmail(email),
      verifiedAt: new Date(now),
      expiresAt,
    },
    token,
  };
}

/** Revoke the session behind the current cookie and clear the cookie. */
export async function revokeCurrentGuestSession(now = Date.now()): Promise<boolean> {
  const store = await cookies();
  const token = store.get(GUEST_COOKIE_NAME)?.value;
  let revoked = false;

  if (token) {
    try {
      await connectDatabase();
      const result = await GuestSessionModel.updateOne(
        { tokenHash: hashGuestToken(token), revokedAt: null },
        { $set: { revokedAt: new Date(now) } },
      );
      revoked = result.modifiedCount > 0;
    } catch (error) {
      logDatabaseError("guest-session-revoke", error);
    }
  }

  store.set(GUEST_COOKIE_NAME, "", {
    ...guestCookieOptions(new Date(0)),
    maxAge: 0,
    expires: new Date(0),
  });
  return revoked;
}

/** Mask an address for display: first local character plus the domain. */
export { maskEmail } from "./policy";

export { GUEST_SESSION_TTL_MS, CHECKOUT_VERIFICATION_TTL_MS };
