import { EMAIL_COLORS, EMAIL_FONTS, EMAIL_WIDTH_PX } from "./theme";

/**
 * Shared email document shell (Phase 7).
 *
 * Every template is assembled from the same table-based skeleton because that
 * is what renders consistently in Gmail, Apple Mail and Outlook. The layout is
 * responsive through a single media query plus fluid widths: on a narrow screen
 * the outer padding shrinks and the content column stays at 100%.
 *
 * Rules enforced here:
 *
 *  - Dynamic values are escaped by `escapeHtml` before interpolation. Callers
 *    pass plain text, never markup, except through the explicit block helpers.
 *  - No remote images, fonts, scripts or tracking pixels. Nothing phones home
 *    when a customer opens the message.
 *  - A plain-text alternative is always produced alongside the HTML.
 */

/** Escape the five characters that can break out of text or an attribute. */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export interface EmailDocumentInput {
  /** Inbox preview line, hidden in the body. */
  preheader: string;
  /** Document title (also the accessible heading context). */
  title: string;
  /** Rendered body blocks (already escaped by the component helpers). */
  blocks: string[];
  /** Footer sentence, plain text; escaped here. */
  footerNote: string;
}

/**
 * Wrap body blocks in the PEARL Signature shell.
 *
 * The wordmark is text, not an image: an image would need a hosted asset and
 * meaningful alt text, and a text mark survives image blocking.
 */
export function renderEmailDocument(input: EmailDocumentInput): string {
  const preheader = escapeHtml(input.preheader);
  const title = escapeHtml(input.title);
  const footer = escapeHtml(input.footerNote);

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="x-apple-disable-message-reformatting">
<title>${title}</title>
<style>
  @media only screen and (max-width: 620px) {
    .ps-outer { padding: 12px 8px !important; }
    .ps-body { padding: 22px 18px !important; }
    .ps-header { padding: 20px 18px !important; }
    .ps-title { font-size: 22px !important; line-height: 1.25 !important; }
    .ps-total { font-size: 20px !important; }
  }
</style>
</head>
<body style="margin:0;padding:0;background:${EMAIL_COLORS.cream};">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:${EMAIL_COLORS.cream};font-size:1px;line-height:1px;">${preheader}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${EMAIL_COLORS.cream};">
  <tr>
    <td align="center" class="ps-outer" style="padding:28px 12px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:${EMAIL_WIDTH_PX}px;margin:0 auto;background:${EMAIL_COLORS.surface};border:1px solid ${EMAIL_COLORS.sand};border-radius:18px;overflow:hidden;">
        <tr>
          <td class="ps-header" style="background:${EMAIL_COLORS.navy};padding:26px 28px;">
            <p style="margin:0;font-family:${EMAIL_FONTS.display};font-size:19px;letter-spacing:2px;text-transform:uppercase;color:${EMAIL_COLORS.cream};">PEARL Signature</p>
            <div style="height:2px;width:56px;background:${EMAIL_COLORS.gold};margin-top:10px;"></div>
            <p style="margin:10px 0 0;font-family:${EMAIL_FONTS.body};font-size:12px;letter-spacing:1px;text-transform:uppercase;color:${EMAIL_COLORS.goldSoft};">Canadian Nigerian kitchen</p>
          </td>
        </tr>
        <tr>
          <td class="ps-body" style="padding:30px 28px;">
            ${input.blocks.join("\n")}
          </td>
        </tr>
        <tr>
          <td style="background:${EMAIL_COLORS.cream};border-top:1px solid ${EMAIL_COLORS.sand};padding:18px 28px;">
            <p style="margin:0;font-family:${EMAIL_FONTS.body};font-size:12px;line-height:1.6;color:${EMAIL_COLORS.inkMuted};">${footer}</p>
            <p style="margin:8px 0 0;font-family:${EMAIL_FONTS.body};font-size:12px;line-height:1.6;color:${EMAIL_COLORS.inkMuted};">This message was sent about a PEARL Signature order. Replies to this address are not monitored unless the store has published a contact channel.</p>
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>
</body>
</html>`;
}
