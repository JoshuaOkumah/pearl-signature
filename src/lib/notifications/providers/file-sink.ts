import "server-only";
import { createHash } from "node:crypto";
import { appendFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { notificationConfig, type NotificationEnv } from "@/lib/notifications/config";
import {
  NotificationDeliveryError,
  type NotificationProvider,
  type NotificationSendResult,
} from "@/lib/notifications/contract";

/**
 * File-sink notification provider (Phase 7, development and tests ONLY).
 *
 * Writes one JSON object per line to `NOTIFICATION_SINK_FILE` instead of
 * contacting a real provider. That is what lets Playwright complete the
 * cross-device tracking recovery flow: the verification code is generated
 * server-side and delivered to a file the test process can read, without a real
 * inbox and without contacting a customer.
 *
 * ## Safety
 *
 * - Refuses to run when `NODE_ENV === "production"` unless the harness sets
 *   `NOTIFICATION_SINK_ALLOW_PRODUCTION=1`. The Playwright orders server runs
 *   `next start` (production mode) against a disposable in-memory database, so
 *   that explicit flag is the only way this provider is reachable there.
 * - The sink file is git-ignored (`test-results/` / `.next/`).
 * - It stores the full rendered message because a test needs to read the code.
 *   That is acceptable for synthetic fixtures and unacceptable for real
 *   customer data; the production refusal above is the guard.
 */

export interface FileSinkProviderOptions {
  file: string;
  allowInProduction: boolean;
  now?: () => Date;
}

export function createFileSinkProvider(options: FileSinkProviderOptions): NotificationProvider {
  const now = options.now ?? (() => new Date());
  return {
    id: "file-sink",
    configured: true,
    reason: null,
    async send(message): Promise<NotificationSendResult> {
      if (process.env.NODE_ENV === "production" && !options.allowInProduction) {
        throw new NotificationDeliveryError(
          "The test notification sink is not permitted in production",
          { kind: "permanent" },
        );
      }

      const providerMessageId = `sink_${createHash("sha256")
        .update(`${message.idempotencyKey}|${message.to}|${now().toISOString()}`, "utf8")
        .digest("hex")
        .slice(0, 24)}`;

      try {
        await mkdir(path.dirname(options.file), { recursive: true });
        await appendFile(
          options.file,
          `${JSON.stringify({
            at: now().toISOString(),
            providerMessageId,
            idempotencyKey: message.idempotencyKey,
            to: message.to,
            subject: message.subject,
            text: message.text,
            html: message.html,
          })}\n`,
          "utf8",
        );
      } catch {
        throw new NotificationDeliveryError(
          "The test notification sink could not be written",
          { kind: "permanent" },
        );
      }

      return { providerMessageId, status: "accepted" };
    },
  };
}

/** Resolve the test sink from the current environment. */
export function fileSinkProviderFromEnv(env: NotificationEnv = process.env): NotificationProvider {
  const config = notificationConfig(env);
  const reason = !config.sinkFile
    ? "Test notification sink file is not configured"
    : env.NODE_ENV === "production" && !config.sinkAllowedInProduction
      ? "Test notification sink is not permitted in production"
      : null;

  if (reason || !config.sinkFile) {
    return {
      id: "file-sink",
      configured: false,
      reason: reason ?? "Test notification sink file is not configured",
      send: async () => {
        throw new NotificationDeliveryError(reason ?? "Test notification sink is not configured", {
          kind: "permanent",
        });
      },
    };
  }

  return createFileSinkProvider({
    file: config.sinkFile,
    allowInProduction: config.sinkAllowedInProduction,
  });
}
