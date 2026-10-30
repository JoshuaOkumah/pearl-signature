import "server-only";

/**
 * Transactional email configuration (Phase 7).
 *
 * One reader for every notification setting, so the dispatcher, the readiness
 * panel, the processor route and the CLI can never disagree about what is
 * configured. Values are read at CALL time (never cached at module load) so a
 * test can change the environment and an operator can rotate a key without a
 * rebuild.
 *
 * ## Honesty
 *
 * Nothing here invents a sender or a recipient. A blank `EMAIL_FROM` is an
 * invalid sender, not a fallback to a developer address. A blank
 * `OWNER_NOTIFICATION_EMAIL` means the owner alert has no configured
 * recipient; the dispatcher may still resolve the active owner admin account,
 * but readiness reports the environment value separately so the operator knows
 * what is actually set.
 *
 * ## Secrets
 *
 * API keys, webhook secrets and the processor secret are read here and passed
 * only to server-side code. Nothing in this module is exported to a client
 * bundle (`server-only`), and no value is ever written to a log line.
 */

/** Environment shape accepted by every reader (testable, no global mutation). */
export type NotificationEnv = Record<string, string | undefined>;

export interface SenderIdentity {  /** Display name, when the configured value included one. */
  name: string | null;
  /** Bare address. */
  email: string;
  /** Canonical `Name <address>` / `address` form sent to the provider. */
  raw: string;
}

export interface NotificationConfig {
  /** Normalised `NOTIFICATION_PROVIDER`; blank means "not configured". */
  provider: string;
  resendApiKey: string | null;
  sender: SenderIdentity | null;
  ownerRecipient: string | null;
  webhookSecret: string | null;
  processorSecret: string | null;
  monthlyLimit: number;
  dailyLimit: number;
  sinkFile: string | null;
  sinkAllowedInProduction: boolean;
  /** Canonical site origin, used only to build safe links. */
  siteUrl: string | null;
}

export type EmailReadinessReason =
  | "not_configured"
  | "unsupported_provider"
  | "missing_api_key"
  | "invalid_sender"
  | "missing_sink_file"
  | "sink_forbidden"
  | "ready";

export interface EmailReadiness {
  /** True only when a provider could genuinely attempt a send. */
  configured: boolean;
  provider: string | null;
  reason: EmailReadinessReason;
  senderEmail: string | null;
  senderLabel: string | null;
  ownerRecipientConfigured: boolean;
  webhookConfigured: boolean;
  processorConfigured: boolean;
  /** Cross-device tracking recovery needs a working sender. */
  trackingRecoveryAvailable: boolean;
  monthlyLimit: number;
  dailyLimit: number;
}

/** Free-tier defaults (Resend: 3,000/month, 100/day). Configurable. */
export const DEFAULT_MONTHLY_EMAIL_LIMIT = 3_000;
export const DEFAULT_DAILY_EMAIL_LIMIT = 100;

const EMAIL_PATTERN = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/;

function trimmed(value: string | undefined | null): string | null {
  const next = value?.trim();
  return next ? next : null;
}

function positiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

/** Validate a bare email address; returns the normalised value or null. */
export function parseEmailAddress(raw: string | null | undefined): string | null {
  const value = trimmed(raw);
  if (!value || !EMAIL_PATTERN.test(value)) return null;
  return value;
}

/**
 * Parse `EMAIL_FROM` in either supported form:
 *
 *   `orders@example.com`
 *   `PEARL Signature <orders@example.com>`
 *
 * Quoted display names are accepted and unquoted. Anything else (including an
 * empty string) is rejected so the sender is never guessed.
 */
export function parseSender(raw: string | null | undefined): SenderIdentity | null {
  const value = trimmed(raw);
  if (!value) return null;

  const angled = /^(?:"?([^"<>]*)"?\s*)?<([^<>]+)>$/.exec(value);
  if (angled) {
    const email = angled[2].trim();
    if (!EMAIL_PATTERN.test(email)) return null;
    const name = angled[1]?.trim() || null;
    return { name, email, raw: name ? `${name} <${email}>` : email };
  }

  if (!EMAIL_PATTERN.test(value)) return null;
  return { name: null, email: value, raw: value };
}

function canonicalSiteUrl(raw: string | undefined): string | null {
  const value = trimmed(raw);
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    return `${url.origin}${url.pathname.replace(/\/+$/, "")}`;
  } catch {
    return null;
  }
}

export function notificationConfig(env: NotificationEnv = process.env): NotificationConfig {
  return {
    provider: (env.NOTIFICATION_PROVIDER ?? "").trim().toLowerCase(),
    resendApiKey: trimmed(env.RESEND_API_KEY),
    sender: parseSender(env.EMAIL_FROM),
    ownerRecipient: parseEmailAddress(env.OWNER_NOTIFICATION_EMAIL),
    webhookSecret: trimmed(env.RESEND_WEBHOOK_SECRET),
    processorSecret: trimmed(env.NOTIFICATION_PROCESSOR_SECRET),
    monthlyLimit: positiveInt(env.NOTIFICATION_MONTHLY_LIMIT, DEFAULT_MONTHLY_EMAIL_LIMIT),
    dailyLimit: positiveInt(env.NOTIFICATION_DAILY_LIMIT, DEFAULT_DAILY_EMAIL_LIMIT),
    sinkFile: trimmed(env.NOTIFICATION_SINK_FILE),
    sinkAllowedInProduction: env.NOTIFICATION_SINK_ALLOW_PRODUCTION === "1",
    siteUrl: canonicalSiteUrl(env.NEXT_PUBLIC_SITE_URL),
  };
}

/**
 * Operator-facing readiness. `configured` is deliberately strict: it means a
 * send can be ATTEMPTED, not that anything has been delivered.
 */
export function emailReadiness(env: NotificationEnv = process.env): EmailReadiness {
  const config = notificationConfig(env);
  const base = {
    provider: config.provider || null,
    senderEmail: config.sender?.email ?? null,
    senderLabel: config.sender?.name ?? null,
    ownerRecipientConfigured: config.ownerRecipient !== null,
    webhookConfigured: config.webhookSecret !== null,
    processorConfigured: config.processorSecret !== null,
    monthlyLimit: config.monthlyLimit,
    dailyLimit: config.dailyLimit,
  };

  if (!config.provider) {
    return {
      ...base,
      configured: false,
      reason: "not_configured",
      trackingRecoveryAvailable: false,
    };
  }

  if (config.provider === "resend") {
    const reason: EmailReadinessReason = !config.resendApiKey
      ? "missing_api_key"
      : !config.sender
        ? "invalid_sender"
        : "ready";
    return {
      ...base,
      configured: reason === "ready",
      reason,
      trackingRecoveryAvailable: reason === "ready",
    };
  }

  if (config.provider === "file-sink") {
    const reason: EmailReadinessReason = !config.sinkFile
      ? "missing_sink_file"
      : env.NODE_ENV === "production" && !config.sinkAllowedInProduction
        ? "sink_forbidden"
        : "ready";
    return {
      ...base,
      configured: reason === "ready",
      reason,
      trackingRecoveryAvailable: reason === "ready",
    };
  }

  return {
    ...base,
    configured: false,
    reason: "unsupported_provider",
    trackingRecoveryAvailable: false,
  };
}
