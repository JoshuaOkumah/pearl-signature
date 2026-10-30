import "server-only";
import { connectDatabase, logDatabaseError } from "@/lib/db/mongoose";
import { NotificationOutboxModel } from "@/models/notification-outbox";
import { emailReadiness, type EmailReadiness } from "./config";
import { notificationVolume, type NotificationVolume } from "./dispatch";

/**
 * Notification observability for the admin (Phase 7).
 *
 * Two rules shape this module:
 *
 *  1. **No secrets.** Readiness reports what is configured, never the values.
 *     API keys, webhook secrets and the processor secret are never selected or
 *     returned.
 *  2. **No personal data.** The outbox stores no address or body, so the
 *     overview cannot leak one. Reasons are additionally sanitised before they
 *     are rendered, because a provider message could still echo something.
 *
 * A database read failure degrades to an explicit `databaseError` flag instead
 * of pretending there are zero problems.
 */

export interface NotificationProblem {
  id: string;
  event: string;
  reference: string;
  recipientRole: string;
  status: "failed" | "uncertain";
  attempts: number;
  ambiguousAttempts: number;
  reason: string | null;
  lastAttemptAtIso: string | null;
  updatedAtIso: string | null;
}

export interface NotificationAccepted {
  event: string;
  reference: string;
  recipientRole: string;
  providerStatus: string | null;
  sentAtIso: string | null;
}

export interface NotificationCounts {
  pending: number;
  processing: number;
  sent: number;
  failed: number;
  uncertain: number;
}

export interface NotificationOverview {
  readiness: EmailReadiness;
  counts: NotificationCounts;
  problems: NotificationProblem[];
  recentAccepted: NotificationAccepted[];
  lastAttemptAtIso: string | null;
  lastAcceptedAtIso: string | null;
  volume: NotificationVolume | null;
  /** True when the database could not be read; counts are then not evidence. */
  databaseError: boolean;
}

const EMPTY_COUNTS: NotificationCounts = {
  pending: 0,
  processing: 0,
  sent: 0,
  failed: 0,
  uncertain: 0,
};

/**
 * Strip anything that looks like an email address or a long opaque token from
 * a stored reason. Reasons written by the dispatcher are already fixed
 * sentences; this is defence in depth for anything else that reached the field.
 */
export function sanitizeNotificationReason(value: string | null | undefined): string | null {
  if (!value) return null;
  const cleaned = value
    .replace(/[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+/g, "[address]")
    .replace(/\b[0-9a-f]{32,}\b/gi, "[token]")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned ? cleaned.slice(0, 300) : null;
}

function iso(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export async function loadNotificationOverview(problemLimit = 20): Promise<NotificationOverview> {
  const readiness = emailReadiness();
  try {
    await connectDatabase();

    const [grouped, problems, recentAccepted, lastAttempt, lastAccepted, volume] = await Promise.all([
      NotificationOutboxModel.aggregate<{ _id: string; count: number }>([
        { $group: { _id: "$status", count: { $sum: 1 } } },
      ]),
      NotificationOutboxModel.find({ status: { $in: ["failed", "uncertain"] } })
        .sort({ updatedAt: -1 })
        .limit(Math.max(1, problemLimit))
        .select({
          event: 1,
          reference: 1,
          recipientRole: 1,
          status: 1,
          attempts: 1,
          ambiguousAttempts: 1,
          lastReason: 1,
          lastAttemptAt: 1,
          updatedAt: 1,
        })
        .lean(),
      NotificationOutboxModel.find({ status: "sent" })
        .sort({ sentAt: -1 })
        .limit(5)
        .select({ event: 1, reference: 1, recipientRole: 1, providerStatus: 1, sentAt: 1 })
        .lean(),
      NotificationOutboxModel.findOne({ lastAttemptAt: { $ne: null } })
        .sort({ lastAttemptAt: -1 })
        .select({ lastAttemptAt: 1 })
        .lean(),
      NotificationOutboxModel.findOne({ status: "sent", sentAt: { $ne: null } })
        .sort({ sentAt: -1 })
        .select({ sentAt: 1 })
        .lean(),
      notificationVolume(),
    ]);

    const counts = { ...EMPTY_COUNTS };
    for (const row of grouped) {
      if (row._id in counts) counts[row._id as keyof NotificationCounts] = row.count;
    }

    return {
      readiness,
      counts,
      problems: problems.map((entry) => ({
        id: String(entry._id),
        event: entry.event,
        reference: entry.reference,
        recipientRole: entry.recipientRole,
        status: entry.status === "uncertain" ? "uncertain" : "failed",
        attempts: entry.attempts,
        ambiguousAttempts: entry.ambiguousAttempts ?? 0,
        reason: sanitizeNotificationReason(entry.lastReason),
        lastAttemptAtIso: iso(entry.lastAttemptAt),
        updatedAtIso: iso(entry.updatedAt),
      })),
      recentAccepted: recentAccepted.map((entry) => ({
        event: entry.event,
        reference: entry.reference,
        recipientRole: entry.recipientRole,
        providerStatus: entry.providerStatus ?? null,
        sentAtIso: iso(entry.sentAt),
      })),
      lastAttemptAtIso: iso(lastAttempt?.lastAttemptAt),
      lastAcceptedAtIso: iso(lastAccepted?.sentAt),
      volume,
      databaseError: false,
    };
  } catch (error) {
    logDatabaseError("notification-observability", error);
    return {
      readiness,
      counts: { ...EMPTY_COUNTS },
      problems: [],
      recentAccepted: [],
      lastAttemptAtIso: null,
      lastAcceptedAtIso: null,
      volume: null,
      databaseError: true,
    };
  }
}
