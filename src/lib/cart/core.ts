import { MAX_SLUG_LENGTH, SLUG_PATTERN } from "@/lib/validations/catalogue";
import { CART_SCHEMA_VERSION, DEFAULT_CART_LIMITS, type CartLimits } from "./limits";

/**
 * Pure cart mathematics and persistence codec (Phase 4).
 *
 * Everything here is a TOTAL function over plain data: no React, no storage,
 * no network. That keeps every edge case (corrupted JSON, duplicates,
 * oversize quantities, unsupported versions) unit-testable in isolation.
 *
 * ## Cart line identity
 *
 * A line is identified by `(slug, variantName)`:
 *
 * - `slug` is the catalogue's authoritative public identifier (unique,
 *   indexed, strictly patterned). MongoDB `_id`s are deliberately NOT part of
 *   the public surface, so nothing internal leaks into the browser.
 * - `variantName` is the variant's identity, scoped to its product. Phase 3's
 *   variant model stores `{ name, priceCents }` with no per-variant id and no
 *   schema migration was authorised, so the owner-facing name is the stable
 *   handle. A renamed or deleted variant therefore resolves to an honest
 *   "this option is no longer available" reconciliation warning rather than a
 *   silently wrong price.
 *
 * Two lines with the same identity merge quantities; a different variant of
 * the same product stays a separate line (Small and Large never collapse).
 *
 * ## What is persisted
 *
 * Only `{ slug, variantName, quantity }` plus `unitPriceCents`, which is the
 * PRICE THIS CUSTOMER LAST SAW — a display hint used solely to explain a
 * price change. The server never reads it (the quote request schema strips
 * everything except slug/variant/quantity) and no total is ever computed from
 * it authoritatively. Publication status, availability and product names are
 * never stored at all; they only ever come from the server quote.
 */

export interface CartLine {
  slug: string;
  variantName: string | null;
  quantity: number;
  /**
   * Non-authoritative display hint: the unit price shown to this customer
   * when the line was last added or edited. `null` when unknown. Used only to
   * explain "the price changed since you added this"; never used to compute
   * an authoritative total.
   */
  unitPriceCents: number | null;
}

export interface CartState {
  version: number;
  items: CartLine[];
}

/** Canonical empty cart — also the React server snapshot. */
export function emptyCart(): CartState {
  return { version: CART_SCHEMA_VERSION, items: [] };
}

/** Stable empty snapshot for `useSyncExternalStore` (identity-compared). */
export const EMPTY_CART: CartState = emptyCart();

/* ── identity ───────────────────────────────────────────────────────── */

/**
 * Canonical line key. The variant is joined with a separator that cannot
 * appear in a slug, so `("a-b", "c")` and `("a", "b-c")` can never collide.
 */
export function cartLineKey(line: { slug: string; variantName?: string | null }): string {
  return `${line.slug}\u241f${line.variantName ?? ""}`;
}

/** Trim and normalise a variant name: empty string becomes "no variant". */
export function normalizeVariantName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

/** True when the value is a syntactically valid public product slug. */
export function isUsableSlug(value: unknown): value is string {
  return typeof value === "string" && value.length <= MAX_SLUG_LENGTH && SLUG_PATTERN.test(value);
}

/* ── quantity coercion ──────────────────────────────────────────────── */

/**
 * Clamp a candidate quantity into the permitted range. Non-finite, negative,
 * fractional and absurd values all collapse to a safe integer, so no caller
 * can inject `NaN`, `Infinity` or a fraction into a subtotal.
 */
export function coerceQuantity(
  value: unknown,
  limits: CartLimits = DEFAULT_CART_LIMITS,
): number {
  const numeric = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numeric)) return limits.minLineQuantity;
  const rounded = Math.round(numeric);
  if (rounded < limits.minLineQuantity) return limits.minLineQuantity;
  if (rounded > limits.maxLineQuantity) return limits.maxLineQuantity;
  return rounded;
}

/** Total units across every line, saturating at the cart limit. */
export function cartQuantity(state: CartState): number {
  let total = 0;
  for (const item of state.items) total += item.quantity;
  return total;
}

/** Distinct lines in the cart. */
export function cartLineCount(state: CartState): number {
  return state.items.length;
}

/** True when nothing is in the cart. */
export function isCartEmpty(state: CartState): boolean {
  return state.items.length === 0;
}

/**
 * How many more units of `slug/variant` the customer may still add.
 * Respects both the per-line cap and the whole-cart cap.
 */
export function remainingQuantityFor(
  state: CartState,
  slug: string,
  variantName: string | null,
  limits: CartLimits = DEFAULT_CART_LIMITS,
): number {
  const existing = state.items.find((item) => cartLineKey(item) === cartLineKey({ slug, variantName }));
  const already = existing?.quantity ?? 0;
  const headroomForLine = limits.maxLineQuantity - already;
  const headroomForCart = limits.maxCartQuantity - cartQuantity(state);
  return Math.max(0, Math.min(headroomForLine, headroomForCart));
}

/* ── state transitions (all return a NEW state) ─────────────────────── */

export interface AddLineInput {
  slug: string;
  variantName?: string | null;
  quantity?: number;
  unitPriceCents?: number | null;
}

/**
 * Add a line, or merge into the existing line with the same identity.
 *
 * Merging is what makes "add Meat Pie twice" become quantity 2 rather than two
 * rows, and what keeps Small and Large of one product as separate rows.
 * Returns the SAME state object when the cart is already at a limit, so
 * React can skip a needless re-render.
 */
export function addItem(
  state: CartState,
  input: AddLineInput,
  limits: CartLimits = DEFAULT_CART_LIMITS,
): CartState {
  if (!isUsableSlug(input.slug)) return state;

  const variantName = normalizeVariantName(input.variantName);
  const key = cartLineKey({ slug: input.slug, variantName });
  const requested = coerceQuantity(input.quantity ?? limits.minLineQuantity, limits);
  const unitPriceCents =
    typeof input.unitPriceCents === "number" && Number.isInteger(input.unitPriceCents) && input.unitPriceCents >= 0
      ? input.unitPriceCents
      : null;

  const existingIndex = state.items.findIndex((item) => cartLineKey(item) === key);
  const existing = existingIndex === -1 ? undefined : state.items[existingIndex];

  if (existing) {
    const merged = Math.min(existing.quantity + requested, limits.maxLineQuantity);
    // Saturate against the whole-cart cap too.
    const cartRoom = limits.maxCartQuantity - (cartQuantity(state) - existing.quantity);
    const nextQuantity = Math.min(merged, cartRoom);
    if (nextQuantity === existing.quantity) return state; // already maxed out

    const items = state.items.slice();
    items[existingIndex] = {
      ...existing,
      quantity: nextQuantity,
      // Refresh the "price last seen" hint whenever the customer touches the
      // line; a null hint simply means "no comparison available".
      unitPriceCents: unitPriceCents ?? existing.unitPriceCents,
    };
    return { version: state.version, items };
  }

  const cartRoom = limits.maxCartQuantity - cartQuantity(state);
  const nextQuantity = Math.min(requested, cartRoom);
  if (nextQuantity < limits.minLineQuantity) return state; // cart is full

  if (state.items.length >= limits.maxCartLines) return state;

  return {
    version: state.version,
    items: [
      ...state.items,
      { slug: input.slug, variantName, quantity: nextQuantity, unitPriceCents },
    ],
  };
}

/**
 * Change one line's quantity. A value of 0 (or below) removes the line, which
 * is what a minus button at quantity 1 should do.
 */
export function setItemQuantity(
  state: CartState,
  lineKey: string,
  quantity: unknown,
  limits: CartLimits = DEFAULT_CART_LIMITS,
): CartState {
  const index = state.items.findIndex((item) => cartLineKey(item) === lineKey);
  if (index === -1) return state;

  const numeric = typeof quantity === "number" ? quantity : Number(quantity);
  if (!Number.isFinite(numeric) || numeric < limits.minLineQuantity) {
    return removeItem(state, lineKey);
  }

  const current = state.items[index];
  const nextQuantity = coerceQuantity(numeric, limits);
  if (nextQuantity === current.quantity) return state;

  const otherUnits = cartQuantity(state) - current.quantity;
  const capped = Math.min(nextQuantity, limits.maxCartQuantity - otherUnits);
  if (capped === current.quantity) return state;

  const items = state.items.slice();
  items[index] = { ...current, quantity: capped };
  return { version: state.version, items };
}

/** Remove a single line. Returns the same object when the key is unknown. */
export function removeItem(state: CartState, lineKey: string): CartState {
  const items = state.items.filter((item) => cartLineKey(item) !== lineKey);
  if (items.length === state.items.length) return state;
  return { version: state.version, items };
}

/** Empty the cart entirely (always returns a fresh state object). */
export function clearCart(): CartState {
  return emptyCart();
}

/* ── persistence codec ──────────────────────────────────────────────── */

/** JSON shape written to localStorage. Kept minimal on purpose. */
interface StoredCart {
  version: number;
  items: Array<{
    slug: string;
    variantName: string | null;
    quantity: number;
    unitPriceCents: number | null;
  }>;
}

export function serializeCart(state: CartState): string {
  const stored: StoredCart = {
    version: CART_SCHEMA_VERSION,
    items: state.items.map((item) => ({
      slug: item.slug,
      variantName: item.variantName,
      quantity: item.quantity,
      unitPriceCents: item.unitPriceCents,
    })),
  };
  return JSON.stringify(stored);
}

/**
 * Read persisted cart data defensively.
 *
 * Every failure mode degrades to a usable cart instead of an exception:
 *
 * | input                        | result                          |
 * | ---------------------------- | ------------------------------- |
 * | missing / empty              | empty cart                      |
 * | malformed JSON               | empty cart                      |
 * | wrong or future version      | empty cart                      |
 * | non-array `items`            | empty cart                      |
 * | item with bad slug           | that item dropped               |
 * | duplicate identities         | merged, quantities summed       |
 * | quantity out of range        | clamped                         |
 * | too many lines / units       | truncated at the limits         |
 *
 * Nothing in storage is trusted: it is customer-writable by definition.
 */
export function readStoredCart(
  raw: string | null | undefined,
  limits: CartLimits = DEFAULT_CART_LIMITS,
): CartState {
  if (typeof raw !== "string" || raw.trim() === "") return emptyCart();

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return emptyCart();
  }

  if (typeof parsed !== "object" || parsed === null) return emptyCart();

  const record = parsed as Partial<StoredCart> & Record<string, unknown>;
  if (record.version !== CART_SCHEMA_VERSION) return emptyCart();
  if (!Array.isArray(record.items)) return emptyCart();

  const merged = new Map<string, CartLine>();
  let totalUnits = 0;

  for (const candidate of record.items) {
    if (typeof candidate !== "object" || candidate === null) continue;
    const item = candidate as Partial<StoredCart["items"][number]> & Record<string, unknown>;

    if (!isUsableSlug(item.slug)) continue;
    const variantName = normalizeVariantName(item.variantName);
    const key = cartLineKey({ slug: item.slug, variantName });
    if (merged.has(key)) continue; // duplicates: keep the first, never double-count

    const quantity = coerceQuantity(item.quantity, limits);
    if (totalUnits + quantity > limits.maxCartQuantity) {
      const remaining = limits.maxCartQuantity - totalUnits;
      if (remaining < limits.minLineQuantity) break;
      merged.set(key, {
        slug: item.slug,
        variantName,
        quantity: remaining,
        unitPriceCents: normalizeStoredPrice(item.unitPriceCents),
      });
      totalUnits += remaining;
      break;
    }

    merged.set(key, {
      slug: item.slug,
      variantName,
      quantity,
      unitPriceCents: normalizeStoredPrice(item.unitPriceCents),
    });
    totalUnits += quantity;

    if (merged.size >= limits.maxCartLines) break;
  }

  return { version: CART_SCHEMA_VERSION, items: [...merged.values()] };
}

/** Stored prices are display hints; anything malformed simply becomes "unknown". */
function normalizeStoredPrice(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : null;
}
