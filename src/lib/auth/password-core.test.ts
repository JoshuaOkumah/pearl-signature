import { describe, expect, it } from "vitest";
import {
  hashPassword,
  MAX_PASSWORD_LENGTH,
  MIN_PASSWORD_LENGTH,
  validatePasswordPolicy,
  verifyPassword,
  verifyPasswordConstantTime,
} from "./password-core";

/**
 * Phase 3 password hashing: Argon2id. These tests run the REAL hashing
 * implementation (no network, no database) to prove the property that
 * matters: stored output never contains the plaintext, verification only
 * succeeds for the right password, and the policy is enforced.
 */
describe("password policy", () => {
  it("requires at least the minimum length", () => {
    expect(validatePasswordPolicy("short")).toMatch(/at least/);
    expect(validatePasswordPolicy("a".repeat(MIN_PASSWORD_LENGTH - 1))).toMatch(/at least/);
    expect(validatePasswordPolicy("a".repeat(MIN_PASSWORD_LENGTH))).toBeNull();
  });

  it("requires a value and bounds the length", () => {
    expect(validatePasswordPolicy("")).toMatch(/required/);
    expect(validatePasswordPolicy(undefined)).toMatch(/required/);
    expect(validatePasswordPolicy("x".repeat(MAX_PASSWORD_LENGTH + 1))).toMatch(/at most/);
  });
});

describe("hashPassword / verifyPassword", () => {
  it("produces an encoded Argon2id hash that excludes the plaintext", async () => {
    const hash = await hashPassword("correct horse battery staple");
    expect(hash.startsWith("$argon2id$")).toBe(true);
    expect(hash).not.toContain("correct horse battery staple");
    // OWASP baseline parameters are embedded in the encoding.
    expect(hash).toContain("m=19456");
    expect(hash).toContain("t=2");
    expect(hash).toContain("p=1");
  });

  it("verifies the right password and rejects the wrong one", async () => {
    const hash = await hashPassword("a-very-good-password");
    expect(await verifyPassword(hash, "a-very-good-password")).toBe(true);
    expect(await verifyPassword(hash, "a-very-good-passwore")).toBe(false);
    expect(await verifyPassword(hash, "")).toBe(false);
  });

  it("salts: identical passwords hash differently", async () => {
    const first = await hashPassword("same-password-twice");
    const second = await hashPassword("same-password-twice");
    expect(first).not.toBe(second);
    expect(await verifyPassword(first, "same-password-twice")).toBe(true);
    expect(await verifyPassword(second, "same-password-twice")).toBe(true);
  });

  it("returns false for malformed stored hashes instead of throwing", async () => {
    expect(await verifyPassword("not-a-hash", "whatever")).toBe(false);
    expect(await verifyPassword("", "whatever")).toBe(false);
  });
});

describe("verifyPasswordConstantTime", () => {
  it("matches when the stored hash belongs to the account", async () => {
    const hash = await hashPassword("owner-password-123");
    expect(await verifyPasswordConstantTime(hash, "owner-password-123")).toBe(true);
    expect(await verifyPasswordConstantTime(hash, "wrong")).toBe(false);
  });

  it("still performs a full verification for unknown accounts (timing equalization)", async () => {
    // null = no account exists; the call must resolve normally (dummy
    // verification), never throw, and never report a match.
    expect(await verifyPasswordConstantTime(null, "anything-at-all")).toBe(false);
    expect(await verifyPasswordConstantTime(null, "")).toBe(false);
  });
});
