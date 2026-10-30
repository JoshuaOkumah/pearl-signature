// @vitest-environment node
import mongoose from "mongoose";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { MongoMemoryServer } from "mongodb-memory-server";
import { connectDatabase } from "@/lib/db/mongoose";
import { NotificationOutboxModel } from "@/models/notification-outbox";
import { loadNotificationOverview, sanitizeNotificationReason } from "./observability";

/**
 * Admin notification observability (Phase 7).
 *
 * The page must never leak an address, a token or a provider payload, and it
 * must never present an accepted message as delivered. The sanitizer is tested
 * directly, then the overview is tested against a real collection so the
 * status filters and counters are the ones the page actually reads.
 */

let mongod: MongoMemoryServer | null = null;

function entry(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    key: `order.placed:PS-0000000000:customer:${Math.random()}`,
    event: "order.placed",
    reference: "PS-0000000000",
    recipientRole: "customer",
    status: "pending",
    attempts: 0,
    ambiguousAttempts: 0,
    lastReason: null,
    nextAttemptAt: new Date(),
    lastAttemptAt: null,
    sentAt: null,
    providerStatus: null,
    ...overrides,
  };
}

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  process.env.MONGODB_URI = mongod.getUri("pearl_observability_test");
  delete process.env.NOTIFICATION_PROVIDER;
  await connectDatabase();
  await NotificationOutboxModel.createIndexes();
});

beforeEach(async () => {
  await NotificationOutboxModel.deleteMany({});
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongod?.stop();
  mongod = null;
});

describe("sanitizeNotificationReason", () => {
  it("removes email addresses", () => {
    const cleaned = sanitizeNotificationReason("Provider rejected ada.obi@example.com as a recipient");
    expect(cleaned).toBe("Provider rejected [address] as a recipient");
    expect(cleaned).not.toContain("ada.obi@example.com");
  });

  it("removes long opaque tokens", () => {
    const cleaned = sanitizeNotificationReason(`Rejected key ${"a".repeat(64)}`);
    expect(cleaned).toBe("Rejected key [token]");
  });

  it("collapses whitespace and bounds length", () => {
    const cleaned = sanitizeNotificationReason(`  too   many\n\nspaces ${"x".repeat(400)}`);
    expect(cleaned?.startsWith("too many spaces")).toBe(true);
    expect((cleaned ?? "").length).toBeLessThanOrEqual(300);
  });

  it("returns null for empty or missing values", () => {
    expect(sanitizeNotificationReason(null)).toBeNull();
    expect(sanitizeNotificationReason(undefined)).toBeNull();
    expect(sanitizeNotificationReason("   ")).toBeNull();
  });
});

describe("loadNotificationOverview", () => {
  it("counts every queue state and lists only failed or uncertain entries", async () => {
    await NotificationOutboxModel.create([
      entry({ status: "pending" }),
      entry({ status: "processing" }),
      entry({ status: "sent", sentAt: new Date(), providerStatus: "accepted" }),
      entry({
        status: "failed",
        attempts: 5,
        lastReason: "Provider rejected ada.obi@example.com",
        lastAttemptAt: new Date("2026-10-01T10:00:00.000Z"),
      }),
      entry({
        status: "uncertain",
        attempts: 2,
        ambiguousAttempts: 2,
        lastReason: `Ambiguous outcome ${"b".repeat(64)}`,
        lastAttemptAt: new Date("2026-10-02T10:00:00.000Z"),
      }),
    ]);

    const overview = await loadNotificationOverview();

    expect(overview.databaseError).toBe(false);
    expect(overview.counts).toEqual({ pending: 1, processing: 1, sent: 1, failed: 1, uncertain: 1 });
    expect(overview.problems).toHaveLength(2);
    expect(overview.problems.map((problem) => problem.status).sort()).toEqual(["failed", "uncertain"]);
    expect(overview.problems.every((problem) => !problem.reason?.includes("@"))).toBe(true);
    expect(overview.problems.every((problem) => !problem.reason?.includes("b".repeat(64)))).toBe(true);
    expect(overview.recentAccepted).toHaveLength(1);
    expect(overview.recentAccepted[0].providerStatus).toBe("accepted");
    expect(overview.lastAttemptAtIso).toBe("2026-10-02T10:00:00.000Z");
    expect(overview.lastAcceptedAtIso).not.toBeNull();
  });

  it("never reports readiness values that look like secrets", async () => {
    process.env.NOTIFICATION_PROVIDER = "resend";
    process.env.RESEND_API_KEY = "re_super_secret_value";
    process.env.EMAIL_FROM = "PEARL Signature <orders@example.test>";
    try {
      const overview = await loadNotificationOverview();
      const serialised = JSON.stringify(overview);
      expect(serialised).not.toContain("re_super_secret_value");
      expect(overview.readiness.provider).toBe("resend");
      expect(overview.readiness.senderEmail).toBe("orders@example.test");
    } finally {
      delete process.env.NOTIFICATION_PROVIDER;
      delete process.env.RESEND_API_KEY;
      delete process.env.EMAIL_FROM;
    }
  });

  it("reports an empty queue honestly", async () => {
    const overview = await loadNotificationOverview();
    expect(overview.counts).toEqual({ pending: 0, processing: 0, sent: 0, failed: 0, uncertain: 0 });
    expect(overview.problems).toEqual([]);
    expect(overview.recentAccepted).toEqual([]);
    expect(overview.lastAttemptAtIso).toBeNull();
    expect(overview.lastAcceptedAtIso).toBeNull();
  });
});
