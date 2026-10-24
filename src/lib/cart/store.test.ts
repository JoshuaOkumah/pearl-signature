// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CART_STORAGE_KEY } from "./limits";
import { readStoredCart, serializeCart, emptyCart, cartLineKey } from "./core";
import {
  addToCart,
  clearWholeCart,
  currentCartQuantity,
  getCartSnapshot,
  getServerCartSnapshot,
  getServerHydratedSnapshot,
  getServerStorageSnapshot,
  hydrateCartStore,
  isCartStorageAvailable,
  reloadCartStore,
  removeFromCart,
  setCartQuantity,
  startCartStorageSync,
} from "./store";

/** Write a raw value straight into storage, bypassing the store's own writes. */
function seed(raw: string | null): void {
  if (raw === null) {
    window.localStorage.removeItem(CART_STORAGE_KEY);
  } else {
    window.localStorage.setItem(CART_STORAGE_KEY, raw);
  }
}

/** Simulate the browser firing a cross-tab `storage` event for our key. */
function fireStorage(key: string | null, newValue: string | null): void {
  const event = new StorageEvent("storage", { key, newValue });
  window.dispatchEvent(event);
}

beforeEach(() => {
  // The store is a module-level singleton: reset both its in-memory state and
  // the backing storage so tests never leak into one another.
  window.localStorage.clear();
  clearWholeCart();
  hydrateCartStore();
  seed(null);
  reloadCartStore();
});

describe("server snapshots", () => {
  it("returns stable identities so React never re-renders in a loop", () => {
    expect(getServerCartSnapshot()).toBe(getServerCartSnapshot());
    expect(getServerCartSnapshot()).toEqual(emptyCart());
    expect(getServerHydratedSnapshot()).toBe(false);
    expect(getServerStorageSnapshot()).toBe(true);
  });
});

describe("hydration", () => {
  it("reads a persisted cart exactly once", async () => {
    // Fresh module instance so `hydrated` starts false (the singleton was
    // already hydrated in beforeEach).
    vi.resetModules();
    const fresh = await import("./store");

    seed(
      serializeCart({
        version: 1,
        items: [{ slug: "meat-pie", variantName: null, quantity: 3, unitPriceCents: 500 }],
      }),
    );
    expect(fresh.isCartHydrated()).toBe(false);

    fresh.hydrateCartStore();
    expect(fresh.isCartHydrated()).toBe(true);
    expect(fresh.getCartSnapshot().items[0]).toMatchObject({ slug: "meat-pie", quantity: 3 });

    // A second call must not re-read: an add performed between the two calls
    // would otherwise be discarded.
    seed(null);
    fresh.hydrateCartStore();
    expect(fresh.getCartSnapshot().items).toHaveLength(1);
  });

  it("reports hydration to subscribers even for an empty cart", async () => {
    // The store is a singleton already hydrated in beforeEach; reload the
    // module so `hydrated` starts false again.
    vi.resetModules();
    const fresh = await import("./store");

    const listener = vi.fn();
    const stop = fresh.subscribeToCart(listener);
    fresh.hydrateCartStore();
    expect(listener).toHaveBeenCalledTimes(1);
    stop();
  });
});

describe("storage availability", () => {
  it("continues in memory and flags the loss when reading throws", () => {
    const getItem = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new DOMException("denied", "SecurityError");
    });

    reloadCartStore();
    expect(isCartStorageAvailable()).toBe(false);
    // Adding still works; it just will not survive a refresh.
    addToCart({ slug: "meat-pie", quantity: 1, unitPriceCents: 500 });
    expect(getCartSnapshot().items).toHaveLength(1);

    getItem.mockRestore();
    reloadCartStore();
    expect(isCartStorageAvailable()).toBe(true);
  });

  it("flags the loss when writing throws, without breaking the add", () => {
    addToCart({ slug: "before", quantity: 1 });
    const setItem = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("quota", "QuotaExceededError");
    });

    addToCart({ slug: "meat-pie", quantity: 2, unitPriceCents: 500 });
    expect(getCartSnapshot().items).toHaveLength(2);
    expect(isCartStorageAvailable()).toBe(false);

    setItem.mockRestore();
  });
});

describe("persistence", () => {
  it("writes every mutation to localStorage under the versioned key", () => {
    addToCart({ slug: "meat-pie", quantity: 2, unitPriceCents: 500 });
    expect(readStoredCart(window.localStorage.getItem(CART_STORAGE_KEY)).items).toEqual([
      { slug: "meat-pie", variantName: null, quantity: 2, unitPriceCents: 500 },
    ]);

    const key = cartLineKey({ slug: "meat-pie" });
    setCartQuantity(key, 1);
    expect(getCartSnapshot().items[0].quantity).toBe(1);

    removeFromCart(key);
    expect(getCartSnapshot().items).toHaveLength(0);
    expect(readStoredCart(window.localStorage.getItem(CART_STORAGE_KEY)).items).toHaveLength(0);
  });

  it("clears the cart on request", () => {
    addToCart({ slug: "meat-pie", quantity: 1 });
    clearWholeCart();

    expect(currentCartQuantity()).toBe(0);
    expect(getCartSnapshot().items).toHaveLength(0);
  });
});

describe("cross-tab synchronisation", () => {
  it("applies another tab's cart without writing it back", () => {
    const other = serializeCart({
      version: 1,
      items: [{ slug: "zobo", variantName: null, quantity: 4, unitPriceCents: null }],
    });
    // Seed BEFORE spying: the seed itself writes, and only the store's own
    // re-serialization would be a ping-pong.
    seed(other);
    const setItem = vi.spyOn(Storage.prototype, "setItem");

    const stop = startCartStorageSync();
    fireStorage(CART_STORAGE_KEY, other);

    expect(getCartSnapshot().items).toHaveLength(1);
    expect(getCartSnapshot().items[0].slug).toBe("zobo");
    // Applying the incoming value must not re-serialize (that would ping-pong
    // between tabs).
    expect(setItem).not.toHaveBeenCalled();

    stop();
    setItem.mockRestore();
  });

  it("ignores events for unrelated keys", () => {
    const before = getCartSnapshot();
    const stop = startCartStorageSync();

    fireStorage("some-other-app-key", "{}");

    expect(getCartSnapshot()).toBe(before);
    stop();
  });

  it("treats a full clear (key === null) as an empty cart", () => {
    addToCart({ slug: "meat-pie", quantity: 1 });
    const stop = startCartStorageSync();

    seed(null);
    fireStorage(null, null);

    expect(getCartSnapshot().items).toHaveLength(0);
    stop();
  });

  it("removes its listener when stopped", () => {
    const remove = vi.spyOn(window, "removeEventListener");
    const stop = startCartStorageSync();
    stop();

    expect(remove).toHaveBeenCalledWith("storage", expect.any(Function));
    remove.mockRestore();
  });
});
