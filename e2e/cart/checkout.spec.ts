import { expect, test, type Page } from "@playwright/test";

/**
 * Phase 4 checkout-foundation suite (cart project, port 3002).
 *
 * `/checkout` is a REVIEW step only. These tests hold the line on what that
 * means: every price is server-verified, delivery and taxes read "To be
 * confirmed" rather than `$0.00`, the customer's details are validated but
 * never transmitted, and there is no order submission of any kind.
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
const street = (page: Page) => page.getByLabel(/^Street address/);
const city = (page: Page) => page.getByLabel(/^City or town/);
const province = (page: Page) => page.getByLabel(/^Province or territory/);
const postal = (page: Page) => page.getByLabel(/^Postal code/);

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

  test("shows delivery and taxes as to be confirmed, and never claims a total", async ({ page }) => {
    await seedCart(page, resolvableCart);
    await page.goto("/checkout");

    await expect(page.getByText("Merchandise subtotal")).toBeVisible();
    const summary = page.locator("dl").filter({ hasText: "Merchandise subtotal" });
    await expect(summary.getByText("Delivery", { exact: true })).toBeVisible();
    await expect(summary.getByText("Estimated taxes")).toBeVisible();
    await expect(page.getByText("To be confirmed")).toHaveCount(2);

    // No zero, and no figure presented as the amount to be charged.
    await expect(page.getByText(/\$0\.00/)).toHaveCount(0);
    await expect(page.getByText("Total", { exact: true })).toHaveCount(0);
    await expect(page.getByText(/Delivery and taxes are added once the business confirms/)).toBeVisible();
  });

  test("offers no way to place an order, and says so plainly", async ({ page }) => {
    await seedCart(page, resolvableCart);
    await page.goto("/checkout");

    await expect(page.getByText("Order placement is not available yet")).toBeVisible();
    await expect(page.getByText(/Taking payment, confirming delivery and sending receipts/)).toBeVisible();

    // Nothing that could submit anything.
    await expect(page.getByRole("button", { name: /place order/i })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /pay/i })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /confirm/i })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /submit/i })).toHaveCount(0);
    expect(await page.locator("form").getAttribute("action")).toBeNull();
  });

  test("marks fulfilment as unconfirmed and collects no fee or promise", async ({ page }) => {
    await seedCart(page, resolvableCart);
    await page.goto("/checkout");

    await expect(page.getByText("Not yet confirmed")).toHaveCount(2);
    await expect(
      page.getByText(/Service areas, fees and pickup arrangements are still being finalised/),
    ).toBeVisible();

    // Delivery is selected, so its address fields are required…
    await expect(page.getByTestId("delivery-fields")).toBeVisible();

    // …and switching to pickup hides them without demanding an address.
    await page.getByRole("radio", { name: /Pickup/ }).click();
    await expect(page.getByTestId("pickup-fields")).toBeVisible();
    await expect(page.getByText(/A pickup location and collection times have not been confirmed yet/)).toBeVisible();
    await expect(page.getByTestId("delivery-fields")).toHaveCount(0);

    await page.getByRole("radio", { name: /Delivery/ }).click();
    await expect(page.getByTestId("delivery-fields")).toBeVisible();
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

    // Postal code and province are checked together with delivery, once the
    // rest of the form is sound: give it a complete valid set first.
    await name(page).fill("Ada Okonkwo");
    await email(page).fill("ada@example.com");
    await phone(page).fill("416 555 0123");

    // A postal code Canada Post would not issue is refused.
    await postal(page).fill("12345");
    await postal(page).blur();
    await expect(page.getByText("Enter a postal code like K1A 0B1")).toBeVisible();

    // An unknown province is refused rather than defaulted.
    await street(page).fill("123 Queen Street W");
    await city(page).fill("Toronto");
    await city(page).blur();
    await expect(page.getByText("Choose your province or territory")).toBeVisible();
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

  test("accepts a complete valid delivery order and still submits nothing", async ({ page }) => {
    await seedCart(page, resolvableCart);
    await page.goto("/checkout");

    await name(page).fill("Ada Okonkwo");
    await email(page).fill("Ada.Okonkwo@Example.com");
    await phone(page).fill("(416) 555-0123");
    await street(page).fill("123 Queen Street W");
    await city(page).fill("Toronto");
    await province(page).selectOption("ON");
    await postal(page).fill("m5h2n2");
    await page.getByLabel(/^Notes/).fill("Ring the buzzer.");

    await page.keyboard.press("Tab");

    // Every field-level complaint is gone… (scoped to the form: Next's
    // route announcer is a permanent body-level role="alert" element.)
    await expect(page.locator("form [role=alert]")).toHaveCount(0);

    // …and nothing has been transmitted. No order exists, no total appeared,
    // and the page still says the details stay in this tab.
    await expect(page.getByText(/Your details stay in this browser tab/)).toBeVisible();
    await expect(page.getByText(/Nothing you type on this page is sent or saved yet/)).toBeVisible();
    await expect(page.getByText(/\$0\.00/)).toHaveCount(0);
    expect(await page.locator("form").getAttribute("action")).toBeNull();
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
    await expect(page.getByText("Could not be verified", { exact: true })).toBeVisible();
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

    // The form, the summary and the honest no-ordering panel are all visible
    // without any horizontal scrolling at 360px.
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);

    await expect(page.getByRole("heading", { name: "Your order" })).toBeVisible();
    await expect(page.getByText("Order placement is not available yet")).toBeVisible();
  });
});
