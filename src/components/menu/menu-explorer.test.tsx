import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { categories } from "@/data/categories";
import { products } from "@/data/products";
import type { CatalogueCategory } from "@/types";
import { MenuExplorer, pageWindow, type MenuExplorerProps } from "./menu-explorer";

const { push, replace } = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn() }));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, replace, refresh: vi.fn(), prefetch: vi.fn() }),
}));

const catalogueCategories: CatalogueCategory[] = categories.map((category, index) => ({
  slug: category.slug,
  name: category.name,
  description: category.description,
  sortOrder: index * 10,
}));

const published = products.filter((product) => product.status === "published");

const counts: Record<string, number> = {
  "traditional-foods": 4,
  "pastries-snacks": 5,
  drinks: 2,
};

function renderExplorer(overrides: Partial<MenuExplorerProps> = {}) {
  const props: MenuExplorerProps = {
    categories: catalogueCategories,
    counts,
    products: published,
    activeCategory: null,
    search: "",
    page: 1,
    pageSize: 12,
    total: 11,
    totalPages: 1,
    source: "fixtures",
    ...overrides,
  };
  const view = render(<MenuExplorer {...props} />);
  const rerender = (next: Partial<MenuExplorerProps> = {}) =>
    view.rerender(<MenuExplorer {...props} {...overrides} {...next} />);
  return { ...view, rerender, props };
}

afterEach(() => {
  vi.clearAllMocks();
  vi.useRealTimers();
});

describe("MenuExplorer rendering", () => {
  it("shows the full catalogue with counts and the preview badge", () => {
    renderExplorer();
    expect(screen.getByText("Showing all 11 dishes")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Egusi Soup" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Zobo" })).toBeInTheDocument();
    expect(screen.getByText("Preview catalogue")).toBeInTheDocument();

    // Chips carry published counts (draft excluded).
    expect(screen.getByRole("button", { name: /All/ })).toHaveTextContent("(11)");
    expect(screen.getByRole("button", { name: /Drinks/ })).toHaveTextContent("(2)");
    expect(screen.getByRole("button", { name: /Traditional/ })).toHaveTextContent("(4)");
  });

  it("labels configured prices with CAD and unconfigured ones honestly", () => {
    renderExplorer();
    // Fixtures carry no prices: every card says so instead of showing $0.00.
    expect(screen.getAllByText("Price to be confirmed").length).toBe(published.length);
    expect(screen.queryByText("$0.00 CAD")).not.toBeInTheDocument();

    renderExplorer({
      products: [{ ...published[0], priceCents: 1800 }],
      total: 1,
    });
    expect(screen.getAllByText("$18.00 CAD")).toHaveLength(1);
  });

  it("links each card to its detail page", () => {
    renderExplorer();
    const card = screen.getByRole("link", { name: /Egusi Soup/ });
    expect(card).toHaveAttribute("href", "/menu/egusi-soup");
  });

  it("omits the preview badge when reading the real database", () => {
    renderExplorer({ source: "database" });
    expect(screen.queryByText("Preview catalogue")).not.toBeInTheDocument();
  });

  it("summarises filtered views", () => {
    renderExplorer({
      activeCategory: "drinks",
      products: published.filter((product) => product.category === "drinks"),
      total: 2,
    });
    expect(screen.getByText("Showing 2 dishes in Drinks")).toBeInTheDocument();

    renderExplorer({ search: "egusi", products: [published[0]], total: 1 });
    expect(screen.getByText("Showing 1 dish for “egusi”")).toBeInTheDocument();
  });
});

describe("MenuExplorer navigation", () => {
  it("pushes category URLs that preserve the search term and page size", async () => {
    const user = userEvent.setup();
    const { rerender } = renderExplorer({ search: "pie", pageSize: 6, total: 3, totalPages: 1 });

    await user.click(screen.getByRole("button", { name: /Pastries/ }));
    expect(push).toHaveBeenCalledWith("/menu?category=pastries-snacks&search=pie&pageSize=6");

    // Server response arrives with the new URL state.
    rerender({ activeCategory: "pastries-snacks" });
    expect(screen.getByRole("button", { name: /Pastries/ })).toHaveAttribute("aria-pressed", "true");

    await user.click(screen.getByRole("button", { name: /^All/ }));
    expect(push).toHaveBeenLastCalledWith("/menu?search=pie&pageSize=6");
  });

  it("debounces live search into a single replace, preserving the category", () => {
    vi.useFakeTimers();
    renderExplorer({ activeCategory: "drinks" });

    const input = screen.getByRole("searchbox", { name: /Search dishes by name/i });
    fireEvent.change(input, { target: { value: "e" } });
    fireEvent.change(input, { target: { value: "eg" } });
    fireEvent.change(input, { target: { value: "egusi" } });

    expect(replace).not.toHaveBeenCalled();
    act(() => {
      vi.advanceTimersByTime(350);
    });
    expect(replace).toHaveBeenCalledTimes(1);
    expect(replace).toHaveBeenCalledWith("/menu?category=drinks&search=egusi");

    // No duplicate navigation while the URL is still catching up.
    act(() => {
      vi.advanceTimersByTime(350);
    });
    expect(replace).toHaveBeenCalledTimes(1);
  });

  it("commits the search immediately on Enter", () => {
    vi.useFakeTimers();
    renderExplorer();

    const input = screen.getByRole("searchbox", { name: /Search dishes by name/i });
    fireEvent.change(input, { target: { value: "zobo" } });
    fireEvent.submit(input.closest("form")!);

    expect(replace).toHaveBeenCalledWith("/menu?search=zobo");
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(replace).toHaveBeenCalledTimes(1); // debounce became a no-op
  });

  it("resynchronises the input when the URL changes from Back/Forward", () => {
    vi.useFakeTimers();
    const { rerender } = renderExplorer({ search: "egusi" });
    const input = () => screen.getByRole("searchbox", { name: /Search dishes by name/i }) as HTMLInputElement;
    expect(input().value).toBe("egusi");

    fireEvent.change(input(), { target: { value: "egus" } });
    rerender({ search: "meat" }); // history navigation lands elsewhere
    expect(input().value).toBe("meat");
    expect(replace).not.toHaveBeenCalled(); // no navigation loop from the resync
  });
});

describe("MenuExplorer search interaction (Phase 2B)", () => {
  it("offers a clear control only while the input has text", async () => {
    const user = userEvent.setup();
    renderExplorer({ activeCategory: "drinks", search: "zobo" });
    // A committed search shows the clear control immediately.
    const clear = screen.getByRole("button", { name: "Clear search" });

    await user.click(clear);
    // Clearing restores the catalogue within the selected category, at once.
    expect(replace).toHaveBeenCalledWith("/menu?category=drinks");
    expect((screen.getByRole("searchbox") as HTMLInputElement).value).toBe("");
    expect(screen.queryByRole("button", { name: "Clear search" })).not.toBeInTheDocument();
  });

  it("clears uncommitted typing without navigating (no redundant request)", () => {
    vi.useFakeTimers();
    renderExplorer();

    const input = screen.getByRole("searchbox", { name: /Search dishes by name/i });
    fireEvent.change(input, { target: { value: "zobo" } }); // debounce pending
    fireEvent.click(screen.getByRole("button", { name: "Clear search" }));
    act(() => {
      vi.advanceTimersByTime(1000); // the pending debounce was cancelled by the cleanup
    });

    expect(replace).not.toHaveBeenCalled(); // the URL never changed, so nothing to reset
    expect((screen.getByRole("searchbox") as HTMLInputElement).value).toBe("");
    expect(screen.queryByRole("button", { name: "Clear search" })).not.toBeInTheDocument();
  });

  it("trims surrounding whitespace so identical searches never re-fetch", () => {
    vi.useFakeTimers();
    renderExplorer();

    const input = screen.getByRole("searchbox", { name: /Search dishes by name/i });
    fireEvent.change(input, { target: { value: "  pie  " } });
    act(() => {
      vi.advanceTimersByTime(350);
    });
    expect(replace).toHaveBeenCalledTimes(1);
    expect(replace).toHaveBeenCalledWith("/menu?search=pie");

    // The committed term equals the trimmed draft: the debounce is a no-op.
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(replace).toHaveBeenCalledTimes(1);
  });

  it("ignores re-selecting the active category chip", async () => {
    const user = userEvent.setup();
    renderExplorer({ activeCategory: "drinks" });
    await user.click(screen.getByRole("button", { name: /Drinks/ }));
    expect(push).not.toHaveBeenCalled();
  });

  it("describes the name-only search in the accessible label and placeholder", () => {
    renderExplorer();
    const input = screen.getByRole("searchbox", { name: "Search dishes by name" });
    expect(input).toHaveAttribute("placeholder", "Search by dish name");
  });

  it("echoes the query in the no-results state", () => {
    renderExplorer({ search: "f", products: [], total: 0 });
    expect(
      screen.getByText(
        "We couldn’t find any dishes matching “f”. Check the spelling, or clear the search to see the full menu.",
      ),
    ).toBeInTheDocument();
  });
});

describe("MenuExplorer pagination", () => {
  it("hides pagination on a single page", () => {
    renderExplorer({ totalPages: 1, page: 1 });
    expect(screen.queryByRole("navigation", { name: "Pagination" })).not.toBeInTheDocument();
  });

  it("renders bounded controls with hrefs that preserve filters", () => {
    renderExplorer({ activeCategory: "drinks", search: "puff", pageSize: 6, page: 2, totalPages: 3 });

    const nav = screen.getByRole("navigation", { name: "Pagination" });
    const previous = screen.getByText("← Previous").closest("a, span")!;
    expect(previous.tagName).toBe("A"); // page 2 has a previous page
    expect(previous).toHaveAttribute(
      "href",
      "/menu?category=drinks&search=puff&pageSize=6",
    );

    expect(screen.getByRole("link", { name: "Next →" })).toHaveAttribute(
      "href",
      "/menu?category=drinks&search=puff&page=3&pageSize=6",
    );
    const current = screen.getByRole("link", { name: "2" });
    expect(current).toHaveAttribute("aria-current", "page");
    expect(current).toHaveAttribute(
      "href",
      "/menu?category=drinks&search=puff&page=2&pageSize=6",
    );
    expect(nav).toBeInTheDocument();
  });

  it("disables Previous on the first page", () => {
    renderExplorer({ page: 1, totalPages: 3 });
    const previous = screen.getByText("← Previous").closest("a, span")!;
    expect(previous.tagName).toBe("SPAN");
    expect(previous).toHaveAttribute("aria-disabled", "true");
    expect(screen.getByRole("link", { name: "Next →" })).toHaveAttribute("href", "/menu?page=2");
  });

  it("exposes a bounded page window", () => {
    expect(pageWindow(1, 3)).toEqual([1, 2, 3]);
    expect(pageWindow(5, 10)).toEqual([1, "gap", 4, 5, 6, "gap", 10]);
    expect(pageWindow(1, 10)).toEqual([1, 2, "gap", 10]);
    expect(pageWindow(10, 10)).toEqual([1, "gap", 9, 10]);
  });
});

describe("MenuExplorer states", () => {
  it("shows the empty state with a working reset", async () => {
    const user = userEvent.setup();
    renderExplorer({ search: "nothing-matches", products: [], total: 0 });

    expect(screen.getByText("Nothing here yet")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "View everything" }));
    expect(push).toHaveBeenCalledWith("/menu");
  });

  it("shows the preparing state when the catalogue is empty", () => {
    renderExplorer({ products: [], total: 0 });
    expect(screen.getByText("The menu is being prepared")).toBeInTheDocument();
  });

  it("shows the past-end state and a route back", async () => {
    const user = userEvent.setup();
    renderExplorer({ activeCategory: "drinks", page: 9, totalPages: 2, total: 11 });

    expect(screen.getByText("That’s the end of the menu")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Back to the first page" }));
    expect(push).toHaveBeenCalledWith("/menu?category=drinks");
  });
});
