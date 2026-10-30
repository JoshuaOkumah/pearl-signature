/**
 * Email brand constants (Phase 7).
 *
 * Email clients cannot consume CSS custom properties reliably (and Outlook's
 * renderer ignores many modern features), so the storefront's design tokens are
 * repeated here as literal values. This is the ONE documented exception to the
 * "no raw hex in components" rule: these constants are not React components,
 * and every template imports them instead of inlining a colour.
 *
 * Colours mirror the Phase 1 design system:
 *   soft cream #FDFBF7, deep navy #1A2530, champagne gold #D4AF37.
 */

export const EMAIL_COLORS = {
  cream: "#FDFBF7",
  navy: "#1A2530",
  gold: "#D4AF37",
  goldSoft: "#F3E6C4",
  surface: "#FFFFFF",
  sand: "#EDE4D6",
  ink: "#33414D",
  inkMuted: "#5F6B76",
  leaf: "#2F6B4F",
  leafSoft: "#EAF3EE",
  terracotta: "#8E3A2E",
  terracottaSoft: "#FBEDEA",
} as const;

export const EMAIL_FONTS = {
  /** System stack: no web-font download, no blocked render in email clients. */
  body: "'Helvetica Neue', Helvetica, Arial, 'Segoe UI', sans-serif",
  display: "Georgia, 'Times New Roman', 'DejaVu Serif', serif",
} as const;

export const EMAIL_WIDTH_PX = 600;
