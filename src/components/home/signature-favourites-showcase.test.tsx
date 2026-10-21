import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { products } from "@/data/products";
import type { Product } from "@/types";
import { SignatureFavouritesShowcase } from "./signature-favourites-showcase";

const featured: Product[] = products.filter(
  (product) => product.status === "published" && product.featured,
);

describe("SignatureFavouritesShowcase", () => {
  it("renders featured products plus the editorial closing tile", () => {
    render(<SignatureFavouritesShowcase featured={featured} total={11} state="ok" />);

    expect(screen.getByRole("heading", { name: "Egusi Soup" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Egusi Soup/ })).toHaveAttribute(
      "href",
      "/menu/egusi-soup",
    );
    expect(screen.getByText(/11 Nigerian favourites/)).toBeInTheDocument();
    expect(screen.getByText("Browse everything")).toBeInTheDocument();
  });

  it("presents an honest preparing state for an empty featured list", () => {
    render(<SignatureFavouritesShowcase featured={[]} total={0} state="ok" />);

    expect(screen.getByText("Signature favourites are being prepared")).toBeInTheDocument();
    expect(screen.queryByText(/Nigerian favourites/)).not.toBeInTheDocument();
    expect(screen.getByText("Browse the menu")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Egusi Soup" })).not.toBeInTheDocument();
  });

  it("shows a calm retry hint when the database failed", () => {
    render(<SignatureFavouritesShowcase featured={[]} total={null} state="error" />);

    expect(screen.getByText("We couldn’t load this section just now")).toBeInTheDocument();
    expect(screen.getByText("Browse the menu")).toBeInTheDocument();
    // No internal details ever surface.
    expect(screen.queryByText(/mongodb/i)).not.toBeInTheDocument();
  });

  it("never renders a draft product", () => {
    render(<SignatureFavouritesShowcase featured={featured} total={11} state="ok" />);
    expect(screen.queryByText("Preview Draft Item")).not.toBeInTheDocument();
  });
});
