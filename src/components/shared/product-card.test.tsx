import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { products } from "@/data/products";
import { ProductCard } from "./product-card";

const egusi = products.find((product) => product.slug === "egusi-soup")!;

describe("ProductCard", () => {
  it("links to the product detail page with name, category and description", () => {
    render(<ProductCard product={egusi} />);

    const card = screen.getByRole("link", { name: /Egusi Soup/ });
    expect(card).toHaveAttribute("href", "/menu/egusi-soup");
    expect(screen.getByRole("heading", { name: "Egusi Soup" })).toBeInTheDocument();
    expect(screen.getByText("Traditional Foods")).toBeInTheDocument();
    expect(screen.getByText(/Ground melon seeds/)).toBeInTheDocument();
    expect(screen.getByText("View details")).toBeInTheDocument();
  });

  it("states the honest unconfigured-price state (never $0.00)", () => {
    render(<ProductCard product={egusi} />);
    expect(screen.getByText("Price to be confirmed")).toBeInTheDocument();
    expect(screen.queryByText(/\$0\.00/)).not.toBeInTheDocument();
  });

  it("formats a configured price in CAD", () => {
    render(<ProductCard product={{ ...egusi, priceCents: 1800 }} />);
    expect(screen.getByText("$18.00 CAD")).toBeInTheDocument();
    expect(screen.queryByText("Price to be confirmed")).not.toBeInTheDocument();
  });

  it("badges unavailable products", () => {
    render(<ProductCard product={{ ...egusi, availability: "unavailable" }} />);
    expect(screen.getByText("Unavailable")).toBeInTheDocument();
  });

  it("badges Signature products", () => {
    render(<ProductCard product={egusi} />);
    expect(screen.getByText("Signature")).toBeInTheDocument(); // egusi is featured
    render(<ProductCard product={{ ...egusi, featured: false }} />);
    expect(screen.getAllByText("Signature")).toHaveLength(1);
  });

  it("shows the short description when configured", () => {
    render(
      <ProductCard product={{ ...egusi, shortDescription: "A rich, nutty soup with leafy greens." }} />,
    );
    expect(screen.getByText("A rich, nutty soup with leafy greens.")).toBeInTheDocument();
  });
});
