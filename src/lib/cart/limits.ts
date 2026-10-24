/**
 * Cart bounds and storage keys (Phase 4).
 *
 * These numbers are enforced in TWO places on purpose:
 *
 *  1. The browser, for immediate friendly feedback.
 *  2. The server-side Zod schema (`src/lib/validations/cart.ts`), which is the
 *     only real boundary. localStorage is customer-controlled, so anything
 *     here is a convenience limit, never a security control.
 *
 * Chosen limits: a single line tops out at 25 (generous for a family meal),
 * a whole cart at 99 units across at most 30 distinct lines. Both keep the
 * quote request small enough for one batched query and keep subtotals inside
 * safe-integer range by a very wide margin.
 */

export const CART_STORAGE_KEY = "pearl-cart-v1";
export const CART_SCHEMA_VERSION = 1;

export const MIN_LINE_QUANTITY = 1;
export const MAX_LINE_QUANTITY = 25;
export const MAX_CART_QUANTITY = 99;
export const MAX_CART_LINES = 30;

export interface CartLimits {
  minLineQuantity: number;
  maxLineQuantity: number;
  maxCartQuantity: number;
  maxCartLines: number;
}

export const DEFAULT_CART_LIMITS: CartLimits = {
  minLineQuantity: MIN_LINE_QUANTITY,
  maxLineQuantity: MAX_LINE_QUANTITY,
  maxCartQuantity: MAX_CART_QUANTITY,
  maxCartLines: MAX_CART_LINES,
};
