import type { GuestCodePurpose } from "@/lib/guest/constants";
import type { BuiltEmail } from "./order-email";
import { escapeHtml, renderEmailDocument } from "./layout";
import { EMAIL_COLORS, EMAIL_FONTS } from "./theme";
import { heading, muted, panel, paragraph } from "./components";

/**
 * Branded verification code email (Phase 7B).
 *
 * The message contains the six-digit code, its ten-minute lifetime and the
 * reason it was sent. It deliberately contains:
 *
 *  - no order details beyond the reason ("continue your order"),
 *  - no links at all, so no capability or session token can leak through a
 *    referrer, a shared inbox or a mail scanner,
 *  - no promotional copy.
 *
 * The code is the only secret in the message, and it is useless without the
 * matching server-side challenge.
 */

const COPY: Record<
  Exclude<GuestCodePurpose, "tracking">,
  { subject: string; heading: string; reason: string; footer: string }
> = {
  checkout: {
    subject: "Your PEARL Signature verification code",
    heading: "Verify your email",
    reason:
      "Use this code to verify your email address and continue your PEARL Signature order. The code expires in ten minutes and can be used once.",
    footer: "PEARL Signature - Canadian Nigerian kitchen. You requested this code at checkout.",
  },
  recovery: {
    subject: "Your PEARL Signature sign-in code",
    heading: "Open your orders",
    reason:
      "Use this code to open your PEARL Signature order history on this device. The code expires in ten minutes and can be used once.",
    footer: "PEARL Signature - Canadian Nigerian kitchen. You requested this code to find your orders.",
  },
  order_email_change: {
    subject: "Confirm your new email address",
    heading: "Confirm your new email",
    reason:
      "Use this code to confirm this email address for a PEARL Signature order. The code expires in ten minutes and can be used once.",
    footer: "PEARL Signature - Canadian Nigerian kitchen. You requested this change on an existing order.",
  },
};

export interface GuestCodeEmailInput {
  code: string;
  purpose: Exclude<GuestCodePurpose, "tracking">;
  expiresMinutes: number;
}

export function buildGuestCodeEmail(input: GuestCodeEmailInput): BuiltEmail {
  const copy = COPY[input.purpose];
  const code = input.code.replace(/[^0-9A-Za-z]/g, "").slice(0, 12);

  const blocks = [
    heading(copy.heading),
    paragraph(copy.reason),
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:6px 0 18px;background:${EMAIL_COLORS.cream};border:1px solid ${EMAIL_COLORS.sand};border-radius:12px;">
      <tr><td align="center" style="padding:20px 12px;">
        <p style="margin:0;font-family:${EMAIL_FONTS.body};font-size:34px;line-height:1.2;font-weight:700;letter-spacing:8px;color:${EMAIL_COLORS.navy};">${escapeHtml(code)}</p>
      </td></tr>
    </table>`,
    panel(
      "neutral",
      "Did you request this?",
      "If you did not request this code, ignore this email. Nobody can verify the address without the code.",
    ),
    muted(`This code expires in ${input.expiresMinutes} minutes.`),
    muted("PEARL Signature will never ask you to send this code by email, chat or phone."),
  ];

  const html = renderEmailDocument({
    preheader: copy.heading,
    title: copy.subject,
    blocks,
    footerNote: copy.footer,
  });

  const text = [
    copy.heading,
    "",
    code,
    "",
    copy.reason,
    "",
    `This code expires in ${input.expiresMinutes} minutes.`,
    "If you did not request this code, ignore this email.",
    "",
    "PEARL Signature will never ask you to send this code by email, chat or phone.",
  ].join("\n");

  return { subject: copy.subject, html, text };
}
