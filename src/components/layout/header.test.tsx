import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { Header } from "./header";

vi.mock("next/navigation", () => ({
  usePathname: () => "/",
}));

const getDialog = () => screen.queryByRole("dialog", { name: "Site navigation" });

describe("Header, mobile navigation", () => {
  it("keeps the menu closed initially", () => {
    render(<Header />);
    expect(getDialog()).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Open menu" })).toHaveAttribute("aria-expanded", "false");
  });

  it("opens on trigger, shows the dialog with a visible X, moves focus to X, and locks body scroll", async () => {
    const user = userEvent.setup();
    render(<Header />);

    const trigger = screen.getByRole("button", { name: "Open menu" });
    await user.click(trigger);

    const dialog = getDialog();
    expect(dialog).toBeInTheDocument();
    expect(trigger).toHaveAttribute("aria-expanded", "true");

    const closeButton = within(dialog!).getByRole("button", { name: "Close menu" });
    expect(closeButton).toHaveFocus();

    const nav = within(dialog!).getByRole("navigation", { name: "Mobile" });
    expect(within(nav).getByRole("link", { name: /^home\b/i })).toBeInTheDocument();
    expect(document.body.style.overflow).toBe("hidden");
  });

  it("closes via the X button and returns focus to the trigger", async () => {
    const user = userEvent.setup();
    render(<Header />);

    const trigger = screen.getByRole("button", { name: "Open menu" });
    await user.click(trigger);
    const closeButton = within(getDialog()!).getByRole("button", { name: "Close menu" });
    await user.click(closeButton);

    await waitFor(() => expect(getDialog()).not.toBeInTheDocument());
    expect(trigger).toHaveFocus();
    expect(document.body.style.overflow).toBe("");
  });

  it("closes on Escape and returns focus to the trigger", async () => {
    const user = userEvent.setup();
    render(<Header />);

    const trigger = screen.getByRole("button", { name: "Open menu" });
    await user.click(trigger);

    fireEvent.keyDown(document, { key: "Escape" });

    await waitFor(() => expect(getDialog()).not.toBeInTheDocument());
    expect(trigger).toHaveFocus();
    expect(document.body.style.overflow).toBe("");
  });

  it("closes when a navigation link is selected", async () => {
    const user = userEvent.setup();
    render(<Header />);

    await user.click(screen.getByRole("button", { name: "Open menu" }));
    const nav = within(getDialog()!).getByRole("navigation", { name: "Mobile" });
    await user.click(within(nav).getByRole("link", { name: /^menu\b/i }));

    await waitFor(() => expect(getDialog()).not.toBeInTheDocument());
  });

  it("traps keyboard focus inside the panel (Tab at boundaries wraps)", async () => {
    const user = userEvent.setup();
    render(<Header />);

    await user.click(screen.getByRole("button", { name: "Open menu" }));
    const dialog = getDialog()!;

    // DOM order: wordmark, X, links, CTA. Boundaries wrap:
    // Tab on the last focusable (CTA link) wraps to the first (wordmark).
    const cta = within(dialog).getByRole("link", { name: /explore the menu/i });
    const wordmark = within(dialog).getByRole("link", { name: /pearl signature/i });
    cta.focus();
    expect(cta).toHaveFocus();
    fireEvent.keyDown(document, { key: "Tab" });
    expect(wordmark).toHaveFocus();

    // Shift+Tab on the first focusable wraps to the last.
    fireEvent.keyDown(document, { key: "Tab", shiftKey: true });
    expect(cta).toHaveFocus();
  });

  it("survives repeated opening and closing", async () => {
    const user = userEvent.setup();
    render(<Header />);

    for (let round = 0; round < 3; round += 1) {
      await user.click(screen.getByRole("button", { name: "Open menu" }));
      expect(getDialog()).toBeInTheDocument();
      await user.click(within(getDialog()!).getByRole("button", { name: "Close menu" }));
      await waitFor(() => expect(getDialog()).not.toBeInTheDocument());
    }
  });

  it("exposes a working desktop navigation", () => {
    render(<Header />);
    const primary = screen.getByRole("navigation", { name: "Primary" });
    expect(within(primary).getByRole("link", { name: "Menu" })).toHaveAttribute("href", "/menu");
    expect(within(primary).getByRole("link", { name: "Home" })).toHaveAttribute("aria-current", "page");
  });
});
