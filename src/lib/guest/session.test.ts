// @vitest-environment node
import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Persistent guest sessions (Phase 7B).
 *
 * The security claims are structural, so they are asserted structurally: only a
 * sha256 of the token is ever written, the raw token lives in an HttpOnly,
 * host-only cookie, every read re-checks expiry and revocation, and a
 * successful verification always rotates the token. Next's cookie store and
 * mongoose are mocked because the properties under test are our own rules, not
 * theirs.
 */

const mocks = vi.hoisted(() => {
  const store = { get: vi.fn(), set: vi.fn() };
  return {
    store,
    cookies: vi.fn(async () => store),
    connectDatabase: vi.fn(async () => undefined),
    logDatabaseError: vi.fn(),
    findOne: vi.fn(),
    updateOne: vi.fn(),
    create: vi.fn(),
  };
});

vi.mock("next/headers", () => ({ cookies: mocks.cookies }));
vi.mock("@/lib/db/mongoose", () => ({
  connectDatabase: mocks.connectDatabase,
  logDatabaseError: mocks.logDatabaseError,
}));
vi.mock("@/models/guest-session", () => ({
  GuestSessionModel: {
    findOne: mocks.findOne,
    updateOne: mocks.updateOne,
    create: mocks.create,
  },
}));

const {
  guestCookieOptions,
  hashClientAddress,
  hashGuestToken,
  resolveGuestSession,
  revokeCurrentGuestSession,
  rotateGuestSession,
} = await import("./session");

const { GUEST_COOKIE_NAME, GUEST_SESSION_TTL_MS } = await import("./constants");

function row(overrides: Record<string, unknown> = {}) {
  const now = Date.now();
  return {
    _id: "session-id",
    tokenHash: "a".repeat(64),
    email: "ada@example.com",
    verifiedAt: new Date(now),
    expiresAt: new Date(now + 1_000),
    revokedAt: null,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.store.get.mockReturnValue(undefined);
  mocks.updateOne.mockResolvedValue({ modifiedCount: 1 });
  mocks.create.mockResolvedValue({ _id: "session-id" });
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("hashGuestToken", () => {
  it("is the sha256 of the token and never the token itself", () => {
    const token = "t".repeat(43);
    expect(hashGuestToken(token)).toBe(createHash("sha256").update(token, "utf8").digest("hex"));
    expect(hashGuestToken(token)).not.toBe(token);
  });

  it("hashes a client address one way", () => {
    expect(hashClientAddress("203.0.113.5")).toMatch(/^[0-9a-f]{64}$/);
    expect(hashClientAddress("203.0.113.5")).not.toContain("203.0.113.5");
    expect(hashClientAddress(null)).toBeNull();
    expect(hashClientAddress("")).toBeNull();
  });
});

describe("guestCookieOptions", () => {
  it("is HttpOnly, SameSite=Lax, path-scoped and host-only in production", () => {
    vi.stubEnv("NODE_ENV", "production");
    const expiresAt = new Date(Date.now() + 60_000);
    const options = guestCookieOptions(expiresAt) as Record<string, unknown>;

    expect(options.httpOnly).toBe(true);
    expect(options.sameSite).toBe("lax");
    expect(options.path).toBe("/");
    expect(options.secure).toBe(true);
    // Host-only: no Domain attribute, so a sibling subdomain cannot receive it.
    expect(options.domain).toBeUndefined();
    expect(options.expires).toBe(expiresAt);
    expect(options.maxAge).toBeGreaterThan(0);
  });

  it("is not marked Secure outside production (plain-HTTP local development)", () => {
    vi.stubEnv("NODE_ENV", "development");
    expect((guestCookieOptions(new Date()) as Record<string, unknown>).secure).toBe(false);
  });
});

describe("resolveGuestSession", () => {
  it("rejects a missing, short or overlong token without touching the database", async () => {
    expect(await resolveGuestSession(null)).toBeNull();
    expect(await resolveGuestSession(undefined)).toBeNull();
    expect(await resolveGuestSession("x".repeat(31))).toBeNull();
    expect(await resolveGuestSession("x".repeat(129))).toBeNull();
    expect(mocks.findOne).not.toHaveBeenCalled();
  });

  it("returns null for an unknown digest", async () => {
    mocks.findOne.mockReturnValue({ lean: async () => null });
    expect(await resolveGuestSession("t".repeat(43))).toBeNull();
  });

  it("returns null for a revoked session even before its TTL sweep", async () => {
    mocks.findOne.mockReturnValue({ lean: async () => row({ revokedAt: new Date() }) });
    expect(await resolveGuestSession("t".repeat(43))).toBeNull();
  });

  it("returns null for an expired session", async () => {
    mocks.findOne.mockReturnValue({
      lean: async () => row({ expiresAt: new Date(Date.now() - 1) }),
    });
    expect(await resolveGuestSession("t".repeat(43))).toBeNull();
  });

  it("returns the caller's own normalised identity for a live session", async () => {
    const verifiedAt = new Date(Date.now() - 1_000);
    const expiresAt = new Date(Date.now() + 60_000);
    mocks.findOne.mockReturnValue({
      lean: async () => row({ email: "  Ada@Example.COM ", verifiedAt, expiresAt }),
    });

    const identity = await resolveGuestSession("t".repeat(43));
    expect(identity).toMatchObject({ email: "ada@example.com", verifiedAt, expiresAt });
    expect(mocks.findOne).toHaveBeenCalledWith({ tokenHash: hashGuestToken("t".repeat(43)) });
  });

  it("never accepts a row with no verified email", async () => {
    mocks.findOne.mockReturnValue({ lean: async () => row({ email: "" }) });
    expect(await resolveGuestSession("t".repeat(43))).toBeNull();
  });
});

describe("rotateGuestSession", () => {
  it("revokes the previous token, stores only the new digest and sets the cookie", async () => {
    mocks.store.get.mockReturnValue({ value: "old-token-value-with-enough-length" });
    const before = Date.now();

    const { token, identity } = await rotateGuestSession("  Ada@Example.COM ", "iphash", before);

    // Session fixation: the token that existed before verification is dead.
    expect(mocks.updateOne).toHaveBeenCalledWith(
      { tokenHash: hashGuestToken("old-token-value-with-enough-length"), revokedAt: null },
      { $set: { revokedAt: new Date(before) } },
    );

    // 32 random bytes as base64url: 43 characters, 256 bits of entropy.
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);

    const created = mocks.create.mock.calls[0][0] as Record<string, unknown>;
    expect(created.tokenHash).toBe(hashGuestToken(token));
    expect(created.email).toBe("ada@example.com");
    expect(created.ipHash).toBe("iphash");
    expect(created.expiresAt).toEqual(new Date(before + GUEST_SESSION_TTL_MS));
    // The raw token must not be persisted anywhere.
    expect(JSON.stringify(created)).not.toContain(token);

    expect(mocks.store.set).toHaveBeenCalledTimes(1);
    const [name, value, options] = mocks.store.set.mock.calls[0];
    expect(name).toBe(GUEST_COOKIE_NAME);
    expect(value).toBe(token);
    expect(options.httpOnly).toBe(true);

    expect(identity.email).toBe("ada@example.com");
    expect(identity.verifiedAt).toEqual(new Date(before));
  });

  it("does not try to revoke when the browser had no session", async () => {
    await rotateGuestSession("ada@example.com", null);
    expect(mocks.updateOne).not.toHaveBeenCalled();
    expect(mocks.create).toHaveBeenCalledTimes(1);
  });

  it("honours the operator's session lifetime", async () => {
    vi.stubEnv("GUEST_SESSION_TTL_DAYS", "7");
    const before = Date.now();
    await rotateGuestSession("ada@example.com", null, before);
    const created = mocks.create.mock.calls[0][0] as Record<string, unknown>;
    expect(created.expiresAt).toEqual(new Date(before + 7 * 24 * 60 * 60 * 1_000));
  });
});

describe("revokeCurrentGuestSession", () => {
  it("revokes the row and clears the cookie", async () => {
    mocks.store.get.mockReturnValue({ value: "live-token-value-with-enough-length" });

    const revoked = await revokeCurrentGuestSession(1_000);

    expect(revoked).toBe(true);
    expect(mocks.updateOne).toHaveBeenCalledWith(
      { tokenHash: hashGuestToken("live-token-value-with-enough-length"), revokedAt: null },
      { $set: { revokedAt: new Date(1_000) } },
    );
    const [name, value, options] = mocks.store.set.mock.calls[0];
    expect(name).toBe(GUEST_COOKIE_NAME);
    expect(value).toBe("");
    expect(options.maxAge).toBe(0);
    expect(options.expires).toEqual(new Date(0));
  });

  it("still clears the cookie when there was no session", async () => {
    expect(await revokeCurrentGuestSession()).toBe(false);
    expect(mocks.updateOne).not.toHaveBeenCalled();
    expect(mocks.store.set).toHaveBeenCalledTimes(1);
  });
});
