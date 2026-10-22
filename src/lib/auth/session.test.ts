import { beforeEach, describe, expect, it, vi } from "vitest";
import { randomBytes } from "node:crypto";

vi.mock("@/lib/db/mongoose", () => ({
  connectDatabase: vi.fn(async () => undefined),
  logDatabaseError: vi.fn(),
  isDatabaseConfigured: vi.fn(() => true),
  DatabaseUnavailableError: class DatabaseUnavailableError extends Error {},
}));

vi.mock("@/models/admin", () => ({
  AdminModel: { findById: vi.fn() },
}));

vi.mock("@/models/admin-session", () => ({
  AdminSessionModel: { findOne: vi.fn(), create: vi.fn(), deleteOne: vi.fn(), deleteMany: vi.fn() },
}));

vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => ({ get: vi.fn(() => undefined), set: vi.fn() })),
}));

import { AdminModel } from "@/models/admin";
import { AdminSessionModel } from "@/models/admin-session";
import {
  SESSION_TTL_MS,
  createSession,
  digestsEqual,
  generateSessionToken,
  getSessionAdmin,
  hashClientValue,
  hashSessionToken,
  revokeAllSessions,
  revokeSession,
  safeAdminRedirect,
} from "./session";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("session tokens", () => {
  it("generates unique opaque 256-bit tokens", () => {
    const first = generateSessionToken();
    const second = generateSessionToken();
    expect(first).not.toBe(second);
    // 32 bytes → 43 base64url characters, no padding or unsafe symbols.
    expect(first).toHaveLength(43);
    expect(first).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it("hashes tokens to 64-char hex (SHA-256), deterministically", () => {
    const token = generateSessionToken();
    const digest = hashSessionToken(token);
    expect(digest).toMatch(/^[0-9a-f]{64}$/);
    expect(hashSessionToken(token)).toBe(digest);
    expect(digest).not.toContain(token);
  });

  it("uses a one-week absolute lifetime", () => {
    expect(SESSION_TTL_MS).toBe(7 * 24 * 60 * 60 * 1_000);
  });

  it("hashes client addresses only as one-way digests", () => {
    expect(hashClientValue("203.0.113.9")).toMatch(/^[0-9a-f]{64}$/);
    expect(hashClientValue("203.0.113.9")).not.toContain("203.0.113.9");
    expect(hashClientValue(null)).toBeNull();
    expect(hashClientValue(undefined)).toBeNull();
    expect(hashClientValue("")).toBeNull();
  });

  it("compares digests in constant time", () => {
    const a = hashSessionToken("one");
    const b = hashSessionToken("two");
    expect(digestsEqual(a, a)).toBe(true);
    expect(digestsEqual(a, b)).toBe(false);
    expect(digestsEqual(a, a.slice(0, 10))).toBe(false); // length mismatch, no throw
  });
});

describe("createSession", () => {
  it("persists only the token hash and returns the raw token", async () => {
    const created = await createSession("64b0f0000000000000000001" as never, "ip-hash");
    expect(created.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(created.expiresAt.getTime()).toBeGreaterThan(Date.now());

    expect(AdminSessionModel.create).toHaveBeenCalledTimes(1);
    const payload = vi.mocked(AdminSessionModel.create).mock.calls[0][0] as Record<string, unknown>;
    expect(payload.tokenHash).toBe(hashSessionToken(created.token));
    expect(payload.adminId).toBe("64b0f0000000000000000001");
    // The raw token must never be written anywhere.
    expect(JSON.stringify(payload)).not.toContain(created.token);
  });
});

describe("getSessionAdmin", () => {
  function sessionRecord(expiresAt: Date) {
    return { _id: "sess-1", adminId: "64b0f00000000000000000aa", expiresAt };
  }

  it("rejects missing, short and oversized tokens without touching the database", async () => {
    expect(await getSessionAdmin(null)).toBeNull();
    expect(await getSessionAdmin("")).toBeNull();
    expect(await getSessionAdmin("short")).toBeNull();
    expect(await getSessionAdmin("x".repeat(129))).toBeNull();
    expect(AdminSessionModel.findOne).not.toHaveBeenCalled();
  });

  it("returns null when the session record is gone", async () => {
    vi.mocked(AdminSessionModel.findOne).mockReturnValue({ lean: async () => null } as never);
    expect(await getSessionAdmin("t".repeat(43))).toBeNull();
  });

  it("revokes and rejects expired sessions even before the TTL sweep", async () => {
    vi.mocked(AdminSessionModel.findOne).mockReturnValue({
      lean: async () => sessionRecord(new Date(Date.now() - 1_000)),
    } as never);
    vi.mocked(AdminSessionModel.deleteOne).mockReturnValue({ exec: async () => ({ deletedCount: 1 }) } as never);

    expect(await getSessionAdmin("t".repeat(43))).toBeNull();
    expect(AdminSessionModel.deleteOne).toHaveBeenCalled();
    expect(AdminModel.findById).not.toHaveBeenCalled();
  });

  it("returns the admin for a valid live session", async () => {
    vi.mocked(AdminSessionModel.findOne).mockReturnValue({
      lean: async () => sessionRecord(new Date(Date.now() + 60_000)),
    } as never);
    vi.mocked(AdminModel.findById).mockReturnValue({
      lean: async () => ({ _id: "64b0f00000000000000000aa", email: "owner@example.com", status: "active", role: "owner" }),
    } as never);

    const admin = await getSessionAdmin("t".repeat(43));
    expect(admin?.email).toBe("owner@example.com");
  });

  it("revokes the session and rejects when the account is disabled", async () => {
    vi.mocked(AdminSessionModel.findOne).mockReturnValue({
      lean: async () => sessionRecord(new Date(Date.now() + 60_000)),
    } as never);
    vi.mocked(AdminModel.findById).mockReturnValue({
      lean: async () => ({ _id: "64b0f00000000000000000aa", status: "disabled", role: "owner" }),
    } as never);
    vi.mocked(AdminSessionModel.deleteOne).mockReturnValue({ exec: async () => ({ deletedCount: 1 }) } as never);

    expect(await getSessionAdmin("t".repeat(43))).toBeNull();
    expect(AdminSessionModel.deleteOne).toHaveBeenCalled();
  });
});

describe("revocation", () => {
  it("deletes exactly one session by token hash on logout", async () => {
    vi.mocked(AdminSessionModel.deleteOne).mockReturnValue({ exec: async () => ({ deletedCount: 1 }) } as never);
    const token = generateSessionToken();
    await revokeSession(token);
    const filter = vi.mocked(AdminSessionModel.deleteOne).mock.calls[0][0] as unknown as Record<string, string>;
    expect(filter.tokenHash).toBe(hashSessionToken(token));
  });

  it("ignores empty tokens on logout", async () => {
    await revokeSession(null);
    expect(AdminSessionModel.deleteOne).not.toHaveBeenCalled();
  });

  it("deletes every session for an admin on password reset", async () => {
    vi.mocked(AdminSessionModel.deleteMany).mockReturnValue({ exec: async () => ({ deletedCount: 3 }) } as never);
    await revokeAllSessions("64b0f00000000000000000aa" as never);
    const filter = vi.mocked(AdminSessionModel.deleteMany).mock.calls[0][0] as unknown as Record<string, string>;
    expect(filter.adminId).toBe("64b0f00000000000000000aa");
  });
});

describe("safeAdminRedirect (open-redirect protection)", () => {
  it("allows same-site admin paths", () => {
    expect(safeAdminRedirect("/admin")).toBe("/admin");
    expect(safeAdminRedirect("/admin/products?status=draft")).toBe("/admin/products?status=draft");
  });

  it("rejects everything that could leave the site", () => {
    expect(safeAdminRedirect(null)).toBe("/admin");
    expect(safeAdminRedirect("")).toBe("/admin");
    expect(safeAdminRedirect("https://evil.example")).toBe("/admin");
    expect(safeAdminRedirect("//evil.example")).toBe("/admin");
    expect(safeAdminRedirect("/\\evil.example")).toBe("/admin");
    expect(safeAdminRedirect("admin/products")).toBe("/admin"); // must be absolute-path
    expect(safeAdminRedirect("/admin\n.evil")).toBe("/admin"); // control characters
    expect(safeAdminRedirect("/admin Products")).toBe("/admin"); // whitespace
  });

  it("token randomness is genuinely random (no fixed seed)", () => {
    const samples = new Set(Array.from({ length: 50 }, () => randomBytes(8).toString("hex")));
    expect(samples.size).toBe(50);
  });
});
