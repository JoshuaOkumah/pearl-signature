import "server-only";
import { buildGuestCodeEmail } from "./email/guest-code-email";
import { resolveNotificationProvider } from "./provider";
import type { GuestCodePurpose } from "@/lib/guest/constants";

/**
 * Inline send for a checkout, recovery or email-change code (Phase 7B).
 *
 * Like the Phase 7 tracking code, this is a deliberate exception to the outbox:
 * the customer is waiting on the page, and a queued retry could deliver a stale
 * code after a resend. The send is awaited and bounded by the provider adapter.
 *
 * Returns true ONLY when the provider accepted the request. Acceptance is not
 * inbox delivery, and the UI must never claim more than that.
 */

export interface GuestCodeEmailInput {
  to: string;
  code: string;
  purpose: Exclude<GuestCodePurpose, "tracking">;
  challengeId: string;
  expiresMinutes: number;
}

export async function sendGuestCodeEmail(input: GuestCodeEmailInput): Promise<boolean> {
  const provider = resolveNotificationProvider();
  if (!provider.configured) return false;

  const message = buildGuestCodeEmail({
    code: input.code,
    purpose: input.purpose,
    expiresMinutes: input.expiresMinutes,
  });

  try {
    await provider.send({
      to: input.to,
      subject: message.subject,
      html: message.html,
      text: message.text,
      // Unique per challenge: a resend must never be collapsed by a provider
      // idempotency window into the previous (now superseded) code.
      idempotencyKey: `guest-code:${input.purpose}:${input.challengeId}`,
    });
    return true;
  } catch {
    return false;
  }
}
