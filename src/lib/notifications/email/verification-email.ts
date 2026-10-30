import type { BuiltEmail } from "./order-email";
import { escapeHtml, renderEmailDocument } from "./layout";
import { EMAIL_COLORS, EMAIL_FONTS } from "./theme";
import { heading, muted, panel, paragraph } from "./components";

/**
 * Secure order-tracking verification code email (Phase 7).
 *
 * This is the one message sent INLINE rather than through the outbox. It is a
 * time-boxed security challenge, not a business event: the customer is waiting
 * on the page, the code must not be stored, and queue retries would only
 * deliver stale codes. Only the hash of the code is persisted; the code itself
 * exists in this rendered message and in the customer's inbox.
 *
 * The email never contains a capability token or a tracking link. Possession of
 * the code is still not enough without the matching challenge and reference.
 */

export interface TrackingCodeEmailInput {
  code: string;
  reference: string;
  expiresMinutes: number;
}

export function buildTrackingCodeEmail(input: TrackingCodeEmailInput): BuiltEmail {
  const subject = "Your PEARL Signature tracking code";
  const code = input.code.replace(/[^0-9A-Za-z]/g, "").slice(0, 12);

  const blocks = [
    heading("Your tracking code"),
    paragraph(
      `Use this code to open order ${input.reference} on another device. It expires in ${input.expiresMinutes} minutes and can be used once.`,
    ),
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:6px 0 18px;background:${EMAIL_COLORS.cream};border:1px solid ${EMAIL_COLORS.sand};border-radius:12px;">
      <tr><td align="center" style="padding:20px 12px;">
        <p style="margin:0;font-family:${EMAIL_FONTS.body};font-size:34px;line-height:1.2;font-weight:700;letter-spacing:8px;color:${EMAIL_COLORS.navy};">${escapeHtml(code)}</p>
      </td></tr>
    </table>`,
    panel(
      "neutral",
      "Requested by you?",
      "If you did not request this code, ignore this email. Nobody can open the order without the code.",
    ),
    muted("PEARL Signature will never ask you to send this code by email, chat or phone."),
  ];

  const html = renderEmailDocument({
    preheader: `Tracking code for order ${input.reference}`,
    title: subject,
    blocks,
    footerNote: `PEARL Signature - Canadian Nigerian kitchen. Order ${input.reference}.`,
  });

  const text = [
    `Your tracking code for order ${input.reference}:`,
    "",
    code,
    "",
    `This code expires in ${input.expiresMinutes} minutes and can be used once.`,
    "If you did not request this code, ignore this email.",
    "",
    "PEARL Signature will never ask you to send this code by email, chat or phone.",
  ].join("\n");

  return { subject, html, text };
}
