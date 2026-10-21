import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { Header } from "./header";

vi.mock("next/navigation", () => ({
  usePathname: () => "/",
}));

describe("Header — mobile navigation", () => {
  it("keeps the menu closed initially", () => {
    render(<Header />);
    expect(screen.queryByRole("navigation", { name: "Mobile" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Open menu" })).toHaveAttribute("aria-expanded", "false");
  });

  it("opens on trigger, moves focus into the menu, and closes on Escape returning focus", async () => {
    const user = userEvent.setup();
    render(<Header />);

    const trigger = screen.getByRole("button", { name: "Open menu" });
    await user.click(trigger);

    const nav = screen.getByRole("navigation", { name: "Mobile" });
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    expect(within(nav).getByRole("link", { name: /^home\b/i })).toHaveFocus();

    fireEvent.keyDown(document, { key: "Escape" });

    await waitFor(() => expect(screen.queryByRole("navigation", { name: "Mobile" })).not.toBeInTheDocument());
    expect(trigger).toHaveFocus();
  });

  it("closes when a navigation link is selected", async () => {
    const user = userEvent.setup();
    render(<Header />);

    await user.click(screen.getByRole("button", { name: "Open menu" }));
    const nav = screen.getByRole("navigation", { name: "Mobile" });
    await user.click(within(nav).getByRole("link", { name: /^menu\b/i }));

    await waitFor(() => expect(screen.queryByRole("navigation", { name: "Mobile" })).not.toBeInTheDocument());
  });

  it("exposes a working desktop navigation", () => {
    render(<Header />);
    const primary = screen.getByRole("navigation", { name: "Primary" });
    expect(within(primary).getByRole("link", { name: "Menu" })).toHaveAttribute("href", "/menu");
    expect(within(primary).getByRole("link", { name: "Home" })).toHaveAttribute("aria-current", "page");
  });
});
