/**
 * Currency and text formatting helpers.
 *
 * All monetary values are integer Canadian cents (see src/types). The only
 * conversion to a display string happens here, so every surface formats
 * prices identically.
 */

const cadFormatter = new Intl.NumberFormat("en-CA", {
  style: "currency",
  currency: "CAD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/**
 * Format integer CAD cents as customer-facing currency, e.g. `1800` →
 * `$18.00 CAD`.
 *
 * Returns `null` for unconfigured or malformed values — callers render an
 * honest “Price to be confirmed” state instead of a fake amount.
 */
export function formatCad(cents: number | null | undefined): string | null {
  if (typeof cents !== "number" || !Number.isFinite(cents) || !Number.isInteger(cents) || cents < 0) {
    return null;
  }
  return `${cadFormatter.format(cents / 100)} CAD`;
}

/**
 * Trim text for metadata descriptions at a word boundary (no mid-word cuts),
 * appending an ellipsis when shortened.
 */
export function excerpt(text: string, maxLength = 160): string {
  const clean = text.trim().replace(/\s+/g, " ");
  if (clean.length <= maxLength) return clean;
  const cut = clean.slice(0, maxLength);
  const boundary = cut.lastIndexOf(" ");
  return `${(boundary > 40 ? cut.slice(0, boundary) : cut).trimEnd()}…`;
}
