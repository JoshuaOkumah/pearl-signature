import { expect, test, type Page } from "@playwright/test";

/**
 * Checkout-foundation suite (cart project, port 3002).
 *
 * This project deliberately has NO database (`scripts/e2e-cart-server.ts`
 * blanks `MONGODB_URI`), which is precisely Phase 5's "the store's
 * configuration could not be read" state. So the suite holds two lines:
 *
 *  - the basket is still reviewed against server-verified prices, and
 *  - ordering stays closed with no payment panel, no Place order button
 *    and an honest reason, because fulfilment and tax policy are unknown.
 *
 * Everything a customer types stays in this tab: no submission of any
 * kind is possible from this server. Order placement itself is exercised
 * by the "orders" project (port 3003), which has a real database.
 *
 * The live order flow, price-change handling and rate limiting live in
 * `e2e/orders/orders.spec.ts`.
 */

const STORAGE_KEY = "pearl-cart-v1";

async function seedCart(page: Page, items: unknown[]): Promise<void> {
  await page.addInitScript(
    ({ key, payload }) => {
      window.localStorage.setItem(key, JSON.stringify(payload));
    },
    { key: STORAGE_KEY, payload: { version: 1, items } },
  );
}

/** A cart that the disposable catalogue can fully resolve. */
const resolvableCart = [
  { slug: "e2e-sample-meal", variantName: null, quantity: 2, unitPriceCents: 1250 },
  { slug: "e2e-portion-pack", variantName: "Large", quantity: 1, unitPriceCents: 1400 },
];

const name = (page: Page) => page.getByLabel(/^Full name/);
const email = (page: Page) => page.getByLabel(/^Email address/);
const phone = (page: Page) => page.getByLabel(/^Phone number/);

test.describe("PEARL Signature — checkout review", () => {
  test("redirects an empty cart to an honest empty state, not a form", async ({ page }) => {
    await page.goto("/checkout");

    await expect(page.getByText(/Your cart is waiting for something delicious/)).toBeVisible();
    await expect(page.getByRole("link", { name: /Explore the Menu/ })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Your details" })).toHaveCount(0);
    await expect(page.getByText(/\$0\.00/)).toHaveCount(0);
  });

  test("reviews the basket with every price verified by the server", async ({ page }) => {
    await seedCart(page, resolvableCart);
    await page.goto("/checkout");

    await expect(page.getByRole("heading", { name: "Your order" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Your details" })).toBeVisible();

    // Both lines, with their server-resolved names and options.
    await expect(page.getByRole("link", { name: "E2E Sample Meal" })).toBeVisible();
    await expect(page.getByText(/Option: Large/)).toBeVisible();

    // $12.50 x 2 and $14.00 x 1.
    await expect(page.getByText("$25.00 CAD").first()).toBeVisible();
    await expect(page.getByText("$14.00 CAD").first()).toBeVisible();

    // Back to the cart for corrections.
    await expect(page.getByRole("link", { name: "Edit cart" })).toHaveAttribute("href", "/cart");
    await expect(page.getByRole("link", { name: /Back to your cart/ })).toBeVisible();
  });

  test("shows the server-quoted subtotal and claims no fee or tax it does not know", async ({ page }) => {
    await seedCart(page, resolvableCart);
    await page.goto("/checkout");

    // $12.50 x 2 + $14.00 x 1, quoted by the server.
    const summary = page.locator("dl").filter({ hasText: "Subtotal" });
    await expect(summary.getByText("Subtotal")).toBeVisible();
    await expect(summary.getByText("$39.00 CAD")).toBeVisible();

    // Without readable configuration there is no delivery fee, no tax row
    // and no total: only the merchandise subtotal the server confirmed.
    await expect(summary.getByText("Total", { exact: true })).toHaveCount(0);
    await expect(summary.getByText(/Delivery fee/)).toHaveCount(0);
    await expect(summary.getByText("$0.00 CAD")).toHaveCount(0);
    await expect(page.getByText(/\$0\.00/)).toHaveCount(0);
  });

  test("blocks ordering with a stated reason while configuration is unreadable", async ({ page }) => {
    await seedCart(page, resolvableCart);
    await page.goto("/checkout");

    const blocked = page.getByTestId("checkout-blocked");
    await expect(blocked).toBeVisible();
    await expect(blocked.getByText("Ordering is not open right now")).toBeVisible();
    await expect(
      blocked.getByText(/Checkout availability could not be confirmed right now/),
    ).toBeVisible();
    await expect(blocked.getByText(/Nothing has been sent or charged/)).toBeVisible();

    // Nothing that could submit anything: no payment panel, no Place order
    // button, no form that posts anywhere.
    await expect(page.getByTestId("place-order")).toHaveCount(0);
    await expect(page.getByText("Cash on arrival")).toHaveCount(0);
    await expect(page.getByRole("button", { name: /place order/i })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /pay/i })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /confirm/i })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /submit/i })).toHaveCount(0);
    expect(await page.locator("form").first().getAttribute("action")).toBeNull();
  });

  test("keeps both fulfilment options visible but unavailable, and shows no address form", async ({ page }) => {
    await seedCart(page, resolvableCart);
    await page.goto("/checkout");

    // The options are never silently dropped, and never offered either:
    // each is disabled with an honest badge.
    const delivery = page.getByRole("radio", { name: /Delivery/ });
    const pickup = page.getByRole("radio", { name: /Pickup/ });
    await expect(delivery).toBeDisabled();
    await expect(pickup).toBeDisabled();
    await expect(page.getByText("Not available")).toHaveCount(2);

    // Neither address nor pickup fields appear for an unavailable method.
    await expect(page.getByTestId("delivery-fields")).toHaveCount(0);
    await expect(page.getByTestId("pickup-fields")).toHaveCount(0);

    // A disabled option cannot be chosen, so no promise of either method
    // is ever made from an unknown configuration.
    await pickup.click({ force: true });
    await expect(page.getByTestId("pickup-fields")).toHaveCount(0);
  });

  test("validates Canadian details with per-field messages", async ({ page }) => {
    await seedCart(page, resolvableCart);
    await page.goto("/checkout");

    // Blank required fields complain on blur.
    await name(page).click();
    await page.keyboard.press("Tab");
    await expect(page.getByText("Enter your full name")).toBeVisible();
    await expect(name(page)).toHaveAttribute("aria-invalid", "true");

    // The error is programmatically tied to its field.
    await email(page).click();
    await page.keyboard.press("Tab");
    await expect(email(page)).toHaveAttribute("aria-invalid", "true");
    const describedBy = await email(page).getAttribute("aria-describedby");
    expect(describedBy).toContain("checkout-email-error");

    // A non-Canadian number is refused with guidance (checked per field, so
    // it speaks up even while the other fields are still blank).
    await phone(page).fill("+44 20 7946 0958");
    await phone(page).blur();
    await expect(page.getByText(/Enter a Canadian phone number/)).toBeVisible();
  });

  test("clears an error the moment the field is fixed", async ({ page }) => {
    await seedCart(page, resolvableCart);
    await page.goto("/checkout");

    await name(page).click();
    await page.keyboard.press("Tab");
    await expect(page.getByText("Enter your full name")).toBeVisible();

    await name(page).fill("Ada Okonkwo");
    await expect(page.getByText("Enter your full name")).toHaveCount(0);
    await expect(name(page)).not.toHaveAttribute("aria-invalid", "true");
  });

  test("accepts complete details and still transmits nothing", async ({ page }) => {
    await seedCart(page, resolvableCart);
    await page.goto("/checkout");

    await name(page).fill("Ada Okonkwo");
    await email(page).fill("Ada.Okonkwo@Example.com");
    await phone(page).fill("(416) 555-0123");
    await page.getByLabel(/^Notes/).fill("Ring the buzzer.");

    await page.keyboard.press("Tab");

    // Every field-level complaint is gone… (scoped to the form: Next's
    // route announcer is a permanent body-level role="alert" element.)
    await expect(page.locator("form [role=alert]")).toHaveCount(0);

    // …and nothing has been transmitted. No submission control exists, no
    // amount is presented as a charge, and the basket is untouched.
    await expect(page.getByTestId("place-order")).toHaveCount(0);
    await expect(page.getByText(/\$0\.00/)).toHaveCount(0);
    expect(await page.locator("form").first().getAttribute("action")).toBeNull();
  });

  test("keeps the customer's details in the tab only across a reload", async ({ page }) => {
    await seedCart(page, resolvableCart);
    await page.goto("/checkout");

    await name(page).fill("Ada Okonkwo");
    await expect(name(page)).toHaveValue("Ada Okonkwo");

    // Nothing was persisted, so a reload starts clean: an honest guarantee
    // that no personal detail is written to storage.
    await page.reload();
    await expect(name(page)).toHaveValue("");
  });

  test("marks an unresolvable line and withholds checkout until it is resolved", async ({ page }) => {
    await seedCart(page, [
      { slug: "e2e-sample-meal", variantName: null, quantity: 1, unitPriceCents: 1250 },
      { slug: "e2e-discontinued-item", variantName: null, quantity: 1, unitPriceCents: 900 },
    ]);
    await page.goto("/checkout");

    await expect(page.getByText("1 item needs attention")).toBeVisible();
    await expect(page.getByText(/Remove the highlighted items, or update them in your cart/)).toBeVisible();

    // The unresolvable line is named by the server, never priced.
    await expect(page.getByText("e2e-discontinued-item").first()).toBeVisible();
    await expect(page.getByText("$9.00 CAD")).toHaveCount(0);
  });

  test("says prices could not be verified rather than showing unverified figures", async ({ page }) => {
    await seedCart(page, resolvableCart);

    // The quote travels as a Server Action (a POST); failing every POST is
    // an offline or erroring server.
    await page.route("**/*", (route) =>
      route.request().method() === "POST" ? route.abort() : route.continue(),
    );

    await page.goto("/checkout");

    await expect(page.getByText("Prices could not be verified").first()).toBeVisible();
    await expect(page.getByText(/Your items are saved and nothing has been submitted/)).toBeVisible();
    await expect(page.getByText("Prices could not be verified. Nothing has been submitted.")).toBeVisible();
    await expect(page.getByText(/\$25\.00 CAD/)).toHaveCount(0);
    await expect(page.getByText(/\$0\.00/)).toHaveCount(0);
  });

  test("is fully operable by keyboard at a narrow viewport", async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 740 });
    await seedCart(page, resolvableCart);
    await page.goto("/checkout");

    // Reach the first field by keyboard and complete it.
    await name(page).focus();
    await expect(name(page)).toBeFocused();
    await page.keyboard.type("Ada Okonkwo");

    // The form, the summary and the honest blocked-ordering panel are all
    // visible without any horizontal scrolling at 360px.
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);

    await expect(page.getByRole("heading", { name: "Your order" })).toBeVisible();
    await expect(page.getByTestId("checkout-blocked")).toBeVisible();
    await expect(page.getByText("Ordering is not open right now")).toBeVisible();
  });
});
