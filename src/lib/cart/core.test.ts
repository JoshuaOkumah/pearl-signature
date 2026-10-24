import { describe, expect, it } from "vitest";
import {
  EMPTY_CART,
  addItem,
  cartLineKey,
  cartQuantity,
  clearCart,
  coerceQuantity,
  emptyCart,
  isCartEmpty,
  isUsableSlug,
  normalizeVariantName,
  readStoredCart,
  remainingQuantityFor,
  removeItem,
  serializeCart,
  setItemQuantity,
  type CartState,
} from "./core";
import { CART_SCHEMA_VERSION, DEFAULT_CART_LIMITS, MAX_CART_LINES, MAX_LINE_QUANTITY } from "./limits";

/** Shorthand for a cart built from `[slug, variant, quantity]` triples. */
function cartOf(...lines: Array<[string, string | null, number]>): CartState {
  return lines.reduce<CartState>(
    (state, [slug, variantName, quantity]) =>
      addItem(state, { slug, variantName, quantity, unitPriceCents: null }),
    emptyCart(),
  );
}

describe("cart identity", () => {
  it("keeps different variants of one product as different lines", () => {
    let state = emptyCart();
    state = addItem(state, { slug: "portion-pack", variantName: "Small", quantity: 1 });
    state = addItem(state, { slug: "portion-pack", variantName: "Large", quantity: 1 });

    expect(state.items).toHaveLength(2);
    expect(state.items.map((item) => item.variantName)).toEqual(["Small", "Large"]);
  });

  it("never lets a variant name collide with a longer slug", () => {
    // "a-b" + "c" must not equal "a" + "b-c": the separator is not legal in a
    // slug, so the two identities can never coincide.
    expect(cartLineKey({ slug: "a-b", variantName: "c" })).not.toBe(
      cartLineKey({ slug: "a", variantName: "b-c" }),
    );
  });

  it("treats an empty or whitespace variant name as no variant", () => {
    expect(normalizeVariantName("")).toBeNull();
    expect(normalizeVariantName("   ")).toBeNull();
    expect(normalizeVariantName(" Large ")).toBe("Large");
    expect(normalizeVariantName(42)).toBeNull();
  });

  it("rejects slugs that are not valid public product addresses", () => {
    expect(isUsableSlug("egusi-soup")).toBe(true);
    expect(isUsableSlug("Egusi Soup")).toBe(false);
    expect(isUsableSlug("../../etc/passwd")).toBe(false);
    expect(isUsableSlug("")).toBe(false);
    expect(isUsableSlug(123)).toBe(false);
    expect(isUsableSlug("a".repeat(200))).toBe(false);
  });
});

describe("quantity coercion", () => {
  it("clamps absurd, fractional and non-numeric values", () => {
    expect(coerceQuantity(0)).toBe(1);
    expect(coerceQuantity(-5)).toBe(1);
    expect(coerceQuantity(3.6)).toBe(4);
    expect(coerceQuantity(Number.NaN)).toBe(1);
    expect(coerceQuantity(Number.POSITIVE_INFINITY)).toBe(1);
    expect(coerceQuantity("7")).toBe(7);
    expect(coerceQuantity("abc")).toBe(1);
    expect(coerceQuantity(10_000)).toBe(MAX_LINE_QUANTITY);
  });
});

describe("adding items", () => {
  it("adds a valid product as a new line", () => {
    const state = addItem(emptyCart(), { slug: "meat-pie", quantity: 1, unitPriceCents: 500 });

    expect(state.items).toHaveLength(1);
    expect(state.items[0]).toEqual({
      slug: "meat-pie",
      variantName: null,
      quantity: 1,
      unitPriceCents: 500,
    });
  });

  it("merges a repeat add of the same product into one line", () => {
    let state = addItem(emptyCart(), { slug: "meat-pie", quantity: 1 });
    state = addItem(state, { slug: "meat-pie", quantity: 1 });

    expect(state.items).toHaveLength(1);
    expect(state.items[0].quantity).toBe(2);
  });

  it("merges the same variant but separates different ones", () => {
    let state = addItem(emptyCart(), { slug: "pack", variantName: "Small", quantity: 1 });
    state = addItem(state, { slug: "pack", variantName: "Small", quantity: 2 });
    state = addItem(state, { slug: "pack", variantName: "Large", quantity: 1 });

    expect(state.items).toHaveLength(2);
    expect(state.items[0].quantity).toBe(3); // Small merged
    expect(state.items[1].quantity).toBe(1); // Large separate
  });

  it("refuses to add an unusable slug and returns the same state", () => {
    const before = emptyCart();
    expect(addItem(before, { slug: "not a slug", quantity: 1 })).toBe(before);
  });

  it("saturates at the per-line limit instead of overshooting", () => {
    let state = addItem(emptyCart(), { slug: "meat-pie", quantity: 20 });
    state = addItem(state, { slug: "meat-pie", quantity: 20 });

    expect(state.items[0].quantity).toBe(MAX_LINE_QUANTITY);
  });

  it("returns the SAME state object when a maxed-out line is added again", () => {
    const maxed = addItem(emptyCart(), { slug: "meat-pie", quantity: MAX_LINE_QUANTITY });
    expect(addItem(maxed, { slug: "meat-pie", quantity: 1 })).toBe(maxed);
  });

  it("refuses a new line once the distinct-line limit is reached", () => {
    let state = emptyCart();
    for (let index = 0; index < MAX_CART_LINES; index += 1) {
      state = addItem(state, { slug: `dish-${index}`, quantity: 1 });
    }
    expect(state.items).toHaveLength(MAX_CART_LINES);

    const next = addItem(state, { slug: "one-too-many", quantity: 1 });
    expect(next).toBe(state);
  });

  it("keeps a non-integer or negative stored price as unknown", () => {
    const state = addItem(emptyCart(), { slug: "meat-pie", quantity: 1, unitPriceCents: -1 });
    expect(state.items[0].unitPriceCents).toBeNull();
  });
});

describe("changing quantity", () => {
  it("increases and decreases an existing line", () => {
    const base = cartOf(["meat-pie", null, 2]);

    expect(setItemQuantity(base, cartLineKey({ slug: "meat-pie" }), 3).items[0].quantity).toBe(3);
    expect(setItemQuantity(base, cartLineKey({ slug: "meat-pie" }), 1).items[0].quantity).toBe(1);
  });

  it("removes the line when quantity drops to zero or below", () => {
    const base = cartOf(["meat-pie", null, 2]);

    expect(setItemQuantity(base, cartLineKey({ slug: "meat-pie" }), 0).items).toHaveLength(0);
    expect(setItemQuantity(base, cartLineKey({ slug: "meat-pie" }), -1).items).toHaveLength(0);
  });

  it("clamps an oversize quantity to the per-line limit", () => {
    const base = cartOf(["meat-pie", null, 1]);
    expect(setItemQuantity(base, cartLineKey({ slug: "meat-pie" }), 9_999).items[0].quantity).toBe(
      MAX_LINE_QUANTITY,
    );
  });

  it("never exceeds the whole-cart limit even if every line asks for more", () => {
    const limits = { ...DEFAULT_CART_LIMITS, maxCartQuantity: 10, maxLineQuantity: 10 };
    let state = emptyCart();
    state = addItem(state, { slug: "a", quantity: 6 }, limits);
    state = addItem(state, { slug: "b", quantity: 4 }, limits);
    expect(cartQuantity(state)).toBe(10);

    // The cart is full: no line may grow.
    const grown = setItemQuantity(state, cartLineKey({ slug: "a" }), 10, limits);
    expect(cartQuantity(grown)).toBe(10);

    // A brand-new line cannot squeeze in either.
    expect(addItem(state, { slug: "c", quantity: 1 }, limits)).toBe(state);
  });

  it("returns the same state when the key or quantity is unchanged", () => {
    const base = cartOf(["meat-pie", null, 2]);
    expect(setItemQuantity(base, cartLineKey({ slug: "meat-pie" }), 2)).toBe(base);
    expect(setItemQuantity(base, cartLineKey({ slug: "nope" }), 5)).toBe(base);
  });
});

describe("removing and clearing", () => {
  it("removes only the addressed line", () => {
    const base = cartOf(["meat-pie", null, 1], ["zobo", null, 2]);
    const next = removeItem(base, cartLineKey({ slug: "zobo" }));

    expect(next.items.map((item) => item.slug)).toEqual(["meat-pie"]);
  });

  it("returns the same state when the key is unknown", () => {
    const base = cartOf(["meat-pie", null, 1]);
    expect(removeItem(base, cartLineKey({ slug: "ghost" }))).toBe(base);
  });

  it("clears the whole cart", () => {
    const base = cartOf(["meat-pie", null, 1], ["zobo", null, 2]);
    const cleared = clearCart();

    expect(isCartEmpty(cleared)).toBe(true);
    expect(cleared).not.toBe(base);
  });
});

describe("reading persisted cart data", () => {
  it("returns an empty cart for missing or empty storage", () => {
    expect(readStoredCart(null)).toEqual(emptyCart());
    expect(readStoredCart(undefined)).toEqual(emptyCart());
    expect(readStoredCart("")).toEqual(emptyCart());
    expect(readStoredCart("   ")).toEqual(emptyCart());
  });

  it("recovers from corrupted JSON without throwing", () => {
    expect(readStoredCart("{not json")).toEqual(emptyCart());
    expect(readStoredCart("42")).toEqual(emptyCart());
    expect(readStoredCart("null")).toEqual(emptyCart());
    expect(readStoredCart('"a string"')).toEqual(emptyCart());
  });

  it("drops a cart written by an unknown schema version", () => {
    const future = JSON.stringify({ version: 99, items: [{ slug: "meat-pie", quantity: 1 }] });
    expect(readStoredCart(future)).toEqual(emptyCart());
  });

  it("drops malformed entries but keeps the good ones", () => {
    const raw = JSON.stringify({
      version: CART_SCHEMA_VERSION,
      items: [
        { slug: "meat-pie", variantName: null, quantity: 2, unitPriceCents: 500 },
        { slug: "Not A Slug", variantName: null, quantity: 1 },
        "not-an-object",
        { slug: "zobo", variantName: null, quantity: "three" },
        null,
      ],
    });

    const cart = readStoredCart(raw);
    expect(cart.items).toEqual([
      { slug: "meat-pie", variantName: null, quantity: 2, unitPriceCents: 500 },
      { slug: "zobo", variantName: null, quantity: 1, unitPriceCents: null },
    ]);
  });

  it("merges duplicate identities rather than double counting them", () => {
    const raw = JSON.stringify({
      version: CART_SCHEMA_VERSION,
      items: [
        { slug: "meat-pie", variantName: null, quantity: 2 },
        { slug: "meat-pie", variantName: null, quantity: 5 },
        { slug: "meat-pie", variantName: "", quantity: 1 }, // same identity
      ],
    });

    const cart = readStoredCart(raw);
    expect(cart.items).toHaveLength(1);
    expect(cart.items[0].quantity).toBe(2); // first entry wins
  });

  it("clamps an out-of-range persisted quantity", () => {
    const raw = JSON.stringify({
      version: CART_SCHEMA_VERSION,
      items: [{ slug: "meat-pie", variantName: null, quantity: 5_000 }],
    });

    expect(readStoredCart(raw).items[0].quantity).toBe(MAX_LINE_QUANTITY);
  });

  it("truncates a persisted cart that exceeds the unit limit", () => {
    const items = Array.from({ length: 20 }, (_, index) => ({
      slug: `dish-${index}`,
      variantName: null,
      quantity: 10,
    }));
    const cart = readStoredCart(JSON.stringify({ version: CART_SCHEMA_VERSION, items }));

    expect(cartQuantity(cart)).toBeLessThanOrEqual(DEFAULT_CART_LIMITS.maxCartQuantity);
  });

  it("treats a malformed stored price as unknown rather than trusting it", () => {
    const raw = JSON.stringify({
      version: CART_SCHEMA_VERSION,
      items: [{ slug: "meat-pie", variantName: null, quantity: 1, unitPriceCents: "free" }],
    });

    expect(readStoredCart(raw).items[0].unitPriceCents).toBeNull();
  });
});

describe("serialization", () => {
  it("round-trips a cart through storage", () => {
    const original = cartOf(["meat-pie", null, 2], ["pack", "Large", 1]);
    expect(readStoredCart(serializeCart(original))).toEqual(original);
  });

  it("writes only identities, quantities and the schema version", () => {
    const parsed = JSON.parse(serializeCart(cartOf(["meat-pie", null, 2])));

    expect(Object.keys(parsed).sort()).toEqual(["items", "version"]);
    expect(Object.keys(parsed.items[0]).sort()).toEqual([
      "quantity",
      "slug",
      "unitPriceCents",
      "variantName",
    ]);
    // No product name, price authority, availability or status ever persists.
    expect(parsed.items[0]).not.toHaveProperty("name");
    expect(parsed.items[0]).not.toHaveProperty("available");
    expect(parsed.items[0]).not.toHaveProperty("status");
  });
});

describe("cart helpers", () => {
  it("counts units across every line", () => {
    expect(cartQuantity(cartOf(["a", null, 2], ["b", null, 3]))).toBe(5);
    expect(cartQuantity(EMPTY_CART)).toBe(0);
  });

  it("reports how much room is left for a given line", () => {
    const state = cartOf(["meat-pie", null, 23]);

    // Per-line headroom (25 - 23 = 2) is the binding constraint here.
    expect(remainingQuantityFor(state, "meat-pie", null)).toBe(2);
    // A brand-new line is limited only by the cart-wide cap.
    expect(remainingQuantityFor(state, "zobo", null)).toBeLessThanOrEqual(
      DEFAULT_CART_LIMITS.maxCartQuantity - 23,
    );
  });

  it("exposes a stable empty snapshot for server rendering", () => {
    expect(EMPTY_CART).toEqual(emptyCart());
    expect(EMPTY_CART).toBe(EMPTY_CART);
  });
});
