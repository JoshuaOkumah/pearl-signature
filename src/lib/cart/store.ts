import {
  EMPTY_CART,
  addItem as addLine,
  clearCart as resetCart,
  cartQuantity,
  readStoredCart,
  removeItem as dropLine,
  serializeCart,
  setItemQuantity as adjustLine,
  type AddLineInput,
  type CartState,
} from "./core";
import { CART_STORAGE_KEY } from "./limits";

/**
 * The single client-side cart store (Phase 4).
 *
 * A tiny hand-rolled observable rather than Redux/Zustand: the cart is one
 * array of three fields, and pulling in a state library for it would cost more
 * bundle and cognitive weight than the problem deserves. React reads it with
 * `useSyncExternalStore`, which is what makes server and client agree without
 * hydration warnings.
 *
 * Responsibilities kept here (and nowhere else):
 *  - the current cart state
 *  - persistence to `localStorage`, including storage being unavailable
 *  - cross-tab synchronisation through the `storage` event
 *
 * All cart *math* lives in `core.ts` and is pure.
 */

let state: CartState = EMPTY_CART;
let hydrated = false;
let storageAvailable = true;
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

/** Server snapshots. Stable constants — React compares them by identity. */
const SERVER_HYDRATED = false;
const SERVER_STORAGE_AVAILABLE = true;

/** Read the persisted cart. Storage may be blocked (private mode, policy). */
function readFromStorage(): { state: CartState; available: boolean } {
  try {
    const raw = window.localStorage.getItem(CART_STORAGE_KEY);
    return { state: readStoredCart(raw), available: true };
  } catch {
    // Accessing localStorage itself threw: the cart still works in memory for
    // this session, it simply will not survive a refresh.
    return { state: EMPTY_CART, available: false };
  }
}

function writeToStorage(next: CartState): void {
  try {
    window.localStorage.setItem(CART_STORAGE_KEY, serializeCart(next));
    storageAvailable = true;
  } catch {
    // Quota exceeded or storage disabled. Losing persistence is far better
    // than breaking the add-to-cart interaction, so the cart continues in
    // memory and `storageAvailable` lets the UI say so honestly.
    storageAvailable = false;
  }
}

/* ── React bindings ─────────────────────────────────────────────────── */

export function subscribeToCart(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Client snapshot. */
export function getCartSnapshot(): CartState {
  return state;
}

/**
 * Server snapshot. A stable constant is essential: React compares snapshots by
 * identity, so returning a fresh object each call would loop forever.
 */
export function getServerCartSnapshot(): CartState {
  return EMPTY_CART;
}

/** True once the persisted cart has been read on the client. */
export function isCartHydrated(): boolean {
  return hydrated;
}

export function getServerHydratedSnapshot(): boolean {
  return SERVER_HYDRATED;
}

/** True when this browser could read persisted cart data. */
export function isCartStorageAvailable(): boolean {
  return storageAvailable;
}

export function getServerStorageSnapshot(): boolean {
  return SERVER_STORAGE_AVAILABLE;
}

/* ── lifecycle ──────────────────────────────────────────────────────── */

/**
 * Load the persisted cart exactly once, on the client, after mount. Never
 * runs during SSR or the hydration render, which is why the server snapshot
 * stays empty and no hydration mismatch is possible.
 *
 * Always emits, even for an empty cart: subscribers use it to learn that
 * hydration has finished, which is what stops a "0" badge flashing before the
 * real count is read.
 */
export function hydrateCartStore(): void {
  if (hydrated) return;
  hydrated = true;
  const result = readFromStorage();
  storageAvailable = result.available;
  state = result.state;
  emit();
}

/** Force a re-read of storage (used by tests and the cross-tab handler). */
export function reloadCartStore(): void {
  const result = readFromStorage();
  storageAvailable = result.available;
  state = result.state;
  emit();
}

/* ── mutations ──────────────────────────────────────────────────────── */

function commit(next: CartState): void {
  if (next === state) return;
  state = next;
  writeToStorage(next);
  emit();
}

export function addToCart(input: AddLineInput): void {
  commit(addLine(state, input));
}

export function setCartQuantity(lineKey: string, quantity: number): void {
  commit(adjustLine(state, lineKey, quantity));
}

export function removeFromCart(lineKey: string): void {
  commit(dropLine(state, lineKey));
}

export function clearWholeCart(): void {
  commit(resetCart());
}

/** Total units currently in the cart (used by the header badge). */
export function currentCartQuantity(): number {
  return cartQuantity(state);
}

/* ── cross-tab synchronisation ──────────────────────────────────────── */

/**
 * Keep every open tab showing the same cart.
 *
 * Browsers only fire `storage` in the OTHER tabs, so this listener applies the
 * incoming value directly instead of writing it back (which would ping-pong).
 */
export function startCartStorageSync(): () => void {
  if (typeof window === "undefined") return () => {};

  const onStorage = (event: StorageEvent): void => {
    if (event.key !== null && event.key !== CART_STORAGE_KEY) return;
    const result = readFromStorage();
    storageAvailable = result.available;
    if (result.state === state) return;
    state = result.state;
    emit();
  };

  window.addEventListener("storage", onStorage);
  return () => window.removeEventListener("storage", onStorage);
}
