/**
 * Design-review utility: captures screenshots of every public route —
 * including the Phase 2 filter state, product detail page and designed 404 —
 * at the reference viewports (including mobile landscape and the OPEN
 * mobile menu), and asserts zero horizontal overflow on every capture.
 *
 * With `ADMIN_BASE_URL` + `ADMIN_EMAIL` + `ADMIN_PASSWORD` set (Phase 3),
 * it also captures the admin surfaces: login, dashboard, product list,
 * product forms (with the upload-not-configured notice), categories and
 * the open mobile drawer.
 *
 * With `CART_BASE_URL` set (Phase 4), it also captures the cart drawer
 * (empty, populated and price-changed), `/cart` (populated and with an
 * unresolvable item) and `/checkout` (delivery review, validation errors
 * and pickup). Point it at the disposable cart server so the basket has
 * honestly-priced products to show.
 *
 * Usage:
 *   1. Start the app:        npm run start   (or `npm run dev`)
 *                            For a production server without MongoDB, set
 *                            CATALOGUE_SOURCE=fixtures so preview products
 *                            render; without it the honest unavailable state
 *                            is what a production build shows.
 *                            For the admin captures, start the disposable
 *                            stack (scripts/e2e-admin-server.ts) and point
 *                            ADMIN_BASE_URL at it.
 *                            For the cart captures, start
 *                            scripts/e2e-cart-server.ts and point
 *                            CART_BASE_URL at it.
 *   2. Capture screenshots:  npm run screenshots
 *
 * Output: ./screenshots/<page>-<width>x<height>.png
 *         ./screenshots/menu-open-<width>x<height>.png
 *         ./screenshots/cart-drawer[-...]...png, cart-page-...png,
 *           checkout[-...]...png
 *         ./screenshots/admin-<surface>-<width>x<height>.png
 */
import { chromium } from "@playwright/test";
import { mkdir } from "node:fs/promises";

const baseURL = process.env.BASE_URL ?? "http://localhost:3000";
const outDir = process.env.OUT_DIR ?? "screenshots";

const routes = [
  "/",
  "/menu",
  "/menu?category=drinks",
  "/menu?search=pie",
  "/menu?search=f",
  "/menu/egusi-soup",
  "/menu/no-such-dish",
  "/about",
  "/contact",
];

/** URL route → stable file name. */
function nameFor(route) {
  if (route === "/") return "home";
  return route.replace(/^\//, "").replace(/[^a-z0-9]+/gi, "-").replace(/-+$/, "");
}

/** Reference viewports: small phones through desktop, plus mobile landscape. */
const viewports = [
  { width: 320, height: 700 },
  { width: 360, height: 800 },
  { width: 375, height: 812 },
  { width: 390, height: 844 },
  { width: 430, height: 932 },
  { width: 667, height: 375 }, // landscape, hamburger visible
  { width: 844, height: 390 }, // landscape, desktop nav visible
  { width: 768, height: 1024 },
  { width: 1024, height: 900 },
  { width: 1440, height: 900 },
];

/** Open-menu captures are mandatory (the original navigation bug lived here). */
const openMenuViewports = [
  { width: 320, height: 568 },
  { width: 360, height: 800 },
  { width: 390, height: 844 },
  { width: 430, height: 932 },
  { width: 667, height: 375 }, // short landscape: panel must scroll internally
];

await mkdir(outDir, { recursive: true });

const browser = await chromium.launch();
let failures = 0;

async function checkOverflow(page, label) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  if (overflow > 0) {
    failures += 1;
    console.error(`  ✗ ${label}: horizontal overflow of ${overflow}px`);
  }
  return overflow;
}

for (const route of routes) {
  const name = nameFor(route);
  for (const viewport of viewports) {
    const page = await browser.newPage({ viewport });
    await page.goto(`${baseURL}${route}`, { waitUntil: "networkidle" });

    // Scroll through gradually (like a real visitor) so scroll-reveal
    // sections enter the viewport before capturing.
    const height = await page.evaluate(() => document.body.scrollHeight);
    for (let y = 0; y <= height; y += 450) {
      await page.mouse.wheel(0, 450);
      await page.waitForTimeout(90);
    }
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
    await page.waitForTimeout(400);

    await checkOverflow(page, `${name} @ ${viewport.width}`);
    const file = `${outDir}/${name}-${viewport.width}x${viewport.height}.png`;
    await page.screenshot({ path: file, fullPage: true });
    console.log(`✓ ${name} @ ${viewport.width}x${viewport.height}`);
    await page.close();
  }
}

for (const viewport of openMenuViewports) {
  const page = await browser.newPage({ viewport });
  await page.goto(`${baseURL}/`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Open menu" }).click();
  await page.getByRole("dialog", { name: "Site navigation" }).waitFor();
  await page.waitForTimeout(600);

  await checkOverflow(page, `menu-open @ ${viewport.width}`);
  const file = `${outDir}/menu-open-${viewport.width}x${viewport.height}.png`;
  await page.screenshot({ path: file }); // viewport shot: the panel is an overlay
  console.log(`✓ menu-open @ ${viewport.width}x${viewport.height}`);
  await page.close();
}

/* ── cart & checkout (Phase 4) ───────────────────────────────────────── */

/**
 * These surfaces need a basket, and honest prices for it, so they are
 * captured against the disposable CART server (port 3002) which serves the
 * production build plus `E2E_PURCHASABLE_FIXTURES=1`. Point CART_BASE_URL at
 * that server (scripts/e2e-cart-server.ts), or the captures are skipped.
 */
const cartBaseURL = process.env.CART_BASE_URL;

if (cartBaseURL) {
  const cartViewports = [
    { width: 320, height: 700 },
    { width: 390, height: 844 },
    { width: 1024, height: 900 },
    { width: 1440, height: 900 },
  ];

  const STORAGE_KEY = "pearl-cart-v1";

  /** Two lines: a simple priced product and one priced option of another. */
  const pricedBasket = [
    { slug: "e2e-sample-meal", variantName: null, quantity: 2, unitPriceCents: 1250 },
    { slug: "e2e-portion-pack", variantName: "Large", quantity: 1, unitPriceCents: 1400 },
  ];

  /** Seeded with a price this customer "saw" earlier, now changed. */
  const priceChangedBasket = [
    { slug: "e2e-sample-meal", variantName: null, quantity: 1, unitPriceCents: 1000 },
  ];

  /** A slug that is well-formed but no longer on the menu. */
  const unresolvableBasket = [
    { slug: "e2e-discontinued-item", variantName: null, quantity: 1, unitPriceCents: 900 },
  ];

  async function seedBasket(page, items) {
    await page.addInitScript(
      ({ key, payload }) => window.localStorage.setItem(key, JSON.stringify(payload)),
      { key: STORAGE_KEY, payload: { version: 1, items } },
    );
  }

  /** Wait for reconciliation to finish so no figure is captured mid-flight. */
  async function settled(page) {
    await page.locator('[data-testid="cart-line"]').first().waitFor({ timeout: 10_000 }).catch(() => {});
    // Wait for the persisted lines to hydrate AND their quote to settle. Merely
    // waiting for a transient “Checking…” node to disappear races if it has not
    // been mounted yet (notably for an unresolvable-only basket).
    await page
      .waitForFunction(
        () => {
          const lines = Array.from(document.querySelectorAll('[data-testid="cart-line"]'));
          if (lines.length === 0) return false;
          const rowResolving = lines.some((line) => /Loading item|Checking/.test(line.textContent ?? ""));
          const summaryResolving = /Checking…/.test(document.body.innerText);
          return !rowResolving && !summaryResolving;
        },
        null,
        { timeout: 10_000 },
      )
      .catch(() => {});
    await page.waitForTimeout(200);
  }

  for (const viewport of cartViewports) {
    /* Drawer: empty */
    {
      const page = await browser.newPage({ viewport });
      await page.goto(`${cartBaseURL}/menu`, { waitUntil: "domcontentloaded" });
      await page.getByRole("heading", { level: 1 }).waitFor();
      await page.getByRole("button", { name: "Open your cart" }).click();
      await page.getByRole("dialog", { name: "Shopping cart" }).waitFor();
      await page.waitForTimeout(500);

      await checkOverflow(page, `cart-drawer-empty @ ${viewport.width}`);
      await page.screenshot({ path: `${outDir}/cart-drawer-empty-${viewport.width}x${viewport.height}.png` });
      console.log(`✓ cart-drawer-empty @ ${viewport.width}x${viewport.height}`);
      await page.close();
    }

    /* Drawer: populated, server-verified */
    {
      const page = await browser.newPage({ viewport });
      await seedBasket(page, pricedBasket);
      await page.goto(`${cartBaseURL}/menu`, { waitUntil: "domcontentloaded" });
      await page.getByRole("heading", { level: 1 }).waitFor();
      await page.getByRole("button", { name: "Open your cart" }).click();
      await page.getByRole("dialog", { name: "Shopping cart" }).waitFor();
      await settled(page);

      await checkOverflow(page, `cart-drawer @ ${viewport.width}`);
      await page.screenshot({ path: `${outDir}/cart-drawer-${viewport.width}x${viewport.height}.png` });
      console.log(`✓ cart-drawer @ ${viewport.width}x${viewport.height}`);
      await page.close();
    }

    /* Drawer: a price the customer has not seen before */
    {
      const page = await browser.newPage({ viewport });
      await seedBasket(page, priceChangedBasket);
      await page.goto(`${cartBaseURL}/menu`, { waitUntil: "domcontentloaded" });
      await page.getByRole("heading", { level: 1 }).waitFor();
      await page.getByRole("button", { name: "Open your cart" }).click();
      await page.getByRole("dialog", { name: "Shopping cart" }).waitFor();
      await settled(page);

      await checkOverflow(page, `cart-drawer-price-change @ ${viewport.width}`);
      await page.screenshot({
        path: `${outDir}/cart-drawer-price-change-${viewport.width}x${viewport.height}.png`,
      });
      console.log(`✓ cart-drawer-price-change @ ${viewport.width}x${viewport.height}`);
      await page.close();
    }

    /* /cart: populated */
    {
      const page = await browser.newPage({ viewport });
      await seedBasket(page, pricedBasket);
      await page.goto(`${cartBaseURL}/cart`, { waitUntil: "domcontentloaded" });
      await page.getByRole("heading", { name: "Order summary" }).waitFor();
      await settled(page);

      await checkOverflow(page, `cart-page @ ${viewport.width}`);
      await page.screenshot({
        path: `${outDir}/cart-page-${viewport.width}x${viewport.height}.png`,
        fullPage: true,
      });
      console.log(`✓ cart-page @ ${viewport.width}x${viewport.height}`);
      await page.close();
    }

    /* /cart: an item that can no longer be resolved */
    {
      const page = await browser.newPage({ viewport });
      await seedBasket(page, unresolvableBasket);
      await page.goto(`${cartBaseURL}/cart`, { waitUntil: "domcontentloaded" });
      await page.getByRole("heading", { name: "Order summary" }).waitFor();
      await settled(page);

      await checkOverflow(page, `cart-page-unresolvable @ ${viewport.width}`);
      await page.screenshot({
        path: `${outDir}/cart-page-unresolvable-${viewport.width}x${viewport.height}.png`,
        fullPage: true,
      });
      console.log(`✓ cart-page-unresolvable @ ${viewport.width}x${viewport.height}`);
      await page.close();
    }

    /* /checkout: review with delivery selected */
    {
      const page = await browser.newPage({ viewport });
      await seedBasket(page, pricedBasket);
      await page.goto(`${cartBaseURL}/checkout`, { waitUntil: "domcontentloaded" });
      await page.getByRole("heading", { name: "Your order" }).waitFor();
      await settled(page);

      await checkOverflow(page, `checkout @ ${viewport.width}`);
      await page.screenshot({
        path: `${outDir}/checkout-${viewport.width}x${viewport.height}.png`,
        fullPage: true,
      });
      console.log(`✓ checkout @ ${viewport.width}x${viewport.height}`);
      await page.close();
    }

    /* /checkout: validation errors after an empty submit attempt */
    {
      const page = await browser.newPage({ viewport });
      await seedBasket(page, pricedBasket);
      await page.goto(`${cartBaseURL}/checkout`, { waitUntil: "domcontentloaded" });
      await page.getByRole("heading", { name: "Your order" }).waitFor();
      await settled(page);

      // Touch every required field so its error is raised, exactly as a
      // customer tabbing through the form would see them.
      for (const label of [/^Full name/, /^Email address/, /^Phone number/]) {
        await page.getByLabel(label).click();
        await page.keyboard.press("Tab");
      }
      await page.getByLabel(/^City or town/).click();
      await page.keyboard.press("Tab");
      await page.waitForTimeout(300);

      await checkOverflow(page, `checkout-validation @ ${viewport.width}`);
      await page.screenshot({
        path: `${outDir}/checkout-validation-${viewport.width}x${viewport.height}.png`,
        fullPage: true,
      });
      console.log(`✓ checkout-validation @ ${viewport.width}x${viewport.height}`);
      await page.close();
    }

    /* /checkout: pickup selected, no address asked for */
    {
      const page = await browser.newPage({ viewport });
      await seedBasket(page, pricedBasket);
      await page.goto(`${cartBaseURL}/checkout`, { waitUntil: "domcontentloaded" });
      await page.getByRole("heading", { name: "Your order" }).waitFor();
      await settled(page);

      await page.getByRole("radio", { name: /Pickup/ }).click();
      await page.waitForTimeout(300);

      await checkOverflow(page, `checkout-pickup @ ${viewport.width}`);
      await page.screenshot({
        path: `${outDir}/checkout-pickup-${viewport.width}x${viewport.height}.png`,
        fullPage: true,
      });
      console.log(`✓ checkout-pickup @ ${viewport.width}x${viewport.height}`);
      await page.close();
    }
  }
} else {
  console.log(
    "Skipping cart/checkout screenshots (start scripts/e2e-cart-server.ts and set CART_BASE_URL to enable).",
  );
}

/* ── admin (Phase 3) ──────────────────────────────────────────────────── */

const adminBaseURL = process.env.ADMIN_BASE_URL;
const adminEmail = process.env.ADMIN_EMAIL;
const adminPassword = process.env.ADMIN_PASSWORD;

if (adminBaseURL && adminEmail && adminPassword) {
  const adminViewports = [
    { width: 360, height: 800 },
    { width: 390, height: 844 },
    { width: 768, height: 1024 },
    { width: 1024, height: 900 },
    { width: 1440, height: 900 },
  ];

  async function adminLogin(browser) {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await page.goto(`${adminBaseURL}/admin/login`, { waitUntil: "domcontentloaded" });
    await page.getByRole("textbox", { name: "Email (required)" }).fill(adminEmail);
    await page.getByRole("textbox", { name: "Password (required)" }).fill(adminPassword);
    await page.getByRole("button", { name: "Sign in" }).click();
    await page.waitForURL(`${adminBaseURL}/admin`, { timeout: 15_000 });
    return page;
  }

  // Admin responses stream, so "networkidle" never settles; wait for a
  // known heading or selector instead.
  async function adminGoto(page, path, { heading, selector }) {
    await page.goto(`${adminBaseURL}${path}`, { waitUntil: "domcontentloaded" });
    if (selector) await page.locator(selector).first().waitFor();
    else await page.getByRole("heading", { level: 1, name: heading }).waitFor();
    await page.waitForTimeout(300); // let fonts/icons settle before capture
  }

  // The sign-in screen (anonymous) at every reference viewport.
  for (const viewport of adminViewports) {
    const page = await browser.newPage({ viewport });
    await page.goto(`${adminBaseURL}/admin/login`, { waitUntil: "domcontentloaded" });
    await page.getByRole("heading", { level: 1, name: "Sign in" }).waitFor();
    await checkOverflow(page, `admin-login @ ${viewport.width}`);
    await page.screenshot({
      path: `${outDir}/admin-login-${viewport.width}x${viewport.height}.png`,
      fullPage: true,
    });
    console.log(`✓ admin-login @ ${viewport.width}x${viewport.height}`);
    await page.close();
  }

  // A signed-in session whose pages we reuse across captures.
  const session = await adminLogin(browser);

  // Which product gets its edit form screenshotted? The first one with
  // photos is the most representative; fall back to the first row.
  await session.goto(`${adminBaseURL}/admin/products`, { waitUntil: "domcontentloaded" });
  await session.getByRole("heading", { level: 1, name: "Products" }).waitFor();
  const firstEditHref = await session
    .locator('a[href*="/admin/products/"][href$="/edit"]')
    .first()
    .getAttribute("href");

  const surfaces = [
    { name: "admin-dashboard", path: "/admin", heading: "Dashboard" },
    { name: "admin-products", path: "/admin/products", heading: "Products" },
    { name: "admin-product-new", path: "/admin/products/new", heading: "Add product" },
    // The edit page's h1 is the product name, so wait for its form instead.
    {
      name: "admin-product-edit",
      path: firstEditHref ?? "/admin/products",
      selector: firstEditHref ? 'button:has-text("Save changes")' : undefined,
      heading: firstEditHref ? undefined : "Products",
    },
    { name: "admin-categories", path: "/admin/categories", heading: "Categories" },
  ];

  for (const surface of surfaces) {
    for (const viewport of adminViewports) {
      await session.setViewportSize(viewport);
      await adminGoto(session, surface.path, surface);
      await checkOverflow(session, `${surface.name} @ ${viewport.width}`);
      await session.screenshot({
        path: `${outDir}/${surface.name}-${viewport.width}x${viewport.height}.png`,
        fullPage: true,
      });
      console.log(`✓ ${surface.name} @ ${viewport.width}x${viewport.height}`);
    }
  }

  // The mobile drawer (admin navigation) at the small viewports.
  for (const viewport of adminViewports.filter((v) => v.width <= 768)) {
    await session.setViewportSize(viewport);
    await adminGoto(session, "/admin", { heading: "Dashboard" });
    await session.getByRole("button", { name: "Open navigation menu" }).click();
    await session.getByRole("dialog", { name: "Admin navigation" }).waitFor();
    await session.waitForTimeout(400);
    await checkOverflow(session, `admin-drawer @ ${viewport.width}`);
    await session.screenshot({
      path: `${outDir}/admin-drawer-${viewport.width}x${viewport.height}.png`,
    });
    console.log(`✓ admin-drawer @ ${viewport.width}x${viewport.height}`);
  }

  // Upload-not-configured state: this stack has no Cloudinary credentials,
  // so the edit form shows the honest "photos cannot be uploaded yet" notice.
  if (firstEditHref) {
    await session.setViewportSize({ width: 1440, height: 900 });
    await adminGoto(session, firstEditHref, {
      selector: 'button:has-text("Save changes")',
    });
    await checkOverflow(session, "admin-upload-not-configured @ 1440");
    await session.screenshot({
      path: `${outDir}/admin-upload-not-configured-1440x900.png`,
      fullPage: true,
    });
    console.log("✓ admin-upload-not-configured @ 1440x900");
  }

  await session.close();
} else {
  console.log(
    "Skipping admin screenshots (set ADMIN_BASE_URL, ADMIN_EMAIL and ADMIN_PASSWORD to enable).",
  );
}

await browser.close();

if (failures > 0) {
  console.error(`\n${failures} capture(s) overflow horizontally.`);
  process.exit(1);
}
console.log(`\nAll screenshots captured in ./${outDir} — no horizontal overflow detected.`);
