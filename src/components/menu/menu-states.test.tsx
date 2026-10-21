import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { CatalogueUnavailable, MenuEmpty, MenuPastEnd, MenuPreparing } from "./menu-states";

const { refresh } = vi.hoisted(() => ({ refresh: vi.fn() }));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh, prefetch: vi.fn() }),
}));

describe("MenuPreparing", () => {
  it("explains an empty published catalogue without claiming products", () => {
    render(<MenuPreparing />);
    expect(screen.getByText("The menu is being prepared")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Back to home" })).toHaveAttribute("href", "/");
  });
});

describe("MenuEmpty", () => {
  it("offers a reset", async () => {
    const user = userEvent.setup();
    const onReset = vi.fn();
    render(<MenuEmpty onReset={onReset} />);

    expect(screen.getByText("Nothing here yet")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "View everything" }));
    expect(onReset).toHaveBeenCalledTimes(1);
  });
});

describe("MenuPastEnd", () => {
  it("explains the page position and offers a way back", async () => {
    const user = userEvent.setup();
    const onReset = vi.fn();
    render(<MenuPastEnd page={7} onReset={onReset} />);

    expect(screen.getByText(/Page 7 is past the last page/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Back to the first page" }));
    expect(onReset).toHaveBeenCalledTimes(1);
  });
});

describe("CatalogueUnavailable", () => {
  it("retries through the router without exposing internals", async () => {
    const user = userEvent.setup();
    render(<CatalogueUnavailable />);

    expect(screen.getByText("The menu is temporarily unavailable")).toBeInTheDocument();
    expect(screen.queryByText(/mongodb/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/MONGODB_URI/i)).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(refresh).toHaveBeenCalledTimes(1);
  });
});
