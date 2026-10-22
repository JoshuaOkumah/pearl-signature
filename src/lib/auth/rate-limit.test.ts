import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db/mongoose", () => ({
  connectDatabase: vi.fn(async () => undefined),
  logDatabaseError: vi.fn(),
  isDatabaseConfigured: vi.fn(() => true),
  DatabaseUnavailableError: class DatabaseUnavailableError extends Error {},
}));

vi.mock("@/models/login-attempt", () => ({
  LoginAttemptModel: { findOne: vi.fn(), findOneAndUpdate: vi.fn(), deleteOne: vi.fn() },
  LOGIN_MAX_ATTEMPTS: 5,
  LOGIN_WINDOW_MS: 15 * 60 * 1_000,
}));

import { LOGIN_MAX_ATTEMPTS } from "@/models/login-attempt";
import { LoginAttemptModel } from "@/models/login-attempt";
import { clearLoginAttempts, peekLoginRateLimit, recordFailedLogin } from "./rate-limit";

beforeEach(() => {
  vi.clearAllMocks();
});

const NOW = 1_760_000_000_000;

describe("peekLoginRateLimit", () => {
  it("allows attempts while the window is below the threshold", async () => {
    vi.mocked(LoginAttemptModel.findOne).mockReturnValue({
      select: () => ({ lean: async () => ({ count: 3 }) }),
    } as never);

    const state = await peekLoginRateLimit("203.0.113.9", "owner@example.com", NOW);
    expect(state).toEqual({ allowed: true, remaining: 2 });
  });

  it("blocks once the threshold is reached", async () => {
    vi.mocked(LoginAttemptModel.findOne).mockReturnValue({
      select: () => ({ lean: async () => ({ count: LOGIN_MAX_ATTEMPTS }) }),
    } as never);

    const state = await peekLoginRateLimit("203.0.113.9", "owner@example.com", NOW);
    expect(state).toEqual({ allowed: false, remaining: 0 });
  });

  it("treats a missing window as a fresh start", async () => {
    vi.mocked(LoginAttemptModel.findOne).mockReturnValue({
      select: () => ({ lean: async () => null }),
    } as never);

    const state = await peekLoginRateLimit("203.0.113.9", "owner@example.com", NOW);
    expect(state).toEqual({ allowed: true, remaining: LOGIN_MAX_ATTEMPTS });
  });

  it("never stores the raw address or email in the query filter", async () => {
    vi.mocked(LoginAttemptModel.findOne).mockReturnValue({
      select: () => ({ lean: async () => null }),
    } as never);

    await peekLoginRateLimit("203.0.113.9", "owner@example.com", NOW);
    const filter = JSON.stringify(vi.mocked(LoginAttemptModel.findOne).mock.calls[0][0]);
    expect(filter).not.toContain("203.0.113.9");
    expect(filter).not.toContain("owner@example.com");
    expect(filter).toContain("la:"); // hashed bucket key
  });
});

describe("recordFailedLogin", () => {
  it("counts atomically via upsert and reports the new state", async () => {
    vi.mocked(LoginAttemptModel.findOneAndUpdate).mockReturnValue({
      lean: async () => ({ count: 4 }),
    } as never);

    const state = await recordFailedLogin("203.0.113.9", "owner@example.com", NOW);
    expect(state).toEqual({ allowed: true, remaining: 1 });

    const [filter, update, options] = vi.mocked(LoginAttemptModel.findOneAndUpdate).mock.calls[0];
    expect(options).toMatchObject({ upsert: true, new: true });
    // $inc is the concurrency-safe counter; $setOnInsert fixes the expiry.
    expect(JSON.stringify(update)).toContain("$inc");
    expect(JSON.stringify(update)).toContain("$setOnInsert");
    expect(JSON.stringify(filter)).not.toContain("owner@example.com");
  });

  it("reports the blocked state when the increment crosses the threshold", async () => {
    vi.mocked(LoginAttemptModel.findOneAndUpdate).mockReturnValue({
      lean: async () => ({ count: LOGIN_MAX_ATTEMPTS }),
    } as never);

    const state = await recordFailedLogin("203.0.113.9", "owner@example.com", NOW);
    expect(state).toEqual({ allowed: false, remaining: 0 });
  });

  it("uses different bucket keys for different time windows", async () => {
    vi.mocked(LoginAttemptModel.findOneAndUpdate).mockReturnValue({
      lean: async () => ({ count: 1 }),
    } as never);

    await recordFailedLogin("203.0.113.9", "owner@example.com", NOW);
    await recordFailedLogin("203.0.113.9", "owner@example.com", NOW + 16 * 60 * 1_000);
    const firstKey = (
      vi.mocked(LoginAttemptModel.findOneAndUpdate).mock.calls[0][0] as unknown as Record<string, string>
    ).key;
    const secondKey = (
      vi.mocked(LoginAttemptModel.findOneAndUpdate).mock.calls[1][0] as unknown as Record<string, string>
    ).key;
    expect(firstKey).not.toBe(secondKey);
  });

  it("fails closed when the database is unreachable", async () => {
    vi.mocked(LoginAttemptModel.findOneAndUpdate).mockRejectedValue(new Error("down") as never);

    const state = await recordFailedLogin("203.0.113.9", "owner@example.com", NOW);
    expect(state).toEqual({ allowed: false, remaining: 0 });
  });
});

describe("clearLoginAttempts", () => {
  it("removes only the current window after a successful login", async () => {
    vi.mocked(LoginAttemptModel.deleteOne).mockReturnValue({ exec: async () => ({ deletedCount: 1 }) } as never);

    await clearLoginAttempts("203.0.113.9", "owner@example.com", NOW);
    expect(LoginAttemptModel.deleteOne).toHaveBeenCalledTimes(1);
  });

  it("never throws when the database is unreachable", async () => {
    vi.mocked(LoginAttemptModel.deleteOne).mockReturnValue({
      exec: async () => Promise.reject(new Error("down")),
    } as never);

    await expect(clearLoginAttempts("203.0.113.9", "owner@example.com", NOW)).resolves.toBeUndefined();
  });
});
