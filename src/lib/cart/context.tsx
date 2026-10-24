"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { quoteCartAction } from "@/lib/actions/cart";
import { cartLineKey, cartQuantity, type AddLineInput, type CartState } from "./core";
import {
  addToCart,
  clearWholeCart,
  getCartSnapshot,
  getServerCartSnapshot,
  getServerHydratedSnapshot,
  getServerStorageSnapshot,
  hydrateCartStore,
  isCartHydrated,
  isCartStorageAvailable,
  removeFromCart,
  setCartQuantity,
  startCartStorageSync,
  subscribeToCart,
} from "./store";
import type { CartQuote, CartQuoteResponse, QuotedLine } from "@/lib/validations/cart";

/**
 * Cart context (Phase 4): cart state + authoritative price resolution.
 *
 * Two sources of truth, deliberately separated:
 *
 *  1. **The cart** — `{ slug, variantName, quantity }` lines held in
 *     `localStorage` and read with `useSyncExternalStore`. Mutating it is
 *     instant and synchronous, so a quantity tap never waits on the network.
 *  2. **The quote** — names, images, prices and totals, obtained from the
 *     server action and never persisted. These are what make a subtotal
 *     trustworthy.
 *
 * Reconciliation is coalesced: every cart change schedules ONE quote 200ms
 * later, and a monotonically increasing sequence number discards any response
 * that a newer request has already superseded. That is what stops a slow
 * older response from overwriting a newer cart state.
 */

export type QuoteStatus = "idle" | "loading" | "ready" | "error";

export interface CartLineView {
  key: string;
  slug: string;
  variantName: string | null;
  quantity: number;
  /** The price this customer last saw — a display hint, never authoritative. */
  seenUnitPriceCents: number | null;
  /** Server resolution; null while the first quote is still in flight. */
  quote: QuotedLine | null;
  /** The current catalogue price differs from what this customer last saw. */
  priceChanged: boolean;
}

export interface CartNotice {
  id: number;
  message: string;
}

export interface CartContextValue {
  state: CartState;
  /** True once the persisted cart has been read on the client. */
  hydrated: boolean;
  /** False when this browser could not read persisted cart data. */
  storageAvailable: boolean;
  /** Instant, local total across every line. */
  totalQuantity: number;
  lines: CartLineView[];
  /** null until at least one line has been resolved by the server. */
  subtotalCents: number | null;
  quote: CartQuote | null;
  quoteStatus: QuoteStatus;
  /** True when the cart changed after the last successful quote. */
  quoteStale: boolean;
  /** Transient confirmation shown after a successful add. */
  notice: CartNotice | null;
  add: (input: AddLineInput) => void;
  setQuantity: (key: string, quantity: number) => void;
  remove: (key: string) => void;
  clear: () => void;
  /** Manually retry a failed or stale quote. */
  refresh: () => void;
  dismissNotice: () => void;
}

const CartContext = createContext<CartContextValue | null>(null);

/** Debounce/coalescing window for reconciliation requests. */
const QUOTE_DEBOUNCE_MS = 200;
/** How long the "Added to your cart" confirmation stays on screen. */
const NOTICE_MS = 4_500;

interface QuoteState {
  quote: CartQuote | null;
  status: QuoteStatus;
  /** Item signature the current quote was produced for. */
  signature: string | null;
}

/** Stable, order-sensitive signature of the cart contents. */
function signatureOf(items: CartState["items"]): string {
  return items.map((item) => `${item.slug}|${item.variantName ?? ""}|${item.quantity}`).join(";");
}

function useCartQuote(state: CartState): {
  quoteState: QuoteState;
  refresh: () => void;
} {
  const [quoteState, setQuoteState] = useState<QuoteState>({
    quote: null,
    status: "idle",
    signature: null,
  });

  const sequence = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const runQuote = useCallback(async (items: CartState["items"]) => {
    const mySequence = ++sequence.current;

    if (items.length === 0) {
      setQuoteState({ quote: null, status: "idle", signature: null });
      return;
    }

    setQuoteState((previous) => ({ ...previous, status: "loading" }));

    try {
      const response: CartQuoteResponse = await quoteCartAction({
        items: items.map((item) => ({
          slug: item.slug,
          variantName: item.variantName,
          quantity: item.quantity,
        })),
      });

      // A newer request has already started: this response is stale, drop it.
      if (mySequence !== sequence.current) return;

      if (response.ok) {
        setQuoteState({ quote: response.quote, status: "ready", signature: signatureOf(items) });
      } else {
        setQuoteState((previous) => ({ ...previous, status: "error" }));
      }
    } catch {
      if (mySequence !== sequence.current) return;
      setQuoteState((previous) => ({ ...previous, status: "error" }));
    }
  }, []);

  // Coalesce: clear any pending call and schedule exactly one more, so a
  // burst of quantity taps produces a single request.
  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      timer.current = null;
      void runQuote(state.items);
    }, QUOTE_DEBOUNCE_MS);
    return () => {
      if (timer.current) {
        clearTimeout(timer.current);
        timer.current = null;
      }
    };
  }, [state, runQuote]);

  /** Manual retry: skip the debounce and quote the cart immediately. */
  const refresh = useCallback(() => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    void runQuote(state.items);
  }, [state.items, runQuote]);

  return { quoteState, refresh };
}

export function CartProvider({ children }: { children: ReactNode }) {
  const state = useSyncExternalStore(subscribeToCart, getCartSnapshot, getServerCartSnapshot);
  // Hydration and storage availability are external-store state too, so they
  // are read with useSyncExternalStore rather than mirrored into useState —
  // that keeps the first client paint identical to the server render.
  const hydrated = useSyncExternalStore(subscribeToCart, isCartHydrated, getServerHydratedSnapshot);
  const storageAvailable = useSyncExternalStore(
    subscribeToCart,
    isCartStorageAvailable,
    getServerStorageSnapshot,
  );
  const [notice, setNotice] = useState<CartNotice | null>(null);
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const noticeId = useRef(0);

  // Read the persisted cart once, after mount, and keep open tabs in sync.
  useEffect(() => {
    hydrateCartStore();
    return startCartStorageSync();
  }, []);

  const { quoteState, refresh } = useCartQuote(state);

  const dismissNotice = useCallback(() => {
    if (noticeTimer.current) clearTimeout(noticeTimer.current);
    noticeTimer.current = null;
    setNotice(null);
  }, []);

  const add = useCallback(
    (input: AddLineInput) => {
      const before = getCartSnapshot();
      addToCart(input);
      const after = getCartSnapshot();
      if (after === before) return; // limit reached or invalid slug: no change

      noticeId.current += 1;
      setNotice({ id: noticeId.current, message: "Added to your cart" });
      if (noticeTimer.current) clearTimeout(noticeTimer.current);
      noticeTimer.current = setTimeout(() => {
        noticeTimer.current = null;
        setNotice(null);
      }, NOTICE_MS);
    },
    [],
  );

  const setQuantity = useCallback((key: string, quantity: number) => {
    setCartQuantity(key, quantity);
  }, []);

  const remove = useCallback((key: string) => {
    removeFromCart(key);
  }, []);

  const clear = useCallback(() => {
    clearWholeCart();
  }, []);

  const value = useMemo<CartContextValue>(() => {
    const quoteByKey = new Map<string, QuotedLine>();
    for (const line of quoteState.quote?.lines ?? []) {
      quoteByKey.set(cartLineKey({ slug: line.slug, variantName: line.variantName }), line);
    }

    const lines: CartLineView[] = state.items.map((item) => {
      const key = cartLineKey(item);
      const quote = quoteByKey.get(key) ?? null;
      return {
        key,
        slug: item.slug,
        variantName: item.variantName,
        quantity: item.quantity,
        seenUnitPriceCents: item.unitPriceCents,
        quote,
        priceChanged:
          item.unitPriceCents !== null &&
          quote?.unitPriceCents != null &&
          item.unitPriceCents !== quote.unitPriceCents,
      };
    });

    let subtotalCents: number | null = null;
    for (const line of lines) {
      if (line.quote?.unitPriceCents == null) continue;
      subtotalCents = (subtotalCents ?? 0) + line.quote.unitPriceCents * line.quantity;
    }

    return {
      state,
      hydrated,
      storageAvailable,
      totalQuantity: cartQuantity(state),
      lines,
      subtotalCents,
      quote: quoteState.quote,
      quoteStatus: quoteState.status,
      quoteStale: quoteState.signature !== signatureOf(state.items),
      notice,
      add,
      setQuantity,
      remove,
      clear,
      refresh,
      dismissNotice,
    };
  }, [state, hydrated, storageAvailable, quoteState, notice, add, setQuantity, remove, clear, refresh, dismissNotice]);

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}

/** Access the cart. Throws when used outside the provider — a wiring bug. */
export function useCart(): CartContextValue {
  const context = useContext(CartContext);
  if (!context) throw new Error("useCart must be used inside <CartProvider>");
  return context;
}

/** Optional variant of `useCart` for components rendered outside the provider. */
export function useOptionalCart(): CartContextValue | null {
  return useContext(CartContext);
}
