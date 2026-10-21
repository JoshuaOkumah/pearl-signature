import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { categories } from "@/data/categories";
import { products } from "@/data/products";
import { MenuExplorer } from "./menu-explorer";

describe("MenuExplorer", () => {
  it("shows every dish by default", () => {
    render(<MenuExplorer products={products} categories={categories} />);
    expect(screen.getByText(`Showing all ${products.length} dishes`)).toBeInTheDocument();
    expect(screen.getByText("Egusi Soup")).toBeInTheDocument();
    expect(screen.getByText("Zobo")).toBeInTheDocument();
  });

  it("filters the grid when a category chip is selected", async () => {
    const user = userEvent.setup();
    render(<MenuExplorer products={products} categories={categories} />);

    const drinksChip = screen.getByRole("button", { name: /drinks/i });
    await user.click(drinksChip);

    expect(drinksChip).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText("Showing 2 dishes")).toBeInTheDocument();
    expect(screen.getByText("Zobo")).toBeInTheDocument();
    expect(screen.getByText("Soya Milk")).toBeInTheDocument();

    // Dishes from other categories leave once the exit animation settles.
    await waitFor(() => expect(screen.queryByText("Egusi Soup")).not.toBeInTheDocument());
  });

  it("returns to the full list from the 'All' chip", async () => {
    const user = userEvent.setup();
    render(<MenuExplorer products={products} categories={categories} />);

    await user.click(screen.getByRole("button", { name: /drinks/i }));
    await user.click(screen.getByRole("button", { name: /^All/i }));

    expect(screen.getByText(`Showing all ${products.length} dishes`)).toBeInTheDocument();
  });

  it("honours an initial filter", () => {
    render(<MenuExplorer initialFilter="pastries-snacks" products={products} categories={categories} />);
    expect(screen.getByText("Meat Pie")).toBeInTheDocument();
    expect(screen.queryByText("Zobo")).not.toBeInTheDocument();
  });

  it("shows an empty state with a working reset", async () => {
    const user = userEvent.setup();
    const drinksOnly = products.filter((product) => product.category === "drinks");
    render(<MenuExplorer products={drinksOnly} categories={categories} />);

    await user.click(screen.getByRole("button", { name: /traditional foods/i }));
    expect(screen.getByText("Nothing here yet")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /view everything/i }));
    expect(screen.queryByText("Nothing here yet")).not.toBeInTheDocument();
    expect(screen.getByText("Zobo")).toBeInTheDocument();
  });
});
