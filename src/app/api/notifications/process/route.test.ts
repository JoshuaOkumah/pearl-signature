// @vitest-environment node
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "./route";

/**
 * Guarded processor endpoint (Phase 7).
 *
 * The route is the only HTTP way to drain the outbox, so the matrix is about
 * access control: no secret means 503 (never open), a wrong secret means 401,
 * and a valid secret gets bounded counters without any recipient data.
 */

const { attemptMock } = vi.hoisted(() => ({
  attemptMock: vi.fn(async () => ({
    processed: 2,
    sent: 1,
    failed: 1,
    deferred: 0,
    uncertain: 0,
    recovered: 0,
    quotaBlocked: false,
  })),
}));

vi.mock("@/lib/notifications/dispatch", () => ({
  attemptDueNotifications: attemptMock,
}));

const SECRET = "processor-test-secret";

function request(headers: Record<string, string> = {}): Request {
  return new Request("http://localhost/api/notifications/process", { method: "POST", headers });
}

beforeAll(() => {
  process.env.NOTIFICATION_PROVIDER = "resend";
  process.env.RESEND_API_KEY = "re_test_only_not_a_real_key";
  process.env.EMAIL_FROM = "orders@example.test";
  process.env.NOTIFICATION_PROCESSOR_SECRET = SECRET;
});

beforeEach(() => {
  attemptMock.mockClear();
});

afterAll(() => {
  delete process.env.NOTIFICATION_PROVIDER;
  delete process.env.RESEND_API_KEY;
  delete process.env.EMAIL_FROM;
  delete process.env.NOTIFICATION_PROCESSOR_SECRET;
});

describe("POST /api/notifications/process", () => {
  it("answers 503 when no processor secret is configured", async () => {
    delete process.env.NOTIFICATION_PROCESSOR_SECRET;
    try {
      const response = await POST(request({ authorization: `Bearer ${SECRET}` }));
      expect(response.status).toBe(503);
      expect(attemptMock).not.toHaveBeenCalled();
    } finally {
      process.env.NOTIFICATION_PROCESSOR_SECRET = SECRET;
    }
  });

  it("answers 401 for a missing or wrong secret", async () => {
    expect((await POST(request())).status).toBe(401);
    expect((await POST(request({ authorization: "Bearer wrong" }))).status).toBe(401);
    expect((await POST(request({ authorization: `Basic ${SECRET}` }))).status).toBe(401);
    expect(attemptMock).not.toHaveBeenCalled();
  });

  it("runs one scan with the configured secret and returns bounded counters", async () => {
    const response = await POST(request({ authorization: `Bearer ${SECRET}` }));

    expect(response.status).toBe(200);
    expect(attemptMock).toHaveBeenCalledTimes(1);
    expect(response.headers.get("cache-control")).toContain("no-store");
    await expect(response.json()).resolves.toEqual({
      processed: 2,
      sent: 1,
      failed: 1,
      deferred: 0,
      uncertain: 0,
      recovered: 0,
      quotaBlocked: false,
    });
  });

  it("never leaks an internal error", async () => {
    attemptMock.mockRejectedValueOnce(new Error("mongodb://user:secret@host"));
    const response = await POST(request({ authorization: `Bearer ${SECRET}` }));

    expect(response.status).toBe(500);
    const body = await response.text();
    expect(body).not.toContain("secret");
    expect(body).not.toContain("mongodb");
  });
});
