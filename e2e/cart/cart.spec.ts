import { expect, test, type Page } from "@playwright/test";

/**
 * Phase 4 shopping-cart suite (cart project, port 3002).
 *
 * This suite runs against the disposable cart server, which serves the same
 * production build as the storefront plus `E2E_PURCHASABLE_FIXTURES=1`. That
 * flag adds four clearly-labelled synthetic products so a cart can actually
 * be exercised:
 *
 *   e2e-sample-meal     $12.50, orderable, no options
 *   e2e-portion-pack    Small $8.00 / Large $14.00, options
 *   e2e-sold-out-item   $5.00 but marked unavailable
 *   e2e-unpriced-item   no confirmed price at all
 *
 * The suite covers the whole guest-cart lifecycle: adding, variant identity,
 * quantity, removal, clearing, persistence, drawer modal behaviour and — most
 * importantly — that no figure is ever shown that the server did not confirm.
 */

const STORAGE_KEY = "pearl-cart-v1";

/** Seed persisted cart data before the app boots, as another visit left it. */
async function seedCart(page: Page, items: unknown[]): Promise<void> {
  await page.addInitScript(
    ({ key, payload }) => {
      window.localStorage.setItem(key, JSON.stringify(payload));
    },
    {
      key: STORAGE_KEY,
      payload: { version: 1, items },
    },
  );
}

const cartButton = (page: Page) => page.getByRole("button", { name: /Open your cart/ });
const drawer = (page: Page) => page.getByRole("dialog", { name: "Shopping cart" });

test.describe("PEARL Signature — guest cart", () => {
  test("adds an orderable product from the menu and reflects it in the header", async ({ page }) => {
    await page.goto("/menu/e2e-sample-meal");

    await expect(page.getByRole("heading", { level: 1, name: "E2E Sample Meal" })).toBeVisible();
    await expect(page.getByTestId("purchase-price")).toHaveText("$12.50 CAD");

    await page.getByRole("button", { name: "Add E2E Sample Meal to cart" }).click();

    // The header count is part of the accessible name, so it updates in place.
    await expect(cartButton(page)).toHaveAttribute("aria-label", "Open your cart, 1 items");
  });

  test("adds from the quick-add control on a menu card", async ({ page }) => {
    await page.goto("/menu");

    const quickAdd = page.getByRole("button", { name: "Add E2E Sample Meal to cart" });
    await expect(quickAdd).toBeVisible();
    await quickAdd.click();

    await expect(cartButton(page)).toHaveAttribute("aria-label", "Open your cart, 1 items");
  });

  test("offers no purchase control for an unavailable or unpriced product", async ({ page }) => {
    await page.goto("/menu/e2e-sold-out-item");
    await expect(page.getByTestId("not-orderable")).toContainText("temporarily unavailable");
    await expect(page.getByRole("button", { name: /Add .* to cart/ })).toHaveCount(0);

    await page.goto("/menu/e2e-unpriced-item");
    await expect(page.getByTestId("not-orderable")).toContainText("has not been confirmed yet");
    await expect(page.getByRole("button", { name: /Add .* to cart/ })).toHaveCount(0);
  });

  test("keeps different options of one product as separate cart lines", async ({ page }) => {
    await page.goto("/menu/e2e-portion-pack");

    await expect(page.getByTestId("purchase-price")).toHaveText("$8.00 CAD");
    await page.getByRole("button", { name: "Add E2E Portion Pack to cart" }).click();
    await expect(cartButton(page)).toHaveAttribute("aria-label", "Open your cart, 1 items");

    // Switch to the other option: same product, different line.
    await page.getByRole("radio", { name: /Large/ }).check();
    await expect(page.getByTestId("purchase-price")).toHaveText("$14.00 CAD");
    await page.getByRole("button", { name: "Add E2E Portion Pack to cart" }).click();

    await expect(cartButton(page)).toHaveAttribute("aria-label", "Open your cart, 2 items");
  });

  test("opens the drawer, shows the line and verifies it against the menu", async ({ page }) => {
    await page.goto("/menu/e2e-sample-meal");
    await page.getByRole("button", { name: "Add E2E Sample Meal to cart" }).click();

    await cartButton(page).click();
    const panel = drawer(page);
    await expect(panel).toBeVisible();

    // The row resolves to the server's name and price, never to storage.
    await expect(panel.getByRole("link", { name: "E2E Sample Meal" })).toBeVisible();
    await expect(panel.getByText("$12.50 CAD").first()).toBeVisible();
    await expect(panel.getByText("Subtotal")).toBeVisible();

    // The drawer defers delivery and taxes to checkout rather than quoting
    // figures the business has not confirmed.
    await expect(panel.getByText(/Delivery and taxes are confirmed at checkout/)).toBeVisible();
    await expect(page.getByText(/\$0\.00/)).toHaveCount(0);
  });

  test("closes the drawer with Escape, the X and the backdrop", async ({ page }) => {
    await seedCart(page, [{ slug: "e2e-sample-meal", variantName: null, quantity: 1, unitPriceCents: 1250 }]);
    await page.goto("/menu");

    await cartButton(page).click();
    await expect(drawer(page)).toBeVisible();

    await page.keyboard.press("Escape");
    await expect(drawer(page)).toHaveCount(0);
    // Focus returns to the control that opened it.
    await expect(cartButton(page)).toBeFocused();

    // X button.
    await cartButton(page).click();
    await drawer(page).getByRole("button", { name: "Close cart" }).click();
    await expect(drawer(page)).toHaveCount(0);

    // Backdrop.
    await cartButton(page).click();
    await page.mouse.click(8, 200);
    await expect(drawer(page)).toHaveCount(0);
  });

  test("adjusts quantity, removes a line and clears the whole cart", async ({ page }) => {
    await seedCart(page, [{ slug: "e2e-sample-meal", variantName: null, quantity: 1, unitPriceCents: 1250 }]);
    await page.goto("/menu");
    await cartButton(page).click();

    const panel = drawer(page);
    await expect(panel.getByRole("link", { name: "E2E Sample Meal" })).toBeVisible();

    // Increase, and watch the server-confirmed subtotal follow.
    await panel.getByRole("button", { name: "Increase quantity of E2E Sample Meal" }).click();
    await expect(panel.getByText("$25.00 CAD").first()).toBeVisible();
    await expect(cartButton(page)).toHaveAttribute("aria-label", "Open your cart, 2 items");

    // Remove the line: back to an honest empty state.
    await panel.getByRole("button", { name: "Remove E2E Sample Meal from your cart" }).click();
    await expect(panel.getByText(/Your cart is waiting for something delicious/)).toBeVisible();
    await expect(cartButton(page)).toHaveAttribute("aria-label", "Open your cart, it is empty");
  });

  test("keeps the cart across a full page reload", async ({ page }) => {
    await page.goto("/menu/e2e-sample-meal");
    await page.getByRole("button", { name: "Add E2E Sample Meal to cart" }).click();
    await expect(cartButton(page)).toHaveAttribute("aria-label", "Open your cart, 1 items");

    await page.reload();

    // The count is withheld until the persisted cart has been read, then it
    // returns without any further interaction.
    await expect(cartButton(page)).toHaveAttribute("aria-label", "Open your cart, 1 items");

    await cartButton(page).click();
    await expect(drawer(page).getByRole("link", { name: "E2E Sample Meal" })).toBeVisible();
  });

  test("keeps the cart when navigating to another page and back", async ({ page }) => {
    await page.goto("/menu/e2e-sample-meal");
    await page.getByRole("button", { name: "Add E2E Sample Meal to cart" }).click();

    await page.goto("/menu");
    await expect(cartButton(page)).toHaveAttribute("aria-label", "Open your cart, 1 items");

    await page.goto("/cart");
    await expect(page.getByRole("link", { name: "E2E Sample Meal" })).toBeVisible();
  });

  test("warns when the catalogue price has changed since the customer last saw it", async ({ page }) => {
    // The stored price is a "last seen" hint, not an authority: pretend the
    // customer added this at $10.00 while the menu now says $12.50.
    await seedCart(page, [{ slug: "e2e-sample-meal", variantName: null, quantity: 1, unitPriceCents: 1000 }]);
    await page.goto("/menu");
    await cartButton(page).click();

    const panel = drawer(page);
    await expect(panel.getByText(/Price updated from/)).toBeVisible();
    await expect(panel.getByText("$10.00 CAD to $12.50 CAD")).toBeVisible();
    // The customer is charged the current price, not the stale one.
    await expect(panel.getByText("$12.50 CAD").first()).toBeVisible();
  });

  test("blocks checkout when a line can no longer be resolved", async ({ page }) => {
    // A well-formed slug that is not on the menu at all. It must resolve as
    // unavailable, and the drawer must withhold checkout rather than price it.
    await seedCart(page, [{ slug: "e2e-discontinued-item", variantName: null, quantity: 1, unitPriceCents: 900 }]);
    await page.goto("/menu");
    await cartButton(page).click();

    const panel = drawer(page);
    await expect(panel.getByText(/1 item needs your attention before checkout/)).toBeVisible();
    await expect(panel.getByRole("link", { name: /Proceed to Checkout/ })).toHaveCount(0);
    await expect(panel.getByText("Resolve the highlighted items to continue.")).toBeVisible();
    // No price is ever invented for a product that cannot be found.
    await expect(page.getByText("$9.00 CAD")).toHaveCount(0);
  });

  test("never invents a price when the catalogue cannot be reached", async ({ page }) => {
    await seedCart(page, [{ slug: "e2e-sample-meal", variantName: null, quantity: 3, unitPriceCents: 1250 }]);

    // The quote travels as a Server Action, which is a POST to the current
    // document. Failing every POST is exactly an offline or erroring server.
    await page.route("**/*", (route) =>
      route.request().method() === "POST" ? route.abort() : route.continue(),
    );

    await page.goto("/menu");
    await cartButton(page).click();

    await expect(drawer(page).getByText("We couldn't verify prices")).toBeVisible();
    await expect(drawer(page).getByRole("button", { name: /Try again/ })).toBeVisible();
    // The stored "last seen" price is never presented as the subtotal.
    await expect(page.getByText("$37.50 CAD")).toHaveCount(0);
  });

  test("shows an honest empty state on /cart and routes back to the menu", async ({ page }) => {
    await page.goto("/cart");

    await expect(page.getByText(/Your cart is waiting for something delicious/)).toBeVisible();
    await expect(page.getByRole("link", { name: /Explore the Menu/ })).toBeVisible();
    await expect(page.getByRole("link", { name: /Proceed to Checkout/ })).toHaveCount(0);
    await expect(page.getByText(/\$0\.00/)).toHaveCount(0);
  });

  test("keeps priced and unresolvable cart lines inside a 320px viewport", async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 700 });
    await seedCart(page, [
      { slug: "e2e-sample-meal", variantName: null, quantity: 2, unitPriceCents: 1250 },
      { slug: "e2e-portion-pack", variantName: "Large", quantity: 1, unitPriceCents: 1400 },
      { slug: "e2e-discontinued-item", variantName: null, quantity: 1, unitPriceCents: 900 },
    ]);
    await page.goto("/cart");

    await expect(page.getByText("$25.00 CAD")).toBeVisible();
    await expect(page.getByText("$14.00 CAD")).toBeVisible();
    await expect(page.getByText("This dish is no longer on the menu.")).toBeVisible();
    await expect(page.getByText("Checking…")).toHaveCount(0);

    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth))
      .toBeLessThanOrEqual(0);
  });

  test("settles honestly when no cart line is currently purchasable", async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 700 });
    await seedCart(page, [
      { slug: "e2e-discontinued-item", variantName: null, quantity: 1, unitPriceCents: 900 },
    ]);
    await page.goto("/cart");

    await expect(page.getByText("This dish is no longer on the menu.")).toBeVisible();
    await expect(page.getByText("Price unavailable")).toBeVisible();
    await expect(page.getByText("Price to be confirmed")).toHaveCount(0);
    await expect(page.getByText("No verified items")).toBeVisible();
    await expect(page.getByText("Checking…")).toHaveCount(0);
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth))
      .toBeLessThanOrEqual(0);
  });

  test("edits and clears the cart on /cart with an explicit confirmation step", async ({ page }) => {
    await seedCart(page, [
      { slug: "e2e-sample-meal", variantName: null, quantity: 1, unitPriceCents: 1250 },
      { slug: "e2e-portion-pack", variantName: "Large", quantity: 2, unitPriceCents: 1400 },
    ]);
    await page.goto("/cart");

    await expect(page.getByRole("heading", { name: "3 items" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Order summary" })).toBeVisible();

    // Both lines priced by the server.
    await expect(page.getByText("$12.50 CAD").first()).toBeVisible();
    await expect(page.getByText("$28.00 CAD").first()).toBeVisible();

    // Clearing asks first: arming it must not destroy anything.
    await page.getByRole("button", { name: "Clear cart" }).click();
    await expect(page.getByRole("group", { name: "Confirm clearing your cart" })).toBeVisible();
    await page.getByRole("button", { name: "Keep my cart" }).click();
    await expect(page.getByRole("heading", { name: "3 items" })).toBeVisible();

    // Confirming really clears.
    await page.getByRole("button", { name: "Clear cart" }).click();
    await page.getByRole("button", { name: "Yes, clear my cart" }).click();
    await expect(page.getByText(/Your cart is waiting for something delicious/)).toBeVisible();
  });

  test("offers a keyboard-reachable path from product to cart to checkout", async ({ page }) => {
    await page.goto("/menu/e2e-sample-meal");

    // The primary action is reachable by keyboard alone and shows focus.
    const add = page.getByRole("button", { name: "Add E2E Sample Meal to cart" });
    await add.focus();
    await expect(add).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(cartButton(page)).toHaveAttribute("aria-label", "Open your cart, 1 items");

    // Open the drawer with the keyboard and tab into it.
    await cartButton(page).focus();
    await page.keyboard.press("Enter");
    await expect(drawer(page)).toBeVisible();
    await expect(drawer(page).getByRole("button", { name: "Close cart" }).first()).toBeFocused();

    await page.keyboard.press("Escape");
    await expect(drawer(page)).toHaveCount(0);
    await expect(cartButton(page)).toBeFocused();

    // The drawer footer links to /cart and /checkout for direct navigation.
    await page.goto("/cart");
    await expect(page.getByRole("link", { name: /Proceed to Checkout/ })).toBeVisible();
  });
});
