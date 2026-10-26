import { z } from "zod";
import { MAX_SLUG_LENGTH, SLUG_PATTERN } from "@/lib/validations/catalogue";
import {
  MAX_CART_LINES,
  MAX_CART_QUANTITY,
  MAX_LINE_QUANTITY,
  MIN_LINE_QUANTITY,
} from "@/lib/cart/limits";

/**
 * Request contract for the cart quote / reconciliation service (Phase 4).
 *
 * This is the public boundary between a customer's browser and the catalogue.
 * Everything arriving from the client is treated as hostile:
 *
 *  - slug format is strictly patterned (the same pattern that guards every
 *    public catalogue query), so no arbitrary string can reach a query;
 *  - quantities are integers inside explicit per-line and whole-cart bounds;
 *  - line count is bounded, so one request can never trigger an unbounded
 *    read;
 *  - duplicate line identities are rejected outright — the client merges
 *    them, so duplicates can only come from a tampered request.
 *
 * Note what is ABSENT: no prices, no product names, no availability or
 * publication flags, no totals. The server derives all of those from
 * MongoDB, so a customer can never assert a $0.00 price or an "available"
 * flag and have it believed.
 */

export const cartItemRequestSchema = z
  .object({
    slug: z
      .string()
      .trim()
      .max(MAX_SLUG_LENGTH, "Product address is too long")
      .regex(SLUG_PATTERN, "Not a valid product"),
    /** Empty string and whitespace normalise to "no variant selected". */
    variantName: z
      .string()
      .trim()
      .max(80, "Option name is too long")
      .nullable()
      .transform((value) => (value === null ? null : value === "" ? null : value)),
    quantity: z.coerce
      .number({ message: "Quantity must be a number" })
      .int("Quantity must be a whole number")
      .min(MIN_LINE_QUANTITY, `Quantity must be at least ${MIN_LINE_QUANTITY}`)
      .max(MAX_LINE_QUANTITY, `Quantity must be at most ${MAX_LINE_QUANTITY}`),
  })
  .superRefine((item, ctx) => {
    if (item.variantName !== null && item.variantName.trim() === "") {
      ctx.addIssue({ code: "custom", message: "Option name is required" });
    }
  });

export type CartItemRequest = z.output<typeof cartItemRequestSchema>;

/**
 * Cart-wide rules shared by EVERY endpoint that accepts cart lines: the
 * quote service (Phase 4) and order creation (Phase 5) both call this, so
 * the two boundaries can never disagree about what a valid cart is.
 */
export function cartItemsRefine(
  request: { items: CartItemRequest[] },
  ctx: z.RefinementCtx,
): void {
  const total = request.items.reduce((sum, item) => sum + item.quantity, 0);
  if (total > MAX_CART_QUANTITY) {
    ctx.addIssue({
      code: "custom",
      message: `A cart can hold at most ${MAX_CART_QUANTITY} items in total`,
    });
  }

  const seen = new Set<string>();
  for (const item of request.items) {
    const key = `${item.slug} ${item.variantName ?? ""}`;
    if (seen.has(key)) {
      ctx.addIssue({ code: "custom", message: "Duplicate cart line" });
      break;
    }
    seen.add(key);
  }
}

export const cartQuoteRequestSchema = z
  .object({
    items: z
      .array(cartItemRequestSchema)
      .min(1, "Your cart is empty")
      .max(MAX_CART_LINES, `A cart can hold at most ${MAX_CART_LINES} different items`),
  })
  .superRefine(cartItemsRefine);

export type CartQuoteRequest = z.output<typeof cartQuoteRequestSchema>;

/* ── quote response shapes (shared by server and client) ────────────── */

/**
 * Why a line cannot be purchased right now.
 *
 * `not_found` deliberately covers "never existed", "draft", "archived" and
 * "category disabled" with ONE message, so the public quote can never be used
 * to discover whether an unpublished product exists.
 */
export type QuoteLineIssue =
  | "not_found"
  | "unavailable"
  | "unpriced"
  | "variant_required"
  | "variant_not_found"
  | "variant_unpriced"
  | "variant_ambiguous";

export interface QuotedLine {
  slug: string;
  variantName: string | null;
  quantity: number;
  /** null unless the line is purchasable right now. */
  unitPriceCents: number | null;
  lineTotalCents: number | null;
  /** null when the product cannot be shown (see `issue`). */
  name: string | null;
  categorySlug: string | null;
  image: { secureUrl: string; alt: string } | null;
  issue: QuoteLineIssue | null;
}

export interface CartQuote {
  lines: QuotedLine[];
  /** Sum of purchasable lines only, in integer CAD cents. */
  subtotalCents: number;
  /** Units across purchasable lines only. */
  purchasableQuantity: number;
  purchasableLineCount: number;
  /** True when at least one line needs the customer's attention. */
  hasIssues: boolean;
}

export type CartQuoteResponse =
  | { ok: true; quote: CartQuote }
  | { ok: false; reason: "invalid" | "unavailable" };
