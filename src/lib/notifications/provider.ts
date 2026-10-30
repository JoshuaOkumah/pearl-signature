import "server-only";
import { notificationConfig, type NotificationEnv } from "./config";
import {
  NotificationDeliveryError,
  type NotificationProvider,
} from "./contract";
import { fileSinkProviderFromEnv } from "./providers/file-sink";
import { resendProviderFromEnv } from "./providers/resend";

/**
 * Notification provider registry (Phase 5 seam, Phase 7 implementation).
 *
 * Business code never imports a transport directly: it asks this module for the
 * provider named by `NOTIFICATION_PROVIDER`. Adding another transactional email
 * service later means adding one registry entry, not touching order, payment or
 * admin code.
 *
 * Three states, treated differently by the dispatcher:
 *
 *  1. **Configured** - the adapter can genuinely attempt a send.
 *  2. **Named but incomplete** - the adapter exists but its settings are
 *     missing. `configured` is false with an operator-readable `reason`, so
 *     entries stay pending without consuming retries.
 *  3. **Unsupported name** - a typo surfaces once per entry as a permanent
 *     failure naming the provider, instead of retrying forever.
 */

export {
  NotificationDeliveryError,
  type NotificationFailureKind,
  type NotificationMessagePayload,
  type NotificationProvider,
  type NotificationSendResult,
  type ProviderAcceptanceStatus,
} from "./contract";

/** Fixed, PII-free reason shown while no provider is configured. */
export const NOT_CONFIGURED_REASON = "Notification provider not configured";

const REGISTRY: Record<string, () => NotificationProvider> = {
  resend: () => resendProviderFromEnv(),
  "file-sink": () => fileSinkProviderFromEnv(),
};

const notConfiguredProvider: NotificationProvider = {
  id: "not-configured",
  configured: false,
  reason: NOT_CONFIGURED_REASON,
  send: async () => {
    // Never called: the dispatcher checks `configured` first. Present so a
    // misuse still fails loudly instead of pretending to send.
    throw new NotificationDeliveryError(NOT_CONFIGURED_REASON, { kind: "permanent" });
  },
};

/**
 * Resolve a provider by name (defaults to the live environment). The name is
 * read at call time so configuration changes are picked up without a restart.
 */
export function resolveNotificationProvider(
  name: string | undefined = process.env.NOTIFICATION_PROVIDER,
): NotificationProvider {
  const normalized = name?.trim().toLowerCase();
  if (!normalized) return notConfiguredProvider;

  const factory = REGISTRY[normalized];
  if (factory) return factory();

  const id = normalized.slice(0, 40);
  return {
    id,
    configured: true,
    reason: null,
    send: async () => {
      throw new NotificationDeliveryError(
        `Notification provider "${id}" is not supported in this build`,
        { kind: "permanent" },
      );
    },
  };
}

/** Provider identity for the admin panel, without touching any secret. */
export function notificationProviderName(env: NotificationEnv = process.env): string | null {
  const name = notificationConfig(env).provider;
  return name || null;
}
