import { expect, test } from "@playwright/test";

/**
 * Phase 2 catalogue suite: menu filtering, shareable URL state, server-side
 * pagination, product detail pages, draft protection, honest pricing, SEO and
 * 404 behaviour. Phase 2B adds the title-first search relevance matrix.
 *
 * Runs against a production build resolving the labelled preview fixtures
 * (no cloud credentials in CI). The same visibility rules apply to database
 * reads (unit-tested in src/lib/repositories/catalogue.test.ts).
 */

test.describe("PEARL Signature — catalogue", () => {
  /* ── menu listing ──────────────────────────────────────────────────── */

  test("menu lists products with cards that open detail pages", async ({ page }) => {
    await page.goto("/menu");

    await expect(page.getByRole("heading", { level: 1 })).toContainText("Explore the PEARL Signature menu");
    await expect(page.getByText("Showing all 11 dishes")).toBeVisible();

    // Cards link to detail pages, not to a fake cart.
    const egusiCard = page.getByRole("link", { name: /Egusi Soup/ });
    await expect(egusiCard).toHaveAttribute("href", "/menu/egusi-soup");
    await expect(page.getByText("Price to be confirmed").first()).toBeVisible();
    await expect(page.getByText("Add to cart")).toHaveCount(0);
    await expect(page.getByText("Buy now")).toHaveCount(0);

    // Preview fixtures are labelled, not presented as live inventory.
    await expect(page.getByText("Preview catalogue")).toBeVisible();

    // The unpublished record never exists publicly.
    await expect(page.getByText("Preview Draft Item")).toHaveCount(0);

    await egusiCard.click();
    // Generous timeout: the dev server compiles the detail route lazily on
    // first navigation.
    await expect(page).toHaveURL("/menu/egusi-soup", { timeout: 15_000 });
    await expect(page.getByRole("heading", { level: 1, name: "Egusi Soup" })).toBeVisible();
  });

  test("category chips filter through shareable URLs", async ({ page }) => {
    await page.goto("/menu");

    await page.getByRole("button", { name: /Drinks/ }).click();
    await expect(page).toHaveURL("/menu?category=drinks");
    await expect(page.getByRole("button", { name: /Drinks/ })).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByText("Showing 2 dishes in Drinks")).toBeVisible();
    await expect(page.getByText("Egusi Soup")).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "Zobo" })).toBeVisible();

    // Back returns to the unfiltered menu.
    await page.goBack();
    await expect(page).toHaveURL("/menu");
    await expect(page.getByRole("heading", { name: "Egusi Soup" })).toBeVisible();

    // Forward restores the filtered view.
    await page.goForward();
    await expect(page).toHaveURL("/menu?category=drinks");
    await expect(page.getByRole("heading", { name: "Zobo" })).toBeVisible();
  });

  test("search filters the catalogue and keeps the category", async ({ page }) => {
    await page.goto("/menu?category=pastries-snacks");

    const search = page.getByRole("searchbox", { name: /Search dishes by name/i });
    await search.fill("egg");

    await expect(page).toHaveURL("/menu?category=pastries-snacks&search=egg");
    await expect(page.getByText("Showing 1 dish for “egg” in Pastries & Snacks")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Egg Roll" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Shawarma" })).toHaveCount(0);

    // Clearing the search restores the full category view.
    await search.fill("");
    await expect(page).toHaveURL("/menu?category=pastries-snacks");
    await expect(page.getByText("Showing 5 dishes in Pastries & Snacks")).toBeVisible();
  });

  /* ── title-first search relevance (Phase 2B) ───────────────────────── */

  test("single-letter search matches only names starting with that letter", async ({ page }) => {
    await page.goto("/menu");

    const search = page.getByRole("searchbox", { name: /Search dishes by name/i });
    await search.fill("f");

    await expect(page).toHaveURL("/menu?search=f");
    // No dish name starts with "f". Egusi Soup's description contains
    // "favourite", but descriptions are never searched.
    await expect(page.getByText("Nothing here yet")).toBeVisible();
    await expect(page.getByText(/matching “f”/)).toBeVisible();
    await expect(page.locator('h3 > a[href^="/menu/"]')).toHaveCount(0);

    // A longer prefix query finds the soups.
    await search.fill("sou");
    await expect(page).toHaveURL("/menu?search=sou");
    await expect(page.getByText("Showing 3 dishes for “sou”")).toBeVisible();
    await expect(page.locator('h3 > a[href^="/menu/"]')).toHaveText([
      "Egusi Soup",
      "Bitterleaf Soup",
      "Vegetable Soup",
    ]);
  });

  test("search ranks word-prefix matches in a stable, deterministic order", async ({ page }) => {
    await page.goto("/menu?search=pie");

    await expect(page.getByText("Showing 3 dishes for “pie”")).toBeVisible();
    // Every card is a pie; ordered by catalogue sort order, never by luck.
    const cards = page.locator('h3 > a[href^="/menu/"]');
    await expect(cards).toHaveText(["Turkey Pie", "Meat Pie", "Chicken Pie"]);
    await expect(page.getByRole("heading", { name: "Egusi Soup" })).toHaveCount(0);

    // Shareable URL: reloading returns the identical slice.
    await page.reload();
    await expect(cards).toHaveText(["Turkey Pie", "Meat Pie", "Chicken Pie"]);
  });

  test("the clear control restores the catalogue within the category", async ({ page }) => {
    await page.goto("/menu?category=pastries-snacks&search=pie");
    await expect(page.getByText("Showing 3 dishes for “pie” in Pastries & Snacks")).toBeVisible();

    await page.getByRole("button", { name: "Clear search" }).click();
    await expect(page).toHaveURL("/menu?category=pastries-snacks");
    await expect(page.getByText("Showing 5 dishes in Pastries & Snacks")).toBeVisible();
    await expect(page.getByRole("button", { name: "Clear search" })).toHaveCount(0);
  });

  test("search paginates after ranking, without duplicates across pages", async ({ page }) => {
    await page.goto("/menu?search=pie&pageSize=2");
    const cards = page.locator('h3 > a[href^="/menu/"]');
    await expect(cards).toHaveText(["Turkey Pie", "Meat Pie"]);

    await page
      .getByRole("navigation", { name: "Pagination" })
      .getByRole("link", { name: "Next →" })
      .click();
    await expect(page).toHaveURL("/menu?search=pie&page=2&pageSize=2");
    await expect(cards).toHaveText(["Chicken Pie"]);
    // Nothing from page 1 leaks into page 2.
    await expect(page.getByRole("heading", { name: "Turkey Pie" })).toHaveCount(0);
  });

  test("rapid typing settles on the final query with current results", async ({ page }) => {
    await page.goto("/menu");

    const search = page.getByRole("searchbox", { name: /Search dishes by name/i });
    await search.click();
    await search.pressSequentially("pie", { delay: 60 });

    await expect(page).toHaveURL("/menu?search=pie");
    await expect(page.getByText("Showing 3 dishes for “pie”")).toBeVisible();
    await expect(page.locator('h3 > a[href^="/menu/"]')).toHaveText([
      "Turkey Pie",
      "Meat Pie",
      "Chicken Pie",
    ]);
  });

  test("empty results offer a reset", async ({ page }) => {
    await page.goto("/menu?search=zzzz-nothing-matches");

    await expect(page.getByText("Nothing here yet")).toBeVisible();
    await page.getByRole("button", { name: "View everything" }).click();
    await expect(page).toHaveURL("/menu");
    await expect(page.getByText("Showing all 11 dishes")).toBeVisible();
  });

  test("server-side pagination navigates real pages", async ({ page }) => {
    await page.goto("/menu?pageSize=4");

    // First page: earliest four products by sortOrder.
    await expect(page.getByRole("heading", { name: "Egusi Soup" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Zobo" })).toHaveCount(0);
    const pagination = page.getByRole("navigation", { name: "Pagination" });
    await expect(pagination).toBeVisible();

    await pagination.getByRole("link", { name: "Next →" }).click();
    await expect(page).toHaveURL("/menu?page=2&pageSize=4");
    await expect(page.getByRole("heading", { name: "Shawarma" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Egusi Soup" })).toHaveCount(0);

    // Deep links beyond the end show an honest past-end state.
    await page.goto("/menu?pageSize=4&page=99");
    await expect(page.getByText("That’s the end of the menu")).toBeVisible();
  });

  test("a malformed page parameter falls back instead of crashing", async ({ page }) => {
    await page.goto("/menu?page=banana");
    await expect(page.getByText("Showing all 11 dishes")).toBeVisible();
  });

  /* ── product detail ────────────────────────────────────────────────── */

  test("detail page shows breadcrumbs, price state and related products", async ({ page }) => {
    await page.goto("/menu/egusi-soup");

    await expect(page.getByRole("heading", { level: 1, name: "Egusi Soup" })).toBeVisible();

    const crumbs = page.getByRole("navigation", { name: "Breadcrumb" });
    await expect(crumbs.getByRole("link", { name: "Home" })).toHaveAttribute("href", "/");
    await expect(crumbs.getByRole("link", { name: "Menu" })).toHaveAttribute("href", "/menu");
    await expect(crumbs.getByText("Egusi Soup")).toHaveAttribute("aria-current", "page");

    // Unconfigured price: honest state, no fabricated amount, no ordering UI.
    // (Related cards below show the same state, hence .first().)
    await expect(page.getByText("Price to be confirmed").first()).toBeVisible();
    await expect(page.getByText(/Final pricing is published when ordering opens/)).toBeVisible();
    await expect(page.getByText("Add to cart")).toHaveCount(0);

    // Gallery area renders (placeholder media until real photography lands).
    await expect(page.getByText("About this dish")).toBeVisible();

    // Gallery: two preview media slots with labelled, stateful thumbnails
    // (button names carry each image's description; the images themselves
    // stay decorative to avoid duplicate alt text).
    const firstThumb = page.getByRole("button", { name: /Show image 1 of 2/ });
    const secondThumb = page.getByRole("button", { name: /Show image 2 of 2/ });
    await expect(firstThumb).toHaveAttribute("aria-pressed", "true");
    await secondThumb.click();
    await expect(secondThumb).toHaveAttribute("aria-pressed", "true");
    await expect(firstThumb).toHaveAttribute("aria-pressed", "false");

    // Related products: same category, self excluded.
    const related = page
      .locator("section")
      .filter({ has: page.getByRole("heading", { name: "More in Traditional Foods" }) });
    await expect(page.getByRole("link", { name: /Bitterleaf Soup/ })).toBeVisible();
    await expect(page.getByRole("link", { name: /Vegetable Soup/ })).toBeVisible();
    await expect(related.locator('a[href="/menu/egusi-soup"]')).toHaveCount(0);
  });

  test("serves metadata and JSON-LD without fabricated facts", async ({ page }) => {
    const response = await page.goto("/menu/egusi-soup");
    expect(response?.status()).toBe(200);

    await expect(page).toHaveTitle(/Egusi Soup/);

    // Preview content is never indexed as real inventory.
    const robots = page.locator('meta[name="robots"]');
    await expect(robots).toHaveAttribute("content", /noindex/);

    const structured = JSON.parse(
      (await page.locator('script[type="application/ld+json"]').textContent()) ?? "{}",
    );
    expect(structured["@type"]).toBe("Product");
    expect(structured.name).toBe("Egusi Soup");
    expect(structured.offers).toBeUndefined(); // no price configured yet
    expect(structured.aggregateRating).toBeUndefined(); // no reviews exist
    expect(structured.review).toBeUndefined();
  });

  test("unknown, draft and malformed slugs return 404", async ({ page }) => {
    for (const slug of ["does-not-exist", "preview-draft-item", "Not A Slug"]) {
      const response = await page.goto(`/menu/${encodeURIComponent(slug)}`);
      expect(response?.status(), `${slug} should 404`).toBe(404);
      await expect(page.getByRole("heading", { name: /isn’t on the menu/ })).toBeVisible();
    }
  });

  test("database-unavailable copy never leaks internals", async ({ page }) => {
    // The unavailable state is exercised in unit tests; here we only assert
    // the designed 404 path keeps internals out of the DOM.
    await page.goto("/menu/does-not-exist");
    const text = (await page.locator("body").innerText()).toLowerCase();
    expect(text).not.toContain("mongodb");
    expect(text).not.toContain("mongodb_uri");
    expect(text).not.toContain("stack");
  });

  /* ── menu metadata ─────────────────────────────────────────────────── */

  test("menu page metadata is honest about preview content", async ({ page }) => {
    await page.goto("/menu");
    await expect(page).toHaveTitle(/Menu/);
    const robots = page.locator('meta[name="robots"]');
    await expect(robots).toHaveAttribute("content", /noindex/);
  });
});
