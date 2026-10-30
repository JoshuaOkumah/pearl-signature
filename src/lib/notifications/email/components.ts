import { escapeHtml } from "./layout";
import { EMAIL_COLORS, EMAIL_FONTS } from "./theme";

/**
 * Reusable email blocks (Phase 7).
 *
 * Each helper escapes its dynamic input and returns a small HTML fragment. The
 * templates compose these instead of duplicating table markup, which keeps the
 * eleven messages visually consistent and makes an escaping mistake local to
 * one function rather than spread across every template.
 */

const bodyFont = EMAIL_FONTS.body;
const displayFont = EMAIL_FONTS.display;

export function heading(text: string): string {
  return `<h1 class="ps-title" style="margin:0 0 14px;font-family:${displayFont};font-size:26px;line-height:1.25;font-weight:600;color:${EMAIL_COLORS.navy};">${escapeHtml(text)}</h1>`;
}

export function paragraph(text: string): string {
  return `<p style="margin:0 0 14px;font-family:${bodyFont};font-size:15px;line-height:1.65;color:${EMAIL_COLORS.ink};">${escapeHtml(text)}</p>`;
}

export function muted(text: string): string {
  return `<p style="margin:0 0 14px;font-family:${bodyFont};font-size:13px;line-height:1.65;color:${EMAIL_COLORS.inkMuted};">${escapeHtml(text)}</p>`;
}

export function spacer(height = 16): string {
  return `<div style="height:${Math.max(0, Math.round(height))}px;line-height:${Math.max(0, Math.round(height))}px;font-size:0;">&nbsp;</div>`;
}

export function divider(): string {
  return `<div style="height:1px;background:${EMAIL_COLORS.sand};margin:18px 0;"></div>`;
}

export interface DetailRow {
  label: string;
  value: string;
  /** Emphasise the value (used for totals). */
  strong?: boolean;
}

/** A two-column label/value table that survives narrow screens. */
export function detailTable(rows: DetailRow[]): string {
  const body = rows
    .map(
      (row) => `<tr>
        <td style="padding:5px 12px 5px 0;font-family:${bodyFont};font-size:14px;line-height:1.5;color:${EMAIL_COLORS.inkMuted};vertical-align:top;">${escapeHtml(row.label)}</td>
        <td align="right" style="padding:5px 0;font-family:${bodyFont};font-size:14px;line-height:1.5;color:${EMAIL_COLORS.navy};font-weight:${row.strong ? 700 : 400};vertical-align:top;">${escapeHtml(row.value)}</td>
      </tr>`,
    )
    .join("");
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 6px;">${body}</table>`;
}

export interface EmailLineItem {
  name: string;
  variantName: string | null;
  quantity: number;
  unitPrice: string;
  lineTotal: string;
}

export function lineItems(items: EmailLineItem[]): string {
  if (items.length === 0) return "";
  const body = items
    .map(
      (item) => `<tr>
        <td style="padding:10px 12px 10px 0;border-bottom:1px solid ${EMAIL_COLORS.sand};vertical-align:top;">
          <p style="margin:0;font-family:${bodyFont};font-size:14px;font-weight:700;line-height:1.45;color:${EMAIL_COLORS.navy};">${escapeHtml(item.name)}</p>
          ${item.variantName ? `<p style="margin:2px 0 0;font-family:${bodyFont};font-size:12px;line-height:1.45;color:${EMAIL_COLORS.inkMuted};">${escapeHtml(item.variantName)}</p>` : ""}
          <p style="margin:2px 0 0;font-family:${bodyFont};font-size:12px;line-height:1.45;color:${EMAIL_COLORS.inkMuted};">${item.quantity} x ${escapeHtml(item.unitPrice)}</p>
        </td>
        <td align="right" style="padding:10px 0;border-bottom:1px solid ${EMAIL_COLORS.sand};font-family:${bodyFont};font-size:14px;line-height:1.45;color:${EMAIL_COLORS.navy};vertical-align:top;white-space:nowrap;">${escapeHtml(item.lineTotal)}</td>
      </tr>`,
    )
    .join("");
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 10px;">${body}</table>`;
}

export type PanelTone = "neutral" | "success" | "warning";

const PANEL_STYLES: Record<PanelTone, { background: string; border: string; title: string }> = {
  neutral: { background: EMAIL_COLORS.cream, border: EMAIL_COLORS.sand, title: EMAIL_COLORS.navy },
  success: { background: EMAIL_COLORS.leafSoft, border: EMAIL_COLORS.leaf, title: EMAIL_COLORS.leaf },
  warning: { background: EMAIL_COLORS.terracottaSoft, border: EMAIL_COLORS.terracotta, title: EMAIL_COLORS.terracotta },
};

export function panel(tone: PanelTone, title: string, body: string): string {
  const style = PANEL_STYLES[tone];
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 16px;background:${style.background};border:1px solid ${style.border};border-radius:12px;">
    <tr><td style="padding:14px 16px;">
      <p style="margin:0 0 4px;font-family:${bodyFont};font-size:12px;letter-spacing:0.6px;text-transform:uppercase;color:${style.title};font-weight:700;">${escapeHtml(title)}</p>
      <p style="margin:0;font-family:${bodyFont};font-size:14px;line-height:1.6;color:${EMAIL_COLORS.ink};">${escapeHtml(body)}</p>
    </td></tr>
  </table>`;
}

export function callout(text: string): string {
  return `<p style="margin:0 0 16px;padding:12px 14px;background:${EMAIL_COLORS.cream};border-left:3px solid ${EMAIL_COLORS.gold};font-family:${bodyFont};font-size:13px;line-height:1.6;color:${EMAIL_COLORS.ink};">${escapeHtml(text)}</p>`;
}

/** Primary action. `href` is built by our code from the configured site URL. */
export function button(href: string, label: string): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:6px 0 18px;">
    <tr><td style="background:${EMAIL_COLORS.navy};border-radius:10px;">
      <a href="${escapeHtml(href)}" style="display:inline-block;padding:13px 22px;font-family:${bodyFont};font-size:14px;font-weight:700;line-height:1;color:${EMAIL_COLORS.cream};text-decoration:none;">${escapeHtml(label)}</a>
    </td></tr>
  </table>`;
}

export function bulletList(items: string[]): string {
  if (items.length === 0) return "";
  const body = items
    .map(
      (item) => `<li style="margin:0 0 6px;font-family:${bodyFont};font-size:14px;line-height:1.6;color:${EMAIL_COLORS.ink};">${escapeHtml(item)}</li>`,
    )
    .join("");
  return `<ul style="margin:0 0 16px;padding-left:20px;">${body}</ul>`;
}

/** The prominent total line at the end of a money block. */
export function totalRow(label: string, value: string): string {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:10px 0 0;border-top:1px solid ${EMAIL_COLORS.sand};">
    <tr>
      <td style="padding:10px 12px 0 0;font-family:${bodyFont};font-size:15px;font-weight:700;color:${EMAIL_COLORS.navy};">${escapeHtml(label)}</td>
      <td align="right" class="ps-total" style="padding:10px 0 0;font-family:${bodyFont};font-size:18px;font-weight:700;color:${EMAIL_COLORS.navy};white-space:nowrap;">${escapeHtml(value)}</td>
    </tr>
  </table>`;
}
