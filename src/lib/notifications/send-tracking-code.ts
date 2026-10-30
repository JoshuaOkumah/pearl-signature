import "server-only";
import { buildTrackingCodeEmail } from "./email/verification-email";
import { resolveNotificationProvider } from "./provider";

/**
 * Inline send for the tracking verification code (Phase 7).
 *
 * This is the ONE documented exception to "notifications go through the
 * outbox". A code is a time-boxed security challenge the customer is waiting
 * for; queueing it would add latency and could deliver a stale code after a
 * retry. The code itself is never stored, only its hash (see the challenge
 * model).
 *
 * The send is best-effort from the caller's perspective: a provider failure is
 * reported as `false` and the caller keeps the same generic response, so the
 * endpoint never reveals whether an order matched.
 */

export interface TrackingCodeEmailInput {
  to: string;
  code: string;
  reference: string;
  challengeId: string;
  expiresMinutes: number;
}

/** Returns true only when the provider accepted the message. */
export async function sendTrackingCodeEmail(input: TrackingCodeEmailInput): Promise<boolean> {
  const provider = resolveNotificationProvider();
  if (!provider.configured) return false;

  const message = buildTrackingCodeEmail({
    code: input.code,
    reference: input.reference,
    expiresMinutes: input.expiresMinutes,
  });

  try {
    await provider.send({
      to: input.to,
      subject: message.subject,
      html: message.html,
      text: message.text,
      // Unique per challenge: a new request must never be collapsed by a
      // provider idempotency window into the previous (already used) code.
      idempotencyKey: `tracking-code:${input.challengeId}`,
    });
    return true;
  } catch {
    return false;
  }
}
