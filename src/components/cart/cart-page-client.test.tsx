// @vitest-environment jsdom
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CART_STORAGE_KEY } from "@/lib/cart/limits";
import { readStoredCart, serializeCart } from "@/lib/cart/core";
import { clearWholeCart, hydrateCartStore, reloadCartStore } from "@/lib/cart/store";
import type { CartQuote, QuotedLine } from "@/lib/validations/cart";
import { renderWithCart } from "@/test/cart-harness";
import { CartPageClient } from "./cart-page-client";

/**
 * Reconciliation is mocked: these are DOM tests and the real action reaches
 * the catalogue. By default it answers "unavailable" (the honest failure
 * state); tests install a priced responder when they need figures.
 */
interface CatalogueStub {
  name: string;
  priceCents: number | null;
  issue?: QuotedLine["issue"];
}

const quoteMock = vi.hoisted(() => ({
  responder: null as null | ((slugs: string[]) => CartQuote),
}));

vi.mock("@/lib/actions/cart", () => ({
  quoteCartAction: vi.fn(async (request: { items: Array<{ slug: string }> }) => {
    const responder = quoteMock.responder;
    if (!responder) return { ok: false, reason: "unavailable" };
    return { ok: true, quote: responder(request.items.map((item) => item.slug)) };
  }),
}));

function quoteFrom(stubs: Record<string, CatalogueStub>) {
  return (slugs: string[]): CartQuote => {
    const lines: QuotedLine[] = slugs.map((slug) => {
      const stub = stubs[slug];
      const quantity =
        JSON.parse(window.localStorage.getItem(CART_STORAGE_KEY) ?? '{"items":[]}').items.find(
          (item: { slug: string }) => item.slug === slug,
        )?.quantity ?? 1;

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
          issue: "not_found" as const,
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

    return {
      lines,
      subtotalCents: lines.reduce((sum, line) => sum + (line.lineTotalCents ?? 0), 0),
      purchasableQuantity: lines.reduce((sum, line) => sum + (line.issue === null ? line.quantity : 0), 0),
      purchasableLineCount: lines.filter((line) => line.issue === null).length,
      hasIssues: lines.some((line) => line.issue !== null),
    };
  };
}

function seedCart(lines: Array<{ slug: string; quantity: number; unitPriceCents?: number | null }>): void {
  window.localStorage.setItem(
    CART_STORAGE_KEY,
    serializeCart({
      version: 1,
      items: lines.map((line) => ({ variantName: null, unitPriceCents: null, ...line })),
    }),
  );
  reloadCartStore();
}

beforeEach(() => {
  window.localStorage.clear();
  clearWholeCart();
  hydrateCartStore();
  quoteMock.responder = null;
});

describe("CartPageClient: empty state", () => {
  it("shows the honest empty state with a route back to the menu", () => {
    renderWithCart(<CartPageClient />);

    expect(screen.getByText(/Your cart is waiting for something delicious/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Explore the Menu/ })).toHaveAttribute("href", "/menu");
    expect(screen.queryByText(/\$0\.00/)).not.toBeInTheDocument();
  });

  it("offers no checkout action while there is nothing to check out", () => {
    renderWithCart(<CartPageClient />);

    expect(screen.queryByRole("link", { name: /Proceed to Checkout/ })).not.toBeInTheDocument();
  });
});

describe("CartPageClient: populated cart", () => {
  it("shows the item count and an order summary", async () => {
    quoteMock.responder = quoteFrom({
      "meat-pie": { name: "Meat Pie", priceCents: 500 },
      zobo: { name: "Zobo", priceCents: 300 },
    });
    seedCart([
      { slug: "meat-pie", quantity: 2 },
      { slug: "zobo", quantity: 1 },
    ]);
    renderWithCart(<CartPageClient />);

    await waitFor(() => expect(screen.getByText("3 items")).toBeInTheDocument());
    expect(screen.getByRole("heading", { name: "Order summary" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Return to the Menu/ })).toHaveAttribute("href", "/menu");
    expect(screen.getByRole("link", { name: /Continue shopping/ })).toHaveAttribute("href", "/menu");
  });

  it("uses singular wording for one item", async () => {
    seedCart([{ slug: "meat-pie", quantity: 1 }]);
    renderWithCart(<CartPageClient />);

    await waitFor(() => expect(screen.getByText("1 item")).toBeInTheDocument());
  });

  it("renders the server subtotal once the quote arrives", async () => {
    quoteMock.responder = quoteFrom({ "meat-pie": { name: "Meat Pie", priceCents: 500 } });
    seedCart([{ slug: "meat-pie", quantity: 2, unitPriceCents: 500 }]);
    renderWithCart(<CartPageClient />);

    await waitFor(() => expect(screen.getAllByText("$10.00 CAD").length).toBeGreaterThan(0));
  });

  it("offers a way to checkout once everything is resolvable", async () => {
    quoteMock.responder = quoteFrom({ "meat-pie": { name: "Meat Pie", priceCents: 500 } });
    seedCart([{ slug: "meat-pie", quantity: 1 }]);
    renderWithCart(<CartPageClient />);

    const checkout = await screen.findByRole("link", { name: /Proceed to Checkout/ });
    expect(checkout).toHaveAttribute("href", "/checkout");
    expect(checkout).not.toHaveAttribute("aria-disabled", "true");
  });
});

describe("CartPageClient: clear cart", () => {
  it("asks for confirmation before destroying the cart", async () => {
    const user = userEvent.setup();
    quoteMock.responder = quoteFrom({ "meat-pie": { name: "Meat Pie", priceCents: 500 } });
    seedCart([{ slug: "meat-pie", quantity: 1 }]);
    renderWithCart(<CartPageClient />);

    // Arming must not clear anything.
    await user.click(screen.getByRole("button", { name: /Clear cart/ }));
    expect(screen.getByRole("group", { name: "Confirm clearing your cart" })).toBeInTheDocument();
    expect(readStoredCart(window.localStorage.getItem(CART_STORAGE_KEY)).items).toHaveLength(1);

    // Cancelling leaves the cart untouched.
    await user.click(screen.getByRole("button", { name: "Keep my cart" }));
    expect(screen.queryByRole("group", { name: "Confirm clearing your cart" })).not.toBeInTheDocument();
    expect(readStoredCart(window.localStorage.getItem(CART_STORAGE_KEY)).items).toHaveLength(1);
  });

  it("clears the cart only after explicit confirmation", async () => {
    const user = userEvent.setup();
    quoteMock.responder = quoteFrom({ "meat-pie": { name: "Meat Pie", priceCents: 500 } });
    seedCart([{ slug: "meat-pie", quantity: 1 }]);
    renderWithCart(<CartPageClient />);

    await user.click(screen.getByRole("button", { name: /Clear cart/ }));
    await user.click(screen.getByRole("button", { name: "Yes, clear my cart" }));

    await waitFor(() =>
      expect(screen.getByText(/Your cart is waiting for something delicious/)).toBeInTheDocument(),
    );
    expect(readStoredCart(window.localStorage.getItem(CART_STORAGE_KEY)).items).toHaveLength(0);
  });
});

describe("CartPageClient: honest totals", () => {
  it("says prices could not be verified rather than showing a figure", async () => {
    seedCart([{ slug: "meat-pie", quantity: 2, unitPriceCents: 500 }]);
    renderWithCart(<CartPageClient />);

    await waitFor(() => expect(screen.getByText("We couldn't verify prices")).toBeInTheDocument());
    expect(screen.getByText(/Nothing has been ordered/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Try again/ })).toBeInTheDocument();
    expect(screen.queryByText(/\$10\.00/)).not.toBeInTheDocument();
    expect(screen.queryByText(/\$0\.00/)).not.toBeInTheDocument();
  });

  it("blocks checkout while an item needs attention", async () => {
    quoteMock.responder = quoteFrom({
      ghost: { name: "Ghost", priceCents: null, issue: "not_found" },
    });
    seedCart([{ slug: "ghost", quantity: 1 }]);
    renderWithCart(<CartPageClient />);

    // Wait for the quote to resolve: the link exists immediately, but only
    // the resolved issue can disable it.
    await screen.findByText(/Resolve the highlighted item to continue to checkout/);
    const checkout = screen.getByRole("link", { name: /Proceed to Checkout/ });
    expect(checkout).toHaveAttribute("aria-disabled", "true");
  });

  it("shows delivery and taxes as to be confirmed, never as zero or a total", async () => {
    quoteMock.responder = quoteFrom({ "meat-pie": { name: "Meat Pie", priceCents: 500 } });
    seedCart([{ slug: "meat-pie", quantity: 1 }]);
    renderWithCart(<CartPageClient />);

    await screen.findByRole("link", { name: /Proceed to Checkout/ });

    // The rows exist so the customer knows what is coming, but each says the
    // figure is not known yet.
    expect(screen.getByText("Delivery")).toBeInTheDocument();
    expect(screen.getByText("Estimated taxes")).toBeInTheDocument();
    expect(screen.getAllByText("To be confirmed").length).toBe(2);
    // No "total" is ever claimed: the subtotal is merchandise only.
    expect(screen.queryByText("Total")).not.toBeInTheDocument();
    expect(screen.queryByText(/\$0\.00/)).not.toBeInTheDocument();
  });
});
