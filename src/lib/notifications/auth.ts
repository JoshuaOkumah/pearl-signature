import "server-only";
import { createHash, timingSafeEqual } from "node:crypto";
import { notificationConfig, type NotificationEnv } from "./config";

/**
 * Processor authentication (Phase 7).
 *
 * The background processor is reachable over HTTP so an external scheduler can
 * drive it. That endpoint must never be publicly triggerable, so it requires a
 * bearer secret supplied by `NOTIFICATION_PROCESSOR_SECRET`.
 *
 * The comparison is constant-time. Both sides are hashed first so the compare
 * is independent of the secret's length (a raw `timingSafeEqual` throws on
 * different-length buffers, which would leak the configured length).
 *
 * A missing secret means "not configured", never "open": the route answers 503
 * instead of accepting an empty credential.
 */

/** Constant-time equality for two arbitrary secrets. */
export function secretsEqual(candidate: string, expected: string): boolean {
  const a = createHash("sha256").update(candidate, "utf8").digest();
  const b = createHash("sha256").update(expected, "utf8").digest();
  return timingSafeEqual(a, b);
}

/** True only when the request carries the configured bearer secret. */
export function isNotificationProcessorRequest(
  request: Request,
  env: NotificationEnv = process.env,
): boolean {
  const secret = notificationConfig(env).processorSecret;
  if (!secret) return false;
  const header = request.headers.get("authorization")?.trim();
  if (!header) return false;
  const match = /^Bearer\s+(.+)$/i.exec(header);
  if (!match) return false;
  return secretsEqual(match[1].trim(), secret);
}
