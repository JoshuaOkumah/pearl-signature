import type { QuoteLineIssue } from "@/lib/validations/cart";

/**
 * Customer-facing wording for reconciliation issues (Phase 4).
 *
 * Kept separate from the server response so the API stays language-neutral
 * and so every surface (drawer, cart page, checkout) says exactly the same
 * thing. Wording is deliberately specific and actionable, never technical,
 * and never implies a fault on the customer's side.
 */

export const QUOTE_ISSUE_COPY: Record<QuoteLineIssue, string> = {
  not_found: "This dish is no longer on the menu.",
  unavailable: "This dish is temporarily unavailable.",
  unpriced: "The price for this dish has not been confirmed yet.",
  variant_required: "Please choose a portion size for this dish.",
  variant_not_found: "That portion is no longer offered. Please choose another.",
  variant_unpriced: "The price for that portion has not been confirmed yet.",
  variant_ambiguous: "This dish has conflicting portion options. Please contact us.",
};

/** True when the issue blocks the line from being purchased. */
export function isBlockingIssue(issue: QuoteLineIssue | null): boolean {
  return issue !== null;
}

/** Human wording for an issue, with a safe fallback for unknown values. */
export function quoteIssueCopy(issue: QuoteLineIssue): string {
  return QUOTE_ISSUE_COPY[issue] ?? "This item cannot be ordered right now.";
}
