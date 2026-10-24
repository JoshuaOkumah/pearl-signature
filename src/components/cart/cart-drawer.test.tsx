// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createRef, useState, type RefObject } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CART_STORAGE_KEY } from "@/lib/cart/limits";
import { readStoredCart, serializeCart } from "@/lib/cart/core";
import { clearWholeCart, getCartSnapshot, hydrateCartStore, reloadCartStore } from "@/lib/cart/store";
import { CartProvider } from "@/lib/cart/context";
import type { CartQuote, QuotedLine } from "@/lib/validations/cart";
import { CartDrawer } from "./cart-drawer";

/**
 * The reconciliation action is mocked: these are DOM tests, and the real
 * action reaches the catalogue (fixtures or MongoDB). By default it answers
 * "unavailable", which is exactly how the drawer must behave when the
 * catalogue cannot be reached; a test can install a priced responder.
 */
interface QuoteResponder {
  (slugs: string[]): CartQuote;
}

const quoteMock = vi.hoisted(() => ({
  responder: null as null | QuoteResponder,
}));

vi.mock("@/lib/actions/cart", () => ({
  quoteCartAction: vi.fn(async (request: { items: Array<{ slug: string }> }) => {
    const responder = quoteMock.responder;
    if (!responder) return { ok: false, reason: "unavailable" };
    return { ok: true, quote: responder(request.items.map((item) => item.slug)) };
  }),
}));

/* ── quote helpers ──────────────────────────────────────────────────── */

interface CatalogueStub {
  name: string;
  priceCents: number | null;
  issue?: QuotedLine["issue"];
}

/**
 * Build a quote for whatever is currently in the cart, mirroring the server's
 * shape: purchasable lines get a name and a price, everything else gets an
 * honest issue and no price at all.
 */
function quoteFrom(stubs: Record<string, CatalogueStub>): QuoteResponder {
  return (slugs) => {
    const lines: QuotedLine[] = slugs.map((slug) => {
      const stub = stubs[slug];
      const quantity = getCartSnapshot().items.find((item) => item.slug === slug)?.quantity ?? 1;

      if (!stub) {
        return {
          slug,
          variantName: null,
          quantity,
          unitPriceCents: null,
          lineTotalCents: null,
          name: null,
          categorySlug: null,
          image: null,
          issue: "not_found",
        };
      }

      return {
        slug,
        variantName: null,
        quantity,
        unitPriceCents: stub.priceCents,
        lineTotalCents: stub.priceCents === null ? null : stub.priceCents * quantity,
        name: stub.name,
        categorySlug: "pastries-snacks",
        image: null,
        issue: stub.issue ?? null,
      };
    });

    const quote: CartQuote = {
      lines,
      subtotalCents: lines.reduce((sum, line) => sum + (line.lineTotalCents ?? 0), 0),
      purchasableQuantity: lines.reduce((sum, line) => sum + (line.issue === null ? line.quantity : 0), 0),
      purchasableLineCount: lines.filter((line) => line.issue === null).length,
      hasIssues: lines.some((line) => line.issue !== null),
    };
    return quote;
  };
}

/* ── harness ────────────────────────────────────────────────────────── */

interface SeedLine {
  slug: string;
  variantName?: string | null;
  quantity: number;
  unitPriceCents?: number | null;
}

/** Seed persisted cart data, then make the singleton see it. */
function seedCart(lines: SeedLine[]): void {
  window.localStorage.setItem(
    CART_STORAGE_KEY,
    serializeCart({
      version: 1,
      items: lines.map((line) => ({ variantName: null, unitPriceCents: null, ...line })),
    }),
  );
  reloadCartStore();
}

interface DrawerHarnessProps {
  onClose: () => void;
  triggerRef: RefObject<HTMLButtonElement | null>;
}

/**
 * Keeps `open` in state so a close actually closes. That matters: focus is
 * restored by the drawer's effect cleanup, which only runs when `open` flips
 * or the component unmounts.
 */
function DrawerHarness({ onClose, triggerRef }: DrawerHarnessProps) {
  const [open, setOpen] = useState(true);

  return (
    <>
      <button type="button" ref={triggerRef}>
        Cart
      </button>
      <CartDrawer
        open={open}
        onClose={() => {
          onClose();
          setOpen(false);
        }}
        triggerRef={triggerRef}
      />
    </>
  );
}

function renderDrawer(onClose: () => void = () => {}) {
  const triggerRef = createRef<HTMLButtonElement>();

  const utils = render(
    <CartProvider>
      <DrawerHarness onClose={onClose} triggerRef={triggerRef} />
    </CartProvider>,
  );

  return { ...utils, trigger: triggerRef.current! };
}

const getPanel = () => screen.queryByRole("dialog", { name: "Shopping cart" });
const closeControls = () => screen.getAllByRole("button", { name: "Close cart" });

beforeEach(() => {
  window.localStorage.clear();
  clearWholeCart();
  hydrateCartStore();
  quoteMock.responder = null;
});

afterEach(() => {
  document.body.style.overflow = "";
});

/* ── rendering ──────────────────────────────────────────────────────── */

describe("CartDrawer", () => {
  it("renders as a modal dialog mounted in the document body", () => {
    renderDrawer();

    const panel = getPanel();
    expect(panel).toBeInTheDocument();
    expect(panel).toHaveAttribute("aria-modal", "true");
    // Portalled out of the header: the sticky header's backdrop-filter would
    // otherwise become the containing block for the fixed panel.
    expect(panel!.parentElement?.parentElement).toBe(document.body);
  });

  it("shows an honest empty state with one clear way forward", () => {
    renderDrawer();

    expect(screen.getByText(/Your cart is waiting for something delicious/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Explore the Menu/ })).toHaveAttribute("href", "/menu");
    // No invented products, no fake recommendations.
    expect(screen.queryByText(/\$0\.00/)).not.toBeInTheDocument();
  });

  it("gives the customer a resolving placeholder until the server answers", async () => {
    seedCart([{ slug: "meat-pie", quantity: 2 }]);
    renderDrawer();

    // The stored price is only a "last seen" hint; the row never guesses a
    // name or a price from browser storage.
    await waitFor(() => expect(screen.getAllByText("Loading item").length).toBeGreaterThan(0));
    expect(screen.getAllByText("Checking").length).toBeGreaterThan(0);
    expect(screen.queryByText(/\$0\.00/)).not.toBeInTheDocument();
  });

  it("lists every line with its own controls once the quote arrives", async () => {
    quoteMock.responder = quoteFrom({
      "meat-pie": { name: "Meat Pie", priceCents: 500 },
      zobo: { name: "Zobo", priceCents: 300 },
    });
    seedCart([
      { slug: "meat-pie", quantity: 2 },
      { slug: "zobo", quantity: 1 },
    ]);
    renderDrawer();

    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Increase quantity of Meat Pie" })).toBeInTheDocument(),
    );
    expect(screen.getByRole("button", { name: "Increase quantity of Zobo" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Remove Meat Pie from your cart" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Meat Pie" })).toHaveAttribute("href", "/menu/meat-pie");
  });

  it("announces the item count in the header", async () => {
    seedCart([
      { slug: "meat-pie", quantity: 2 },
      { slug: "zobo", quantity: 1 },
    ]);
    renderDrawer();

    await waitFor(() => expect(screen.getByText("3 items")).toBeInTheDocument());
  });

  it("uses singular wording for one item", async () => {
    seedCart([{ slug: "meat-pie", quantity: 1 }]);
    renderDrawer();

    await waitFor(() => expect(screen.getByText("1 item")).toBeInTheDocument());
    expect(screen.queryByText("1 items")).not.toBeInTheDocument();
  });

  it("shows the selected option under the product name", async () => {
    quoteMock.responder = quoteFrom({ pack: { name: "Portion Pack", priceCents: 1400 } });
    seedCart([{ slug: "pack", variantName: "Large", quantity: 1 }]);
    renderDrawer();

    await waitFor(() => expect(screen.getByText("Option:")).toBeInTheDocument());
    expect(screen.getByText("Large")).toBeInTheDocument();
  });
});

/* ── modal behaviour ────────────────────────────────────────────────── */

describe("CartDrawer: modal behaviour", () => {
  it("moves focus to the panel's close button on open", () => {
    renderDrawer();

    // Two controls share the name (backdrop + header X); focus lands on the
    // visible X inside the panel.
    expect(within(getPanel()!).getByRole("button", { name: "Close cart" })).toHaveFocus();
  });

  it("locks body scroll and restores it on unmount", () => {
    const { unmount } = renderDrawer();
    expect(document.body.style.overflow).toBe("hidden");

    unmount();
    expect(document.body.style.overflow).toBe("");
  });

  it("closes on Escape and returns focus to the cart button", async () => {
    const onClose = vi.fn();
    const { trigger } = renderDrawer(onClose);

    fireEvent.keyDown(document, { key: "Escape" });

    expect(onClose).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(trigger).toHaveFocus());
  });

  it("provides a backdrop dismiss that does not fire from inside the panel", () => {
    const onClose = vi.fn();
    renderDrawer(onClose);

    // A click inside the panel must not reach the backdrop handler.
    fireEvent.click(getPanel()!);
    expect(onClose).not.toHaveBeenCalled();
  });

  it("closes when the backdrop is clicked", () => {
    const onClose = vi.fn();
    renderDrawer(onClose);

    // The backdrop is the first of the two "Close cart" controls in DOM order.
    fireEvent.click(closeControls()[0]);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("closes from the panel's X button", () => {
    const onClose = vi.fn();
    renderDrawer(onClose);

    fireEvent.click(within(getPanel()!).getByRole("button", { name: "Close cart" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("closes from Continue shopping, which only exists when there is a cart", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    quoteMock.responder = quoteFrom({ "meat-pie": { name: "Meat Pie", priceCents: 500 } });
    seedCart([{ slug: "meat-pie", quantity: 1 }]);
    renderDrawer(onClose);

    await waitFor(() => expect(screen.getByRole("button", { name: "Continue shopping" })).toBeInTheDocument());

    await user.click(screen.getByRole("button", { name: "Continue shopping" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("traps keyboard focus inside the panel", async () => {
    quoteMock.responder = quoteFrom({ "meat-pie": { name: "Meat Pie", priceCents: 500 } });
    seedCart([{ slug: "meat-pie", quantity: 1 }]);
    renderDrawer();

    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Increase quantity of Meat Pie" })).toBeInTheDocument(),
    );

    const panel = getPanel() as HTMLElement;
    const focusable = Array.from(panel.querySelectorAll<HTMLElement>('a[href], button:not([disabled])'));
    expect(focusable.length).toBeGreaterThan(0);

    // Shift+Tab on the first focusable wraps to the last one in the panel.
    focusable[0].focus();
    fireEvent.keyDown(document, { key: "Tab", shiftKey: true });
    expect(focusable[focusable.length - 1]).toHaveFocus();

    // Tab on the last wraps back to the first.
    fireEvent.keyDown(document, { key: "Tab" });
    expect(focusable[0]).toHaveFocus();
  });

  it("keeps both navigation actions pointing at their real pages", async () => {
    quoteMock.responder = quoteFrom({ "meat-pie": { name: "Meat Pie", priceCents: 500 } });
    seedCart([{ slug: "meat-pie", quantity: 1 }]);
    renderDrawer();

    const panel = getPanel()!;
    await waitFor(() =>
      expect(within(panel).getByRole("link", { name: /Proceed to Checkout/ })).toBeInTheDocument(),
    );

    expect(within(panel).getByRole("link", { name: /Proceed to Checkout/ })).toHaveAttribute("href", "/checkout");
    expect(within(panel).getByRole("link", { name: /View Cart/ })).toHaveAttribute("href", "/cart");
  });
});

/* ── line editing ───────────────────────────────────────────────────── */

describe("CartDrawer: editing lines", () => {
  it("increases a line quantity and persists it", async () => {
    const user = userEvent.setup();
    quoteMock.responder = quoteFrom({ "meat-pie": { name: "Meat Pie", priceCents: 500 } });
    seedCart([{ slug: "meat-pie", quantity: 2, unitPriceCents: 500 }]);
    renderDrawer();

    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Increase quantity of Meat Pie" })).toBeEnabled(),
    );
    await user.click(screen.getByRole("button", { name: "Increase quantity of Meat Pie" }));

    await waitFor(() =>
      expect(readStoredCart(window.localStorage.getItem(CART_STORAGE_KEY)).items[0].quantity).toBe(3),
    );
  });

  it("removes a line from the drawer", async () => {
    const user = userEvent.setup();
    quoteMock.responder = quoteFrom({ "meat-pie": { name: "Meat Pie", priceCents: 500 } });
    seedCart([{ slug: "meat-pie", quantity: 2 }]);
    renderDrawer();

    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Remove Meat Pie from your cart" })).toBeInTheDocument(),
    );
    await user.click(screen.getByRole("button", { name: "Remove Meat Pie from your cart" }));

    await waitFor(() =>
      expect(screen.queryByRole("button", { name: "Remove Meat Pie from your cart" })).not.toBeInTheDocument(),
    );
    expect(readStoredCart(window.localStorage.getItem(CART_STORAGE_KEY)).items).toHaveLength(0);
  });

  it("switches back to the empty state once the last line is removed", async () => {
    const user = userEvent.setup();
    quoteMock.responder = quoteFrom({ "meat-pie": { name: "Meat Pie", priceCents: 500 } });
    seedCart([{ slug: "meat-pie", quantity: 1 }]);
    renderDrawer();

    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Remove Meat Pie from your cart" })).toBeInTheDocument(),
    );
    await user.click(screen.getByRole("button", { name: "Remove Meat Pie from your cart" }));

    await waitFor(() =>
      expect(screen.getByText(/Your cart is waiting for something delicious/)).toBeInTheDocument(),
    );
  });
});

/* ── honest pricing states ──────────────────────────────────────────── */

describe("CartDrawer: pricing honesty", () => {
  it("never shows a subtotal before the server has priced the cart", async () => {
    seedCart([{ slug: "meat-pie", quantity: 2, unitPriceCents: 500 }]);
    renderDrawer();

    // The stored price is only a "last seen" hint; until the server action
    // answers, the drawer says so rather than trusting it.
    await waitFor(() => expect(screen.getByText("Updating…")).toBeInTheDocument());
    expect(screen.queryByText("$10.00 CAD")).not.toBeInTheDocument();
  });

  it("says prices could not be verified instead of inventing a total", async () => {
    seedCart([{ slug: "meat-pie", quantity: 2, unitPriceCents: 500 }]);
    renderDrawer();

    await waitFor(() => expect(screen.getByText("We couldn't verify prices")).toBeInTheDocument());
    expect(screen.getByRole("button", { name: /Try again/ })).toBeInTheDocument();
    expect(screen.queryByText(/\$0\.00/)).not.toBeInTheDocument();
  });

  it("renders a server-confirmed subtotal and shows both figures", async () => {
    quoteMock.responder = quoteFrom({ "meat-pie": { name: "Meat Pie", priceCents: 500 } });
    seedCart([{ slug: "meat-pie", quantity: 2, unitPriceCents: 500 }]);
    renderDrawer();

    // One figure per line, one in the footer.
    await waitFor(() => expect(screen.getAllByText("$10.00 CAD")).toHaveLength(2));
    expect(screen.queryByText("Updating…")).not.toBeInTheDocument();
    // No warning needed: the catalogue price matches what this customer saw.
    expect(screen.queryByText(/Price updated from/)).not.toBeInTheDocument();
  });

  it("warns when the catalogue price moved since the customer last saw it", async () => {
    quoteMock.responder = quoteFrom({ "meat-pie": { name: "Meat Pie", priceCents: 650 } });
    seedCart([{ slug: "meat-pie", quantity: 1, unitPriceCents: 500 }]);
    renderDrawer();

    await waitFor(() => expect(screen.getByText(/Price updated from/)).toBeInTheDocument());
    expect(screen.getByText(/\$5\.00 CAD to \$6\.50 CAD/)).toBeInTheDocument();
  });

  it("blocks checkout while an item still needs attention", async () => {
    quoteMock.responder = quoteFrom({ ghost: { name: "Ghost", priceCents: null, issue: "not_found" } });
    seedCart([{ slug: "ghost", quantity: 1 }]);
    renderDrawer();

    await waitFor(() =>
      expect(screen.getByText(/1 item needs your attention before checkout/)).toBeInTheDocument(),
    );
    expect(screen.getByText("No verified items")).toBeInTheDocument();

    // Checkout is withheld entirely rather than shown as a dead button.
    expect(screen.queryAllByRole("link", { name: /Proceed to Checkout/ })).toHaveLength(0);
    expect(screen.getByText("Proceed to Checkout")).toHaveAttribute("aria-disabled", "true");
    expect(screen.getByText("Resolve the highlighted items to continue.")).toBeInTheDocument();
  });

  it("says an unpriced item has no confirmed price rather than $0.00", async () => {
    quoteMock.responder = quoteFrom({ "meat-pie": { name: "Meat Pie", priceCents: null, issue: "unpriced" } });
    seedCart([{ slug: "meat-pie", quantity: 1 }]);
    renderDrawer();

    await waitFor(() => expect(screen.getByText("Price to be confirmed")).toBeInTheDocument());
    expect(screen.queryByText(/\$0\.00/)).not.toBeInTheDocument();
  });
});
