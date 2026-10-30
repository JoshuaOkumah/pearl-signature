// @vitest-environment node
import { describe, expect, it } from "vitest";
import { isNotificationProcessorRequest, secretsEqual } from "./auth";

/**
 * Processor authentication tests (Phase 7).
 *
 * The endpoint is the only way to drain the outbox over HTTP, so "not
 * configured" must never mean "open", and a wrong or malformed credential must
 * be rejected before any database work happens.
 */

function processorRequest(headers: Record<string, string> = {}): Request {
  return new Request("http://localhost/api/notifications/process", { method: "POST", headers });
}

const ENV = { NOTIFICATION_PROCESSOR_SECRET: "correct-horse-battery-staple" };

describe("secretsEqual", () => {
  it("compares arbitrary lengths without throwing", () => {
    expect(secretsEqual("short", "a-much-longer-secret")).toBe(false);
    expect(secretsEqual("same", "same")).toBe(true);
    expect(secretsEqual("", "x")).toBe(false);
  });
});

describe("isNotificationProcessorRequest", () => {
  it("rejects every request when no secret is configured", () => {
    const request = processorRequest({ authorization: "Bearer anything" });
    expect(isNotificationProcessorRequest(request, {})).toBe(false);
    expect(isNotificationProcessorRequest(request, { NOTIFICATION_PROCESSOR_SECRET: "   " })).toBe(false);
  });

  it("accepts only the configured bearer secret", () => {
    expect(
      isNotificationProcessorRequest(
        processorRequest({ authorization: "Bearer correct-horse-battery-staple" }),
        ENV,
      ),
    ).toBe(true);
    expect(
      isNotificationProcessorRequest(processorRequest({ authorization: "bearer correct-horse-battery-staple" }), ENV),
    ).toBe(true);
    expect(
      isNotificationProcessorRequest(processorRequest({ authorization: "Bearer wrong" }), ENV),
    ).toBe(false);
    expect(
      isNotificationProcessorRequest(processorRequest({ authorization: "Basic correct-horse-battery-staple" }), ENV),
    ).toBe(false);
    expect(isNotificationProcessorRequest(processorRequest(), ENV)).toBe(false);
  });
});
