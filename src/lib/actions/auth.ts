"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { recordAudit } from "@/lib/auth/audit";
import { requireActionAdmin } from "@/lib/auth/guard";
import {
  verifyPasswordConstantTime,
  hashPassword,
  validatePasswordPolicy,
} from "@/lib/auth/password";
import { clearLoginAttempts, peekLoginRateLimit, recordFailedLogin } from "@/lib/auth/rate-limit";
import {
  SESSION_COOKIE_NAME,
  clearSessionCookie,
  createSession,
  hashClientValue,
  revokeAllSessions,
  revokeSession,
  safeAdminRedirect,
  setSessionCookie,
} from "@/lib/auth/session";
import { connectDatabase, logDatabaseError } from "@/lib/db/mongoose";
import { AdminModel } from "@/models/admin";
import { loginSchema } from "@/lib/validations/admin";
import { cookies } from "next/headers";

/**
 * Authentication server actions (Phase 3).
 *
 * Security properties:
 * - Every branch re-reads server state; nothing is decided client-side.
 * - Invalid emails and invalid passwords produce the SAME generic error.
 * - Always one full Argon2 verification (timing equalization).
 * - MongoDB-backed rate limiting wraps the credential check.
 * - Audit records cover success, failure and rate-limit events without
 *   storing passwords or raw addresses.
 */

export interface LoginState {
  error: string | null;
  /** Field-scoped validation messages for the login form. */
  fieldErrors?: Record<string, string>;
}

const GENERIC_CREDENTIALS_ERROR = "Email or password is incorrect.";
const RATE_LIMIT_ERROR =
  "Too many sign-in attempts. Please wait about 15 minutes before trying again.";

async function clientAddress(): Promise<string> {
  const list = await headers();
  return (
    list.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    list.get("x-real-ip") ||
    "unknown"
  );
}

export async function loginAction(_previous: LoginState, formData: FormData): Promise<LoginState> {
  const parsed = loginSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      fieldErrors[String(issue.path[0] ?? "form")] ??= issue.message;
    }
    return { error: "Check the highlighted fields and try again.", fieldErrors };
  }

  const { email, password } = parsed.data;
  const address = await clientAddress();

  try {
    const limit = await peekLoginRateLimit(address, email);
    if (!limit.allowed) {
      await recordAudit({
        event: "admin.login.rate_limited",
        outcome: "failure",
        email,
        address,
        detail: "Attempt blocked while the rate-limit window was open",
      });
      return { error: RATE_LIMIT_ERROR };
    }

    await connectDatabase();
    const admin = await AdminModel.findOne({ email }).lean();

    // Timing-equalized verification: unknown emails still run one full
    // Argon2 verify against a dummy hash.
    const passwordOk = await verifyPasswordConstantTime(admin?.passwordHash ?? null, password);
    const allowed =
      admin !== null && admin.status === "active" && admin.role === "owner" && passwordOk;

    if (!allowed) {
      const after = await recordFailedLogin(address, email);
      await recordAudit({
        event: "admin.login.failed",
        outcome: "failure",
        adminId: admin ? String(admin._id) : null,
        email,
        address,
        detail: !admin
          ? "Unknown email"
          : admin.status !== "active"
            ? "Account disabled"
            : !passwordOk
              ? "Password mismatch"
              : "Role not permitted",
      });
      return { error: after.allowed ? GENERIC_CREDENTIALS_ERROR : RATE_LIMIT_ERROR };
    }

    // Success: clear the window, open a session, record the login.
    const adminId = admin!._id;
    await clearLoginAttempts(address, email);
    const session = await createSession(adminId, hashClientValue(address));
    await setSessionCookie(session.token, session.expiresAt);
    await AdminModel.updateOne({ _id: adminId }, { $set: { lastLoginAt: new Date() } }).exec();
    await recordAudit({
      event: "admin.login.success",
      outcome: "success",
      adminId: String(adminId),
      email,
      address,
    });

    redirect(safeAdminRedirect(String(formData.get("next") ?? "")));
  } catch (error) {
    if (isRedirectError(error)) throw error;
    logDatabaseError("admin-login", error);
    await recordAudit({
      event: "admin.login.failed",
      outcome: "failure",
      email,
      address,
      detail: "Infrastructure failure during sign-in",
    });
    return { error: "Sign-in is temporarily unavailable. Please try again shortly." };
  }
}

export async function logoutAction(): Promise<void> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE_NAME)?.value;

  const guard = await requireActionAdmin();
  if (guard.ok) {
    await recordAudit({
      event: "admin.logout",
      outcome: "success",
      adminId: String(guard.admin._id),
      email: guard.admin.email,
      address: await clientAddress(),
    });
  }
  // Revoke server-side FIRST (even for an expired cookie, clearing follows).
  await revokeSession(token);
  await clearSessionCookie();
  redirect("/admin/login");
}

/* ── password rotation helper used by the reset CLI (kept server-safe) ── */

/**
 * Rotate an owner's password and revoke every live session. Used only by
 * `scripts/admin-reset-password.ts`; exported for its unit tests.
 */
export async function rotateOwnerPassword(email: string, newPassword: string): Promise<boolean> {
  const policy = validatePasswordPolicy(newPassword);
  if (policy) return false;

  await connectDatabase();
  const admin = await AdminModel.findOne({ email: email.trim().toLowerCase() }).lean();
  if (!admin) return false;

  const passwordHash = await hashPassword(newPassword);
  await AdminModel.updateOne({ _id: admin._id }, { $set: { passwordHash } }).exec();
  await revokeAllSessions(admin._id);
  await recordAudit({
    event: "admin.password_reset",
    outcome: "success",
    adminId: String(admin._id),
    email: admin.email,
    detail: "Password rotated; all sessions revoked",
  });
  return true;
}

/* ── internals ──────────────────────────────────────────────────────── */

/** Next.js redirect() aborts with an internal control error; never swallow it. */
function isRedirectError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "digest" in error &&
    typeof (error as { digest?: unknown }).digest === "string" &&
    (error as { digest: string }).digest.startsWith("NEXT_REDIRECT")
  );
}
