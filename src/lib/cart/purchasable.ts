import type { Product } from "@/types";

/**
 * Purchasability rules (Phase 4).
 *
 * One place decides whether a product can enter a cart, so the product card,
 * the product page and the cart reconciliation can never disagree:
 *
 *  - An `unavailable` product is never orderable, even though it may still be
 *    publicly visible under the catalogue's existing visibility policy.
 *  - A missing or zero price is never orderable. "Price to be confirmed" is a
 *    real state, not a free item.
 *  - When a product has options, an option must be chosen and only options the
 *    owner has actually priced are orderable.
 */

/** A configured, positive, whole-cent price. */
export function isPriced(cents: number | null | undefined): cents is number {
  return typeof cents === "number" && Number.isInteger(cents) && cents >= 1;
}

/** True when at least one of the product's options is orderable. */
export function hasOrderableVariant(product: Product): boolean {
  return product.variants.some((variant) => isPriced(variant.priceCents));
}

/** True when the product as a whole can be bought right now. */
export function canPurchase(product: Product): boolean {
  if (product.availability !== "available") return false;
  return product.variants.length > 0 ? hasOrderableVariant(product) : isPriced(product.priceCents);
}

/**
 * True when the product can be added straight from a listing without any
 * further selection. Products with options must go through the product page.
 */
export function canQuickAdd(product: Product): boolean {
  if (product.availability !== "available") return false;
  if (product.variants.length > 0) return false;
  return isPriced(product.priceCents);
}

/**
 * The unit price a customer pays for the product with no option selected, or
 * `null` when that is not a well-defined concept (options exist) or the price
 * is unconfirmed.
 */
export function baseUnitPrice(product: Product): number | null {
  if (product.variants.length > 0) return null;
  return isPriced(product.priceCents) ? product.priceCents : null;
}

/** Honest explanation for why a product cannot be added to the cart. */
export function notOrderableReason(product: Product): string {
  if (product.availability !== "available") {
    return "This dish is temporarily unavailable.";
  }
  if (product.variants.length > 0) {
    return hasOrderableVariant(product)
      ? "Choose an option to add this to your cart."
      : "The prices for this dish have not been confirmed yet.";
  }
  return "The price for this dish has not been confirmed yet.";
}
