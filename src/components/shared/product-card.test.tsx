import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { products } from "@/data/products";
import { renderWithCart } from "@/test/cart-harness";
import { ProductCard } from "./product-card";

const egusi = products.find((product) => product.slug === "egusi-soup")!;

describe("ProductCard", () => {
  it("links to the product detail page with name, category and description", () => {
    renderWithCart(<ProductCard product={egusi} />);

    const card = screen.getByRole("link", { name: /Egusi Soup/ });
    expect(card).toHaveAttribute("href", "/menu/egusi-soup");
    expect(screen.getByRole("heading", { name: "Egusi Soup" })).toBeInTheDocument();
    expect(screen.getByText("Traditional Foods")).toBeInTheDocument();
    expect(screen.getByText(/Ground melon seeds/)).toBeInTheDocument();
    expect(screen.getByText("View details")).toBeInTheDocument();
  });

  it("states the honest unconfigured-price state (never $0.00)", () => {
    renderWithCart(<ProductCard product={egusi} />);
    expect(screen.getByText("Price to be confirmed")).toBeInTheDocument();
    expect(screen.queryByText(/\$0\.00/)).not.toBeInTheDocument();
  });

  it("formats a configured price in CAD", () => {
    renderWithCart(<ProductCard product={{ ...egusi, priceCents: 1800 }} />);
    expect(screen.getByText("$18.00 CAD")).toBeInTheDocument();
    expect(screen.queryByText("Price to be confirmed")).not.toBeInTheDocument();
  });

  it("badges unavailable products", () => {
    renderWithCart(<ProductCard product={{ ...egusi, availability: "unavailable" }} />);
    expect(screen.getByText("Unavailable")).toBeInTheDocument();
  });

  it("badges Signature products", () => {
    renderWithCart(<ProductCard product={egusi} />);
    expect(screen.getByText("Signature")).toBeInTheDocument(); // egusi is featured
    renderWithCart(<ProductCard product={{ ...egusi, featured: false }} />);
    expect(screen.getAllByText("Signature")).toHaveLength(1);
  });

  it("shows the short description when configured", () => {
    renderWithCart(
      <ProductCard product={{ ...egusi, shortDescription: "A rich, nutty soup with leafy greens." }} />,
    );
    expect(screen.getByText("A rich, nutty soup with leafy greens.")).toBeInTheDocument();
  });

  it("offers quick add only for an available, priced product with no options", () => {
    renderWithCart(<ProductCard product={{ ...egusi, priceCents: 1800 }} />);
    expect(screen.getByRole("button", { name: /add egusi soup to cart/i })).toBeInTheDocument();
  });

  it("offers no purchase control when the product has options to choose", () => {
    renderWithCart(
      <ProductCard
        product={{
          ...egusi,
          priceCents: 1800,
          variants: [{ name: "Small", priceCents: 800 }],
        }}
      />,
    );
    // Options must be chosen on the detail page, never guessed from a card.
    expect(screen.queryByRole("button", { name: /add/i })).not.toBeInTheDocument();
  });

  it("offers no purchase control for an unavailable or unpriced product", () => {
    const { rerender } = renderWithCart(
      <ProductCard product={{ ...egusi, priceCents: null }} />,
    );
    expect(screen.queryByRole("button", { name: /add/i })).not.toBeInTheDocument();

    rerender(<ProductCard product={{ ...egusi, priceCents: 1800, availability: "unavailable" }} />);
    expect(screen.queryByRole("button", { name: /add/i })).not.toBeInTheDocument();
  });
});
