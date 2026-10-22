import { expect, test, type Locator, type Page } from "@playwright/test";
import { E2E_ADMIN_EMAIL, E2E_ADMIN_PASSWORD } from "./credentials";

/**
 * Phase 3 admin suite: owner authentication, product lifecycle (draft →
 * published → unavailable → archived → restore), category management,
 * storefront propagation (including the slug redirect and Phase 2B search
 * behaviour) and the small-screen admin experience.
 *
 * Runs against the second Playwright server: production build + disposable
 * in-memory MongoDB (scripts/e2e-admin-server.ts) with a fresh owner
 * account created by the real bootstrap script on every run. Tests run in
 * serial order because they build on each other's fixtures; the seeded
 * baseline is 12 products / 3 categories.
 */
test.describe.configure({ mode: "serial" });
test.setTimeout(60_000);

const PRODUCT_NAME = "Trial Jollof Bowl";
const PRODUCT_SLUG = "trial-jollof-bowl";
const NEW_SLUG = "trial-bowl-final";
const CATEGORY_NAME = "E2E Sides";
const CATEGORY_SLUG = "e2e-sides";
const CATEGORY_NAME_RENAMED = "E2E Sides Renamed";

async function login(page: Page, password = E2E_ADMIN_PASSWORD): Promise<void> {
  await page.goto("/admin/login");
  await expect(page.getByRole("heading", { level: 1, name: "Sign in" })).toBeVisible();
  await page.getByRole("textbox", { name: "Email (required)" }).fill(E2E_ADMIN_EMAIL);
  await page.getByRole("textbox", { name: "Password (required)" }).fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL("/admin");
  await expect(page.getByRole("heading", { level: 1, name: "Dashboard" })).toBeVisible();
}

function statValue(page: Page, label: string): Locator {
  return page
    .locator('section[aria-label="Catalogue statistics"]')
    .getByText(label, { exact: true })
    .locator("xpath=following-sibling::p[1]");
}

function productRow(page: Page, name: string): Locator {
  return page.getByRole("row").filter({ hasText: name });
}

function categoryRow(page: Page, name: string): Locator {
  return page
    .locator('section[aria-labelledby="existing-categories"] li')
    .filter({ hasText: name });
}

test.describe("PEARL Signature — admin", () => {
  /* ── authentication and access control ─────────────────────────────── */

  test("anonymous visitors are redirected to sign in without storefront chrome", async ({ page }) => {
    for (const adminPath of ["/admin", "/admin/products", "/admin/categories"]) {
      await page.goto(adminPath);
      await expect(page).toHaveURL(/\/admin\/login/);
    }
    await expect(page.getByRole("heading", { level: 1, name: "Sign in" })).toBeVisible();
    await expect(page.getByText("Store administration")).toBeVisible();
    await expect(page.getByRole("link", { name: "Back to the storefront" })).toBeVisible();
    // The storefront header/footer never render inside the admin area.
    await expect(page.locator("header")).toHaveCount(0);
  });

  test("wrong credentials fail with one generic error", async ({ page }) => {
    await page.goto("/admin/login");
    await page.getByRole("textbox", { name: "Email (required)" }).fill(E2E_ADMIN_EMAIL);
    await page.getByRole("textbox", { name: "Password (required)" }).fill("not-the-password-123");
    await page.getByRole("button", { name: "Sign in" }).click();

    await expect(page).toHaveURL(/\/admin\/login/);
    await expect(page.getByText("Email or password is incorrect.")).toBeVisible();
    // The message never reveals which half was wrong.
    await expect(page.getByText(/no account|unknown email|not found/i)).toHaveCount(0);
  });

  test("valid credentials open the dashboard with real seeded counts", async ({ page }) => {
    await login(page);

    await expect(statValue(page, "Total products")).toHaveText("12");
    await expect(statValue(page, "Published")).toHaveText("11");
    await expect(statValue(page, "Drafts")).toHaveText("1");
    await expect(statValue(page, "Unavailable")).toHaveText("0");
    await expect(statValue(page, "Categories")).toHaveText("3");
    await expect(page.getByText("3 active")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Recently updated" })).toBeVisible();
    await expect(page.getByText("Welcome to your dashboard")).toHaveCount(0);
  });

  test("sign out revokes the session server-side", async ({ page, context }) => {
    await login(page);

    // Keep a copy of the live cookie so the revocation can be PROVEN, not
    // just observed.
    const cookies = await context.cookies();
    const sessionCookie = cookies.find((cookie) => cookie.name === "pearl_admin_session");
    expect(sessionCookie).toBeDefined();

    await page.getByRole("button", { name: "Sign out" }).click();
    await expect(page).toHaveURL(/\/admin\/login/);

    // Re-inject the old token: the server must reject it (revoked), so the
    // browser state alone cannot restore access.
    await context.addCookies([
      { ...sessionCookie!, expires: Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60 },
    ]);
    await page.goto("/admin");
    await expect(page).toHaveURL(/\/admin\/login/);
  });

  /* ── product lifecycle ─────────────────────────────────────────────── */

  test("create a draft product that stays off the storefront", async ({ page }) => {
    await login(page);
    await page.goto("/admin/products/new");
    await expect(page.getByRole("heading", { level: 1, name: "Add product" })).toBeVisible();

    await page.getByLabel("Product name").fill(PRODUCT_NAME);
    await page.getByLabel("Category").selectOption({ label: "Traditional Foods" });
    await page.getByLabel("Full description").fill(
      "Synthetic data created by the automated Phase 3 suite.",
    );
    await page.getByLabel("Price (CAD)").fill("9.75");
    // Draft-first policy: the default publication state is hidden.
    await expect(page.getByLabel("Draft (hidden)")).toBeChecked();

    await page.getByRole("button", { name: "Create product" }).click();
    await expect(page).toHaveURL(/\/admin\/products\/[0-9a-f]{24}\/edit\?created=1/);
    await expect(page.getByText("Product created. It is currently draft.")).toBeVisible();
    await expect(page.getByRole("heading", { level: 1, name: PRODUCT_NAME })).toBeVisible();

    // Honest state: no image credentials exist in this environment.
    await expect(page.getByText(/Photo uploads are not configured on this deployment/)).toBeVisible();

    // The list shows it as a draft…
    await page.goto("/admin/products");
    await expect(productRow(page, PRODUCT_NAME)).toBeVisible();
    await expect(productRow(page, PRODUCT_NAME).getByText("draft", { exact: true })).toBeVisible();

    // …while the public catalogue never shows a draft.
    await page.goto("/menu");
    await expect(page.getByRole("link", { name: new RegExp(PRODUCT_NAME) })).toHaveCount(0);
  });

  test("publishing puts it on the storefront and Phase 2B search still works", async ({ page }) => {
    await login(page);
    await page.goto("/admin/products");
    await productRow(page, PRODUCT_NAME).getByRole("link", { name: "Edit" }).click();
    await expect(page).toHaveURL(/\/admin\/products\/[0-9a-f]{24}\/edit/);

    await page.getByLabel("Published", { exact: true }).check();
    await page.getByRole("button", { name: "Save changes" }).click();
    await expect(page).toHaveURL(/\?saved=1/);
    await expect(page.getByText("Changes saved.")).toBeVisible();

    // Storefront propagation (database source on port 3001).
    await page.goto("/menu");
    await expect(page.getByRole("link", { name: new RegExp(PRODUCT_NAME) })).toBeVisible();

    // Phase 2B search behaviour preserved against real data.
    const search = page.getByRole("searchbox", { name: /Search dishes by name/i });
    await search.fill("trial");
    await expect(page).toHaveURL("/menu?search=trial");
    await expect(page.getByRole("link", { name: new RegExp(PRODUCT_NAME) })).toBeVisible();
    await expect(page.getByRole("link", { name: /Egusi Soup/ })).toHaveCount(0);

    await search.fill("");
    await expect(page).toHaveURL("/menu");
    await expect(page.getByRole("link", { name: /Egusi Soup/ })).toBeVisible();
  });

  test("changing the slug keeps the old address redirecting to the new one", async ({ page }) => {
    await login(page);
    await page.goto("/admin/products");
    await productRow(page, PRODUCT_NAME).getByRole("link", { name: "Edit" }).click();

    await page.getByLabel("Web address (slug)").fill(NEW_SLUG);
    await page.getByRole("button", { name: "Save changes" }).click();
    await expect(page.getByText("Changes saved.")).toBeVisible();

    // The former address answers with a permanent redirect…
    const legacy = await page.request.get(`http://localhost:3001/menu/${PRODUCT_SLUG}`, {
      maxRedirects: 0,
    });
    expect(legacy.status()).toBe(308);

    // …and following it lands on the published product.
    await page.goto(`/menu/${PRODUCT_SLUG}`);
    await expect(page).toHaveURL(`/menu/${NEW_SLUG}`);
    await expect(page.getByRole("heading", { level: 1, name: PRODUCT_NAME })).toBeVisible();
  });

  test("unavailability is visible and archiving removes it without deleting", async ({ page }) => {
    await login(page);
    await page.goto("/admin/products");

    // Quick toggle from the list: published but sold out.
    await productRow(page, PRODUCT_NAME).getByRole("button", { name: "Mark unavailable" }).click();
    await expect(productRow(page, PRODUCT_NAME).getByText("Unavailable", { exact: true })).toBeVisible();
    await page.goto(`/menu/${NEW_SLUG}`);
    await expect(page.getByText("Currently unavailable")).toBeVisible();

    // Archive is a deliberate two-step confirmation.
    await page.goto("/admin/products");
    const row = productRow(page, PRODUCT_NAME);
    await row.getByRole("button", { name: "Archive", exact: true }).click();
    await expect(row.getByRole("button", { name: "Confirm archive" })).toBeVisible();
    await row.getByRole("button", { name: "Confirm archive" }).click();
    await expect(page).toHaveURL(/\/admin\/products\?archived=/);
    await expect(
      page.getByText("Product archived. It no longer appears in the storefront."),
    ).toBeVisible();

    // Gone from the menu; its detail address is a real 404.
    await page.goto("/menu");
    await expect(page.getByRole("link", { name: new RegExp(PRODUCT_NAME) })).toHaveCount(0);
    const detail = await page.goto(`/menu/${NEW_SLUG}`);
    expect(detail?.status()).toBe(404);

    // The record still exists: archived, editable, restorable as a draft.
    await page.goto("/admin/products?status=archived");
    await productRow(page, PRODUCT_NAME).getByRole("link", { name: "Edit" }).click();
    await expect(page.getByText("This product is archived")).toBeVisible();
    await page.getByRole("button", { name: "Restore as draft" }).click();
    await expect(page).toHaveURL(/\?restored=1/);
    await expect(
      page.getByText("Product restored as a draft. Publish it when you are ready."),
    ).toBeVisible();
    await expect(page.getByRole("heading", { level: 1, name: PRODUCT_NAME })).toBeVisible();
  });

  test("list search and filters stay honest", async ({ page }) => {
    await login(page);

    await page.goto("/admin/products?search=Trial");
    await expect(productRow(page, PRODUCT_NAME)).toBeVisible();
    await expect(productRow(page, "Egusi Soup")).toHaveCount(0);

    await page.goto("/admin/products?search=zzz-nothing-matches");
    await expect(page.getByText("No products match these filters")).toBeVisible();

    // Restored as a draft in the previous test: visible under "draft"…
    await page.goto("/admin/products?status=draft");
    await expect(productRow(page, PRODUCT_NAME)).toBeVisible();
    await expect(productRow(page, PRODUCT_NAME).getByText("draft", { exact: true })).toBeVisible();

    // …and absent from the archived filter.
    await page.goto("/admin/products?status=archived");
    await expect(productRow(page, PRODUCT_NAME)).toHaveCount(0);
  });

  /* ── categories ────────────────────────────────────────────────────── */

  test("create, rename (address stays), disable and re-enable a category", async ({ page }) => {
    await login(page);
    await page.goto("/admin/categories");
    await expect(page.getByRole("heading", { level: 1, name: "Categories" })).toBeVisible();

    // Create: the slug is derived server-side from the name.
    const addSection = page.locator('section[aria-labelledby="add-category"]');
    await addSection.getByLabel("Name").fill(CATEGORY_NAME);
    await addSection.getByRole("button", { name: "Add category" }).click();
    await expect(page).toHaveURL(/\/admin\/categories\?created=1/);
    await expect(page.getByText("Category created and added to the storefront filters.")).toBeVisible();

    await expect(categoryRow(page, CATEGORY_NAME)).toBeVisible();
    await expect(categoryRow(page, CATEGORY_NAME).getByText("0 products")).toBeVisible();

    // Rename must NOT move the web address (stable public filter URLs).
    await categoryRow(page, CATEGORY_NAME).getByLabel("Name").fill(CATEGORY_NAME_RENAMED);
    await categoryRow(page, CATEGORY_NAME).getByRole("button", { name: "Save changes" }).click();
    await expect(page).toHaveURL(/\/admin\/categories\?saved=1/);
    await expect(page.getByText("Category changes saved.")).toBeVisible();
    await expect(categoryRow(page, CATEGORY_NAME_RENAMED).getByLabel("Web address")).toHaveValue(
      CATEGORY_SLUG,
    );

    // The category flows into the product form while active.
    await page.goto("/admin/products/new");
    await page.getByLabel("Category").selectOption({ label: CATEGORY_NAME_RENAMED });

    // Disable (no products → no confirmation needed): hidden, not deleted.
    await page.goto("/admin/categories");
    await categoryRow(page, CATEGORY_NAME_RENAMED).getByLabel("Visible to customers").uncheck();
    await categoryRow(page, CATEGORY_NAME_RENAMED).getByRole("button", { name: "Save changes" }).click();
    await expect(page).toHaveURL(/saved=1/);
    await expect(categoryRow(page, CATEGORY_NAME_RENAMED).getByText("Disabled", { exact: true })).toBeVisible();

    // Re-enable.
    await categoryRow(page, CATEGORY_NAME_RENAMED).getByLabel("Visible to customers").check();
    await categoryRow(page, CATEGORY_NAME_RENAMED).getByRole("button", { name: "Save changes" }).click();
    await expect(page).toHaveURL(/saved=1/);
    await expect(categoryRow(page, CATEGORY_NAME_RENAMED).getByText("Active", { exact: true })).toBeVisible();

    // Disabling a category that HAS products arms a confirmation first, so
    // a stray click cannot hide a populated section. Back out safely.
    const mains = categoryRow(page, "Traditional Foods");
    await mains.getByLabel("Visible to customers").uncheck();
    await mains.getByRole("button", { name: "Save changes" }).click();
    await expect(mains.getByRole("button", { name: "Confirm disable" })).toBeVisible();
    await expect(mains.getByRole("alert")).toContainText("Press again to confirm");
    // Re-checking changes the form, which disarms the confirmation: the
    // button returns to its normal label and submits the active state.
    await mains.getByLabel("Visible to customers").check();
    await mains.getByRole("button", { name: "Save changes" }).click();
    await expect(page).toHaveURL(/saved=1/);
    await expect(categoryRow(page, "Traditional Foods").getByText("Active", { exact: true })).toBeVisible();
  });

  /* ── small screens ─────────────────────────────────────────────────── */

  test.describe("mobile admin (360px)", () => {
    test.use({ viewport: { width: 360, height: 740 } });

    test("drawer navigation, list and forms work on a small screen", async ({ page }) => {
      await login(page);

      // The desktop sidebar collapses into the drawer.
      await expect(page.getByRole("button", { name: "Open navigation menu" })).toBeVisible();
      await page.getByRole("button", { name: "Open navigation menu" }).click();
      const drawer = page.getByRole("dialog", { name: "Admin navigation" });
      await expect(drawer).toBeVisible();
      await expect(drawer.getByRole("link", { name: "Products" })).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(drawer).toBeHidden();

      // The product list fits the viewport with no horizontal scrolling.
      await page.goto("/admin/products");
      const listOverflow = await page.evaluate(
        () => document.documentElement.scrollWidth - window.innerWidth,
      );
      expect(listOverflow).toBeLessThanOrEqual(1);

      // Key form controls are reachable without sideways scrolling.
      await page.goto("/admin/products/new");
      await expect(page.getByLabel("Product name")).toBeVisible();
      await expect(page.getByLabel("Price (CAD)")).toBeVisible();
      await expect(page.getByRole("button", { name: "Create product" })).toBeVisible();
      const formOverflow = await page.evaluate(
        () => document.documentElement.scrollWidth - window.innerWidth,
      );
      expect(formOverflow).toBeLessThanOrEqual(1);
    });
  });
});
