/**
 * Email brand constants (Phase 7).
 *
 * Email clients cannot consume CSS custom properties reliably (and Outlook's
 * renderer ignores many modern features), so the storefront's design tokens are
 * repeated here as literal values. This is the ONE documented exception to the
 * "no raw hex in components" rule: these constants are not React components,
 * and every template imports them instead of inlining a colour.
 *
 * Colours mirror the CLIVS design system:
 *   warm ivory #FAFAF5, deep forest #243D30, warm gold #DFAF49.
 */

export const EMAIL_COLORS = {
  cream: "#FAFAF5",
  navy: "#243D30",
  gold: "#DFAF49",
  goldSoft: "#F7EDD6",
  surface: "#FFFFFF",
  sand: "#E2DFCF",
  ink: "#3A4F43",
  inkMuted: "#5A6B60",
  leaf: "#3F5C48",
  leafSoft: "#E8F0E7",
  terracotta: "#5C4033",
  terracottaSoft: "#F0E7DE",
} as const;

export const EMAIL_FONTS = {
  /** System stack: no web-font download, no blocked render in email clients. */
  body: "'Helvetica Neue', Helvetica, Arial, 'Segoe UI', sans-serif",
  display: "Georgia, 'Times New Roman', 'DejaVu Serif', serif",
} as const;

export const EMAIL_WIDTH_PX = 600;
