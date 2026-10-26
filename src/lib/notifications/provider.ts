import "server-only";

/**
 * Notification provider contract (Phase 5, Milestone E).
 *
 * Phase 5 ships NO third-party integration: no email API keys, no SMTP
 * credentials, no vendor SDKs. This module only defines the seam, so the
 * outbox pipeline can be complete and honestly testable today while a real
 * transport is registered in a later phase without touching order logic.
 *
 * Three states exist, and the dispatcher treats them differently:
 *
 *  1. **Configured provider** — registered in `REGISTRY` and selected via
 *     `NOTIFICATION_PROVIDER`. `send()` resolves on success.
 *  2. **Not configured** — `NOTIFICATION_PROVIDER` is blank (the Phase 5
 *     default). Entries stay `pending` with zero attempts; nothing fails
 *     and nothing is lost.
 *  3. **Unsupported name** — an unknown but non-blank `NOTIFICATION_PROVIDER`.
 *     Sending raises a non-retryable error so a typo surfaces as an honest
 *     `failed` entry with a readable reason instead of retrying forever.
 *
 * ## Privacy
 *
 * Errors thrown from this module are written into the outbox's
 * `lastReason`, so they must never embed a recipient address. Provider
 * failures that are not ours are replaced with a fixed sentence before
 * anything is stored (see `dispatch.ts`).
 */

export interface NotificationMessagePayload {
  /** Recipient address, resolved at dispatch time — never stored. */
  to: string;
  subject: string;
  text: string;
}

export interface NotificationProvider {
  /** Registry name, for operator-facing reasons. */
  readonly id: string;
  /** False means "attempt nothing, keep entries pending". */
  readonly configured: boolean;
  send(message: NotificationMessagePayload): Promise<void>;
}

/**
 * A delivery failure with an explicit retry policy.
 *
 * `retryable: false` marks permanent problems (unknown provider, rejected
 * address): retrying them would loop forever without ever succeeding.
 */
export class NotificationDeliveryError extends Error {
  readonly retryable: boolean;

  constructor(message: string, options?: { retryable?: boolean }) {
    super(message);
    this.name = "NotificationDeliveryError";
    this.retryable = options?.retryable ?? false;
  }
}

/** Fixed, PII-free reason shown while no provider is configured. */
export const NOT_CONFIGURED_REASON = "Notification provider not configured";

/**
 * Registered providers, keyed by the exact `NOTIFICATION_PROVIDER` value.
 *
 * Empty in Phase 5 on purpose: the project rules forbid inventing or
 * wiring a third-party service before the business picks one. A later
 * phase adds e.g. `registry["postmark"] = () => postmarkProvider()`.
 */
const REGISTRY: Record<string, () => NotificationProvider> = {};

const notConfiguredProvider: NotificationProvider = {
  id: "not-configured",
  configured: false,
  send: async () => {
    // Never called: the dispatcher checks `configured` first. Present so a
    // misuse still fails loudly instead of pretending to send.
    throw new NotificationDeliveryError(NOT_CONFIGURED_REASON);
  },
};

/**
 * Resolve `NOTIFICATION_PROVIDER` (or an explicit name) to a provider.
 *
 * Blank → not configured. Unknown → configured-but-unsupported, so the
 * failure is reported once per entry with a reason naming the typo.
 */
export function resolveNotificationProvider(
  name: string | undefined = process.env.NOTIFICATION_PROVIDER,
): NotificationProvider {
  const normalized = name?.trim();
  if (!normalized) return notConfiguredProvider;

  const factory = REGISTRY[normalized.toLowerCase()];
  if (factory) return factory();

  const id = normalized.slice(0, 40);
  return {
    id,
    configured: true,
    send: async () => {
      throw new NotificationDeliveryError(
        `Notification provider "${id}" is not supported in this build`,
      );
    },
  };
}
