import { createHash } from "node:crypto";

/**
 * Phase 7 tracking fixtures shared by the E2E harness and the Playwright spec.
 *
 * The tracking suite runs against its OWN disposable server (port 3004) so it
 * never changes the order counts the Phase 5 suite asserts on. The harness
 * seeds one order with these exact facts; the spec seeds the browser's
 * sessionStorage with `TRACKING_CAPABILITY` instead of going through checkout.
 *
 * Everything here is synthetic: a fixture customer, a fixture pickup order and
 * a capability that exists only in this repository.
 */

export const TRACKING_REFERENCE = "PS-7E2E7A0001";
export const TRACKING_EMAIL = "tracking.e2e@example.test";
export const TRACKING_CUSTOMER_NAME = "Tracking Fixture";
export const TRACKING_PHONE = "+14165550199";

/** 64 hex characters, so it satisfies the Phase 5 capability schema. */
export const TRACKING_CAPABILITY = `e2e${"0".repeat(61)}`;

/** Exactly what the server stores: sha256 of the capability. */
export const TRACKING_CONFIRMATION_HASH = createHash("sha256")
  .update(TRACKING_CAPABILITY, "utf8")
  .digest("hex");

/** Bearer secret for the guarded processor route on the tracking server. */
export const TRACKING_PROCESSOR_SECRET = "e2e-processor-secret";

/** Repo-relative path the file-sink provider appends JSONL messages to. */
export const TRACKING_SINK_FILE = "test-results/e2e-notifications.jsonl";

export const TRACKING_CONFIRMATIONS_KEY = "pearl-confirmations-v1";
export const TRACKING_GRANTS_KEY = "pearl-tracking-grants-v1";
