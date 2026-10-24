"use server";

import { quoteCart } from "@/lib/cart/quote";
import { cartQuoteRequestSchema } from "@/lib/validations/cart";
import type { CartQuoteResponse } from "@/lib/validations/cart";

/**
 * Public cart quote action (Phase 4).
 *
 * The only server entry point the shopping cart needs. It is deliberately
 * minimal so its security properties are easy to reason about:
 *
 *  - **Read-only.** It never writes to MongoDB, never creates an order and
 *    never touches customer identity.
 *  - **Fully validated.** The payload is parsed with `cartQuoteRequestSchema`
 *    before anything else; anything malformed returns a neutral
 *    `{ ok: false, reason: "invalid" }` with no detail that could be probed.
 *  - **Bounded.** At most 30 lines, 25 units per line, 99 units per cart, and
 *    at most two indexed database reads per call.
 *  - **Public-safe output.** Only published products in active categories can
 *    appear in the response, which is exactly what `/menu` already exposes, so
 *    the endpoint reveals nothing new about the catalogue.
 *  - **Never cached.** Server Actions are per-request POSTs; no customer cart
 *    quote is ever written into a shared cache.
 *
 * The client never sends prices. Any total a browser believes is provisional
 * feedback only; this action is what makes a total authoritative.
 */
export async function quoteCartAction(request: unknown): Promise<CartQuoteResponse> {
  const parsed = cartQuoteRequestSchema.safeParse(request);
  if (!parsed.success) return { ok: false, reason: "invalid" };
  return quoteCart(parsed.data);
}
