/**
 * Notification provider contract (Phase 7).
 *
 * Deliberately free of `server-only` and of any vendor SDK so it can be
 * imported by unit tests, adapters and the dispatcher alike.
 *
 * ## Acceptance is not delivery
 *
 * A provider resolves with the provider's message id and an ACCEPTANCE state.
 * Resend accepting an HTTP request means "queued at Resend", not "in the
 * customer's inbox". Delivery callbacks are the only evidence that may move a
 * record to `delivered`.
 *
 * ## Failure kinds
 *
 * Every failure carries an explicit kind so the dispatcher can decide without
 * parsing a vendor message:
 *
 *  - `transient` - network hiccup, temporary server error, explicit retry.
 *  - `rate_limited` - 429; retry after the provider's guidance.
 *  - `permanent` - invalid recipient/sender/credentials; never retried
 *    indefinitely.
 *  - `ambiguous` - the request may have reached the provider (timeout, socket
 *    reset, 5xx). Retried a bounded number of times with the SAME idempotency
 *    key, then parked as `uncertain` for an operator.
 *
 * Error messages are written into the outbox's `lastReason`, so they must never
 * embed a recipient address or a provider payload.
 */

export interface NotificationMessagePayload {
  /** Recipient address, resolved at dispatch time - never stored in the queue. */
  to: string;
  subject: string;
  text: string;
  html: string;
  /**
   * Stable provider idempotency key derived from the notification identity.
   * Reusing it on a retry is what protects against duplicate delivery while
   * the provider still remembers the key.
   */
  idempotencyKey: string;
}

export type ProviderAcceptanceStatus = "accepted" | "delivered" | "unknown";

export interface NotificationSendResult {
  /** Provider message id, when the provider returned one. */
  providerMessageId: string | null;
  /** What the provider actually confirmed. */
  status: ProviderAcceptanceStatus;
}

export interface NotificationProvider {
  /** Registry name, for operator-facing reasons. */
  readonly id: string;
  /** False means "attempt nothing, keep entries pending". */
  readonly configured: boolean;
  /** Why sending is unavailable, when `configured` is false. */
  readonly reason: string | null;
  send(message: NotificationMessagePayload): Promise<NotificationSendResult>;
}

export type NotificationFailureKind = "transient" | "rate_limited" | "permanent" | "ambiguous";

export class NotificationDeliveryError extends Error {
  readonly kind: NotificationFailureKind;
  /** Provider-guided delay, when it supplied one (e.g. `Retry-After`). */
  readonly retryAfterMs: number | null;

  constructor(
    message: string,
    options?: { kind?: NotificationFailureKind; retryable?: boolean; retryAfterMs?: number | null },
  ) {
    super(message);
    this.name = "NotificationDeliveryError";
    // `retryable` is kept for callers written against the Phase 5 contract.
    this.kind = options?.kind ?? (options?.retryable === true ? "transient" : "permanent");
    this.retryAfterMs = options?.retryAfterMs ?? null;
  }

  /** Transient, rate-limited and ambiguous failures are retried. */
  get retryable(): boolean {
    return this.kind !== "permanent";
  }
}
