import "server-only";
import { notificationConfig, type NotificationEnv, type SenderIdentity } from "@/lib/notifications/config";
import {
  NotificationDeliveryError,
  type NotificationProvider,
  type NotificationSendResult,
} from "@/lib/notifications/contract";

/**
 * Resend transactional email adapter (Phase 7).
 *
 * A thin, dependency-free HTTP client instead of the vendor SDK: the request
 * surface used here is one JSON POST, and a `fetch` call is easier to audit,
 * inject in tests and replace with another transport later. The provider
 * abstraction is what makes that replacement cheap; no business code imports
 * this module directly.
 *
 * ## Idempotency
 *
 * Every request carries the outbox entry's stable `Idempotency-Key`. Resend
 * keeps these keys for a limited window, so the local outbox remains the
 * authoritative duplicate guard; the header only narrows the ambiguous-retry
 * window.
 *
 * ## Outcome mapping
 *
 *   2xx        -> accepted, provider message id recorded
 *   429        -> rate_limited, honour Retry-After
 *   5xx        -> ambiguous (the provider may have accepted the message)
 *   401/403    -> permanent (credentials rejected)
 *   400/404/422-> permanent (message/recipient/sender rejected)
 *   timeout/IO -> ambiguous (the request may have been delivered)
 *
 * Nothing from the response body is stored: a provider error body can echo the
 * recipient address, and the outbox must stay free of personal data.
 */

const RESEND_ENDPOINT = "https://api.resend.com/emails";
const REQUEST_TIMEOUT_MS = 10_000;

export interface ResendProviderOptions {
  apiKey: string;
  sender: SenderIdentity;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

/** Parse `Retry-After` (seconds or HTTP date) into a bounded millisecond delay. */
export function parseRetryAfter(value: string | null, now = Date.now()): number | null {
  if (!value) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.min(seconds * 1_000, 60 * 60 * 1_000);
  }
  const date = Date.parse(value);
  if (Number.isNaN(date)) return null;
  return Math.min(Math.max(date - now, 0), 60 * 60 * 1_000);
}

async function readMessageId(response: Response): Promise<string | null> {
  try {
    const body: unknown = await response.json();
    if (typeof body === "object" && body !== null && "id" in body) {
      const id = (body as { id?: unknown }).id;
      return typeof id === "string" && id.length > 0 && id.length <= 200 ? id : null;
    }
  } catch {
    // A 2xx without a JSON body is still an acceptance; the id stays unknown.
  }
  return null;
}

export function createResendProvider(options: ResendProviderOptions): NotificationProvider {
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? REQUEST_TIMEOUT_MS;

  return {
    id: "resend",
    configured: true,
    reason: null,
    async send(message): Promise<NotificationSendResult> {
      let response: Response;
      try {
        response = await fetchImpl(RESEND_ENDPOINT, {
          method: "POST",
          headers: {
            authorization: `Bearer ${options.apiKey}`,
            "content-type": "application/json",
            "idempotency-key": message.idempotencyKey,
          },
          body: JSON.stringify({
            from: options.sender.raw,
            to: [message.to],
            subject: message.subject,
            html: message.html,
            text: message.text,
          }),
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch {
        // Timeout, DNS failure or socket reset: the request may have reached
        // Resend. Treat it as ambiguous, never as a safe no-op.
        throw new NotificationDeliveryError(
          "The email provider did not confirm the request",
          { kind: "ambiguous" },
        );
      }

      if (response.ok) {
        return { providerMessageId: await readMessageId(response), status: "accepted" };
      }

      if (response.status === 429) {
        throw new NotificationDeliveryError("The email provider is rate limiting requests", {
          kind: "rate_limited",
          retryAfterMs: parseRetryAfter(response.headers.get("retry-after")),
        });
      }

      if (response.status >= 500) {
        throw new NotificationDeliveryError(
          "The email provider reported a temporary problem",
          { kind: "ambiguous" },
        );
      }

      if (response.status === 401 || response.status === 403) {
        throw new NotificationDeliveryError("The email provider rejected the credentials", {
          kind: "permanent",
        });
      }

      throw new NotificationDeliveryError("The email provider rejected the message", {
        kind: "permanent",
      });
    },
  };
}

/** Resolve the adapter from the current environment (server-side only). */
export function resendProviderFromEnv(env: NotificationEnv = process.env): NotificationProvider {
  const config = notificationConfig(env);
  if (!config.resendApiKey || !config.sender) {
    const reason = !config.resendApiKey
      ? "Resend API key is not configured"
      : "Sender address is not configured";
    return {
      id: "resend",
      configured: false,
      reason,
      send: async () => {
        throw new NotificationDeliveryError(reason, { kind: "permanent" });
      },
    };
  }
  return createResendProvider({ apiKey: config.resendApiKey, sender: config.sender });
}
