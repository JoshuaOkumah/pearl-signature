import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => {
    const error = new Error(`NEXT_REDIRECT:${url}`);
    (error as Error & { digest: string }).digest = `NEXT_REDIRECT;${url}`;
    throw error;
  }),
}));

vi.mock("next/headers", () => ({
  headers: vi.fn(async () => ({
    get: (name: string) => (name === "x-forwarded-for" ? "203.0.113.9" : null),
  })),
  cookies: vi.fn(async () => ({ get: vi.fn(() => undefined), set: vi.fn() })),
}));

vi.mock("@/lib/db/mongoose", () => ({
  connectDatabase: vi.fn(async () => undefined),
  logDatabaseError: vi.fn(),
  isDatabaseConfigured: vi.fn(() => true),
  DatabaseUnavailableError: class DatabaseUnavailableError extends Error {},
}));

vi.mock("@/models/admin", () => ({
  AdminModel: {
    findOne: vi.fn(),
    updateOne: vi.fn(() => ({ exec: async () => ({ matchedCount: 1 }) })),
  },
}));

vi.mock("@/lib/auth/audit", () => ({
  recordAudit: vi.fn(async () => undefined),
}));

vi.mock("@/lib/auth/rate-limit", () => ({
  peekLoginRateLimit: vi.fn(async () => ({ allowed: true, remaining: 5 })),
  recordFailedLogin: vi.fn(async () => ({ allowed: true, remaining: 4 })),
  clearLoginAttempts: vi.fn(async () => undefined),
}));

vi.mock("@/lib/auth/session", () => ({
  SESSION_COOKIE_NAME: "pearl_admin_session",
  createSession: vi.fn(async () => ({ token: "raw-session-token-abcdefghijklmnop", expiresAt: new Date(Date.now() + 1000) })),
  setSessionCookie: vi.fn(async () => undefined),
  clearSessionCookie: vi.fn(async () => undefined),
  revokeSession: vi.fn(async () => undefined),
  revokeAllSessions: vi.fn(async () => undefined),
  hashClientValue: vi.fn(() => "hashed-address"),
  safeAdminRedirect: vi.fn((value: string) => value || "/admin"),
}));

vi.mock("@/lib/auth/password", () => ({
  verifyPasswordConstantTime: vi.fn(async () => false),
  hashPassword: vi.fn(async () => "$argon2id$mocked"),
  validatePasswordPolicy: vi.fn(() => null),
}));

vi.mock("@/lib/auth/guard", () => ({
  requireActionAdmin: vi.fn(async () => ({ ok: false, reason: "unauthorized" as const })),
  requirePageAdmin: vi.fn(),
}));

import { redirect } from "next/navigation";
import { AdminModel } from "@/models/admin";
import { recordAudit } from "@/lib/auth/audit";
import { clearLoginAttempts, peekLoginRateLimit, recordFailedLogin } from "@/lib/auth/rate-limit";
import { createSession, revokeAllSessions, revokeSession, setSessionCookie } from "@/lib/auth/session";
import { verifyPasswordConstantTime, validatePasswordPolicy } from "@/lib/auth/password";
import { requireActionAdmin } from "@/lib/auth/guard";
import { loginAction, logoutAction, rotateOwnerPassword } from "./auth";

const OWNER = {
  _id: "64b0f00000000000000000aa",
  email: "owner@example.com",
  role: "owner",
  status: "active",
  passwordHash: "$argon2id$stored",
};

function loginForm(overrides: Record<string, string> = {}): FormData {
  const formData = new FormData();
  formData.set("email", overrides.email ?? "owner@example.com");
  formData.set("password", overrides.password ?? "correct-password-123");
  if (overrides.next !== undefined) formData.set("next", overrides.next);
  return formData;
}

function stubAdmin(admin: typeof OWNER | null) {
  vi.mocked(AdminModel.findOne).mockReturnValue({ lean: async () => admin } as never);
}

beforeEach(() => {
  vi.clearAllMocks();
  // clearAllMocks() keeps per-test return-value overrides, so every default
  // that tests may override is restated here.
  stubAdmin(null);
  vi.mocked(peekLoginRateLimit).mockResolvedValue({ allowed: true, remaining: 5 } as never);
  vi.mocked(recordFailedLogin).mockResolvedValue({ allowed: true, remaining: 4 } as never);
  vi.mocked(verifyPasswordConstantTime).mockResolvedValue(false as never);
  vi.mocked(validatePasswordPolicy).mockReturnValue(null as never);
  vi.mocked(requireActionAdmin).mockResolvedValue({ ok: false, reason: "unauthorized" } as never);
});

describe("loginAction", () => {
  it("rejects invalid form input without touching the database", async () => {
    const state = await loginAction({ error: null }, loginForm({ email: "not-an-email" }));
    expect(state.error).toBeTruthy();
    expect(state.fieldErrors?.email).toBeTruthy();
    expect(AdminModel.findOne).not.toHaveBeenCalled();
    expect(verifyPasswordConstantTime).not.toHaveBeenCalled();
  });

  it("returns the SAME generic error for unknown email and wrong password", async () => {
    stubAdmin(null);
    const unknown = await loginAction({ error: null }, loginForm());

    vi.mocked(verifyPasswordConstantTime).mockResolvedValue(false as never);
    stubAdmin(OWNER);
    const wrongPassword = await loginAction({ error: null }, loginForm());

    expect(unknown.error).toBe(wrongPassword.error);
    expect(unknown.error).toBe("Email or password is incorrect.");
    // The failure path must count the attempt and write an audit record.
    expect(recordFailedLogin).toHaveBeenCalledTimes(2);
    expect(recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({ event: "admin.login.failed", outcome: "failure" }),
    );
  });

  it("never audits the submitted password", async () => {
    stubAdmin(null);
    await loginAction({ error: null }, loginForm({ password: "super-secret-attempt" }));
    const auditPayloads = JSON.stringify(vi.mocked(recordAudit).mock.calls);
    expect(auditPayloads).not.toContain("super-secret-attempt");
  });

  it("still runs a full verification for unknown emails (timing equalization)", async () => {
    stubAdmin(null);
    vi.mocked(verifyPasswordConstantTime).mockResolvedValue(false as never);
    await loginAction({ error: null }, loginForm());
    expect(verifyPasswordConstantTime).toHaveBeenCalledWith(null, "correct-password-123");
  });

  it("opens a session and redirects on correct credentials", async () => {
    stubAdmin(OWNER);
    vi.mocked(verifyPasswordConstantTime).mockResolvedValue(true as never);

    await expect(loginAction({ error: null }, loginForm())).rejects.toThrow(/NEXT_REDIRECT/);
    expect(redirect).toHaveBeenCalledWith("/admin");
    expect(clearLoginAttempts).toHaveBeenCalled();
    expect(createSession).toHaveBeenCalled();
    expect(setSessionCookie).toHaveBeenCalled();
    expect(AdminModel.updateOne).toHaveBeenCalled(); // lastLoginAt
    expect(recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({ event: "admin.login.success", outcome: "success" }),
    );
  });

  it("treats a correct password on a DISABLED account as failure", async () => {
    vi.mocked(verifyPasswordConstantTime).mockResolvedValue(true as never);
    stubAdmin({ ...OWNER, status: "disabled" });

    const state = await loginAction({ error: null }, loginForm());
    expect(state.error).toBe("Email or password is incorrect.");
    expect(createSession).not.toHaveBeenCalled();
  });

  it("blocks immediately when the rate-limit window is already open", async () => {
    vi.mocked(peekLoginRateLimit).mockResolvedValue({ allowed: false, remaining: 0 } as never);

    const state = await loginAction({ error: null }, loginForm());
    expect(state.error).toMatch(/Too many sign-in attempts/);
    expect(verifyPasswordConstantTime).not.toHaveBeenCalled();
    expect(recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({ event: "admin.login.rate_limited" }),
    );
  });

  it("reports the rate limit once the threshold is crossed mid-attempt", async () => {
    stubAdmin(OWNER);
    vi.mocked(recordFailedLogin).mockResolvedValue({ allowed: false, remaining: 0 } as never);

    const state = await loginAction({ error: null }, loginForm());
    expect(state.error).toMatch(/Too many sign-in attempts/);
  });

  it("uses the same generic error while rate limited on the failing branch", async () => {
    stubAdmin(OWNER);
    vi.mocked(verifyPasswordConstantTime).mockResolvedValue(false as never);
    vi.mocked(recordFailedLogin).mockResolvedValue({ allowed: false, remaining: 0 } as never);

    const state = await loginAction({ error: null }, loginForm());
    expect(state.error).toMatch(/Too many sign-in attempts/);
    expect(state.error).not.toContain("owner@example.com");
  });
});

describe("logoutAction", () => {
  it("revokes the server-side session, clears the cookie and redirects to login", async () => {
    vi.mocked(requireActionAdmin).mockResolvedValue({ ok: true, admin: OWNER } as never);

    await expect(logoutAction()).rejects.toThrow(/NEXT_REDIRECT/);
    expect(revokeSession).toHaveBeenCalled(); // server-side revocation first
    expect(redirect).toHaveBeenCalledWith("/admin/login");
  });

  it("still clears the cookie and redirects when the session was already invalid", async () => {
    vi.mocked(requireActionAdmin).mockResolvedValue({ ok: false, reason: "unauthorized" as const });

    await expect(logoutAction()).rejects.toThrow(/NEXT_REDIRECT/);
    expect(revokeSession).toHaveBeenCalled();
    expect(redirect).toHaveBeenCalledWith("/admin/login");
  });
});

describe("rotateOwnerPassword (CLI recovery helper)", () => {
  it("refuses passwords that fail the policy", async () => {
    vi.mocked(validatePasswordPolicy).mockReturnValue("Password must be at least 10 characters." as never);
    expect(await rotateOwnerPassword("owner@example.com", "short")).toBe(false);
    expect(AdminModel.updateOne).not.toHaveBeenCalled();
  });

  it("reports a missing account without changing anything", async () => {
    stubAdmin(null);
    expect(await rotateOwnerPassword("nobody@example.com", "a-long-enough-password")).toBe(false);
    expect(AdminModel.updateOne).not.toHaveBeenCalled();
  });

  it("updates the hash and revokes every session on success", async () => {
    stubAdmin(OWNER);
    expect(await rotateOwnerPassword("owner@example.com", "a-long-enough-password")).toBe(true);
    expect(AdminModel.updateOne).toHaveBeenCalled();
    expect(vi.mocked(revokeAllSessions)).toHaveBeenCalledWith(OWNER._id);
    expect(recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({ event: "admin.password_reset", outcome: "success" }),
    );
  });
});
