import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Breadcrumbs } from "./breadcrumbs";

describe("Breadcrumbs", () => {
  const items = [
    { label: "Home", href: "/" },
    { label: "Menu", href: "/menu" },
    { label: "Traditional Foods", href: "/menu?category=traditional-foods" },
    { label: "Egusi Soup" },
  ];

  it("renders linked crumbs and marks the current page", () => {
    render(<Breadcrumbs items={items} />);

    const nav = screen.getByRole("navigation", { name: "Breadcrumb" });
    expect(nav).toBeInTheDocument();

    const home = screen.getByRole("link", { name: "Home" });
    expect(home).toHaveAttribute("href", "/");
    expect(screen.getByRole("link", { name: "Menu" })).toHaveAttribute("href", "/menu");

    const current = screen.getByText("Egusi Soup");
    expect(current).toHaveAttribute("aria-current", "page");
    // The current crumb is plain text, not a link.
    expect(screen.queryByRole("link", { name: "Egusi Soup" })).not.toBeInTheDocument();
  });

  it("keeps separators out of the accessibility tree", () => {
    const { container } = render(<Breadcrumbs items={items} />);
    const separators = container.querySelectorAll('[aria-hidden="true"]');
    expect(separators.length).toBe(3); // one between each crumb
  });

  it("supports a single crumb", () => {
    render(<Breadcrumbs items={[{ label: "Menu" }]} />);
    expect(screen.getByText("Menu")).toHaveAttribute("aria-current", "page");
  });
});
