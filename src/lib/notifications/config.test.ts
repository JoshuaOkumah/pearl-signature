// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  DEFAULT_DAILY_EMAIL_LIMIT,
  DEFAULT_MONTHLY_EMAIL_LIMIT,
  emailReadiness,
  notificationConfig,
  parseEmailAddress,
} from "./config";

/**
 * Configuration and readiness tests (Phase 7).
 *
 * Readiness is deliberately strict: "configured" means a send can be
 * attempted. Nothing here is allowed to invent a sender, redirect to a
 * developer address, or call a test sink ready in production.
 */

describe("notificationConfig", () => {
  it("uses free-tier defaults and reads nothing that is not set", () => {
    const config = notificationConfig({});
    expect(config.provider).toBe("");
    expect(config.resendApiKey).toBeNull();
    expect(config.sender).toBeNull();
    expect(config.ownerRecipient).toBeNull();
    expect(config.monthlyLimit).toBe(DEFAULT_MONTHLY_EMAIL_LIMIT);
    expect(config.dailyLimit).toBe(DEFAULT_DAILY_EMAIL_LIMIT);
    expect(config.siteUrl).toBeNull();
  });

  it("normalises limits and the site origin", () => {
    const config = notificationConfig({
      NOTIFICATION_MONTHLY_LIMIT: "500",
      NOTIFICATION_DAILY_LIMIT: "25",
      NEXT_PUBLIC_SITE_URL: "https://pearl.example/",
    });
    expect(config.monthlyLimit).toBe(500);
    expect(config.dailyLimit).toBe(25);
    expect(config.siteUrl).toBe("https://pearl.example");
  });

  it("rejects malformed email addresses instead of guessing", () => {
    expect(parseEmailAddress("owner@pearl.example")).toBe("owner@pearl.example");
    expect(parseEmailAddress("not-an-email")).toBeNull();
    expect(parseEmailAddress("")).toBeNull();
  });
});

describe("emailReadiness", () => {
  it("reports not configured when the provider name is blank", () => {
    const readiness = emailReadiness({});
    expect(readiness.configured).toBe(false);
    expect(readiness.reason).toBe("not_configured");
    expect(readiness.trackingRecoveryAvailable).toBe(false);
  });

  it("reports a missing key or sender separately", () => {
    expect(emailReadiness({ NOTIFICATION_PROVIDER: "resend" }).reason).toBe("missing_api_key");
    expect(
      emailReadiness({ NOTIFICATION_PROVIDER: "resend", RESEND_API_KEY: "re_test" }).reason,
    ).toBe("invalid_sender");
  });

  it("is ready with a key, a valid sender and reports the owner recipient separately", () => {
    const readiness = emailReadiness({
      NOTIFICATION_PROVIDER: "resend",
      RESEND_API_KEY: "re_test",
      EMAIL_FROM: "PEARL Signature <orders@pearl.example>",
      OWNER_NOTIFICATION_EMAIL: "owner@pearl.example",
    });
    expect(readiness.configured).toBe(true);
    expect(readiness.reason).toBe("ready");
    expect(readiness.senderEmail).toBe("orders@pearl.example");
    expect(readiness.ownerRecipientConfigured).toBe(true);
    expect(readiness.trackingRecoveryAvailable).toBe(true);

    const noOwner = emailReadiness({
      NOTIFICATION_PROVIDER: "resend",
      RESEND_API_KEY: "re_test",
      EMAIL_FROM: "orders@pearl.example",
    });
    expect(noOwner.configured).toBe(true);
    expect(noOwner.ownerRecipientConfigured).toBe(false);
  });

  it("reports an unsupported provider honestly", () => {
    const readiness = emailReadiness({ NOTIFICATION_PROVIDER: "smtp-legacy" });
    expect(readiness.configured).toBe(false);
    expect(readiness.reason).toBe("unsupported_provider");
  });

  it("refuses the test sink in production unless the harness opts in", () => {
    const base = {
      NOTIFICATION_PROVIDER: "file-sink",
      NOTIFICATION_SINK_FILE: "test-results/notifications.jsonl",
    };
    expect(emailReadiness({ ...base, NODE_ENV: "production" }).reason).toBe("sink_forbidden");
    expect(
      emailReadiness({ ...base, NODE_ENV: "production", NOTIFICATION_SINK_ALLOW_PRODUCTION: "1" }).configured,
    ).toBe(true);
    expect(emailReadiness({ NOTIFICATION_PROVIDER: "file-sink" }).reason).toBe("missing_sink_file");
  });
});
