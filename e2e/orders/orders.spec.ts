import { expect, test, type Locator, type Page } from "@playwright/test";
import { E2E_ADMIN_EMAIL, E2E_ADMIN_PASSWORD } from "../admin/credentials";

/**
 * Phase 5 order suite (orders project, port 3003).
 *
 * The disposable stack behind this project is the only one with a database,
 * a labelled test store configuration and the four synthetic orderable
 * products, so it is where the whole order flow is proven end to end:
 *
 *  A. a guest places a delivery order with Cash on Arrival, the confirmation
 *     opens (and keeps opening after a reload) and the owner sees the order;
 *  B. submitting the SAME intent twice creates ONE order, while a total the
 *     client tried to tamper with on the wire is refused before any order
 *     exists (the server never trusts what the browser claims);
 *  C. Cash on Arrival is recorded once, a second record is refused even
 *     from a window holding a current version token, and the dashboard
 *     counts collected money as paid orders only;
 *  D. pickup and delivery walk their own lifecycle, invalid transitions,
 *     stale version tokens and cancellations without a reason are refused;
 *  E. the confirmation link needs its capability, admin pages and admin
 *     actions re-authorize on every request, and repeated submissions trip
 *     the public rate limiter.
 *
 * The tests build on each other, so they run in serial order: the reference
 * captured in one test is the fixture the next one inspects. Two techniques
 * are used deliberately, because the UI never offers the illegal action:
 *
 *  - hidden form fields are rewritten in the live DOM right before a click
 *    (React reads the form at submit time), which is how an operator's
 *    stale or hostile request is reproduced without any bypass;
 *  - the captured place-order request is re-sent byte for byte through the
 *    API request context, which is how idempotent replay and rate limiting
 *    are exercised.
 */

test.describe.configure({ mode: "serial" });
test.setTimeout(180_000);

const CART_KEY = "pearl-cart-v1";
const CONFIRMATIONS_KEY = "pearl-confirmations-v1";

interface CartLine {
  slug: string;
  variantName: string | null;
  quantity: number;
  unitPriceCents: number;
}

/** One synthetic line, so every test orders something different. */
function meal(quantity: number): CartLine {
  return { slug: "e2e-sample-meal", variantName: null, quantity, unitPriceCents: 1250 };
}
const largePortion: CartLine = {
  slug: "e2e-portion-pack",
  variantName: "Large",
  quantity: 1,
  unitPriceCents: 1400,
};

/*
 * Totals under the labelled test policy ($7.00 delivery, 13% HST on the
 * merchandise subtotal): 2 meals = $35.25, one Large = $22.82, one meal
 * delivered = $21.13, one meal collected = $14.13.
 */
const TOTAL_TWO_MEALS = "$35.25 CAD";
const TOTAL_LARGE = "$22.82 CAD";
const TOTAL_ONE_MEAL_DELIVERED = "$21.13 CAD";
const TOTAL_ONE_MEAL_PICKUP = "$14.13 CAD";

let firstReference = "";
let secondReference = "";
let pickupReference = "";
let storedConfirmations: string | null = null;
let placeOrderCapture: CapturedAction | null = null;

/* ── fixtures and small helpers ─────────────────────────────────────── */

async function seedCart(page: Page, items: CartLine[]): Promise<void> {
  await page.addInitScript(
    ({ key, payload }) => {
      window.localStorage.setItem(key, JSON.stringify(payload));
    },
    { key: CART_KEY, payload: { version: 1, items } },
  );
}

async function fillCustomer(page: Page, method: "delivery" | "pickup"): Promise<void> {
  await page.getByLabel(/^Full name/).fill("Ada Okonkwo");
  await page.getByLabel(/^Email address/).fill("ada.okonkwo@example.com");
  await page.getByLabel(/^Phone number/).fill("(416) 555-0123");
  if (method === "delivery") {
    await page.getByLabel(/^Street address/).fill("100 Queen Street West");
    await page.getByLabel(/^City or town/).fill("Toronto");
    await page.getByLabel(/^Province or territory/).selectOption("ON");
    await page.getByLabel(/^Postal code/).fill("M5H 2N2");
  }
}

async function login(page: Page): Promise<void> {
  await page.goto("/admin/login");
  await expect(page.getByRole("heading", { level: 1, name: "Sign in" })).toBeVisible();
  await page.getByRole("textbox", { name: "Email (required)" }).fill(E2E_ADMIN_EMAIL);
  await page.getByRole("textbox", { name: "Password (required)" }).fill(E2E_ADMIN_PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL("/admin");
}

function orderStat(page: Page, label: string): Locator {
  return page
    .locator('section[aria-label="Order statistics"]')
    .getByText(label, { exact: true })
    .locator("xpath=following-sibling::p[1]");
}

function orderCount(page: Page, expected: string): Locator {
  return page.getByText(new RegExp(`^${expected} orders?$`));
}

/** The status form that offers this transition (its submit button's label). */
function statusButton(page: Page, to: string): Locator {
  return page.locator(`form:has(input[name="to"][value="${to}"])`).getByRole("button");
}

/** The Cash on Arrival recording form (no `to`, so never a status form). */
function paymentForm(page: Page): Locator {
  return page.locator('form:has(input[name="expectedVersion"]):not(:has(input[name="to"]))');
}

/**
 * Run a two-step control: arm it (unless it is already armed), optionally
 * rewrite hidden inputs at the last possible moment, then confirm.
 *
 * The optional hook exists because arming re-renders the control, which
 * resets its own hidden inputs to their prop values. Any DOM edit must
 * therefore happen AFTER arming and BEFORE the confirming press, which is
 * exactly how a hostile or stale request is reproduced.
 */
async function pressTwoStep(
  button: Locator,
  confirmLabel: string,
  beforeSubmit?: () => Promise<void>,
): Promise<void> {
  if ((await button.innerText()).trim() !== confirmLabel) await button.click();
  await expect(button).toHaveText(confirmLabel);
  await beforeSubmit?.();
  await button.click();
}

/** Rewrite a hidden input in the live form, right before it is submitted. */
async function setHiddenValue(scope: Page | Locator, selector: string, value: string): Promise<void> {
  await scope.locator(selector).evaluate((element, next) => {
    const input = element as HTMLInputElement;
    input.value = next;
    input.setAttribute("value", next);
  }, value);
}

/* ── captured place-order requests ──────────────────────────────────── */

interface CapturedAction {
  url: string;
  headers: Record<string, string>;
  postData: Buffer;
  mangled: boolean;
  error: string | null;
}

/**
 * Append a digit to the client's claimed total wherever the encoding puts
 * it (JSON, urlencoded or multipart), so the number the server compares
 * against is no longer the number the customer reviewed.
 */
function mangleExpectedTotal(body: Buffer): { body: Buffer; error: string | null } {
  const text = body.toString("utf8");
  const key = "expectedTotalCents";
  const at = text.indexOf(key);
  if (at < 0) {
    return { body, error: `${key} is missing from the place-order body: ${text.slice(0, 160)}` };
  }
  const search = text.slice(at + key.length);
  const match = /(\d+)/.exec(search);
  if (!match) return { body, error: `no number followed ${key}` };
  const original = match[1];
  const replaced = `${original}1`;
  const start = at + key.length + match.index;
  const patched = text.slice(0, start) + replaced + text.slice(start + original.length);
  if (patched === text) return { body, error: "the mangled total was identical to the original" };
  return { body: Buffer.from(patched, "utf8"), error: null };
}

async function installPlaceOrderCapture(
  page: Page,
  options: { mangleTotal?: boolean } = {},
): Promise<{ captured: () => CapturedAction | null }> {
  const state: { captured: CapturedAction | null } = { captured: null };

  await page.route("**/checkout", async (route) => {
    const request = route.request();
    const body = request.postDataBuffer();
    const isPlaceOrder =
      request.method() === "POST" && body !== null && body.toString("utf8").includes("expectedTotalCents");

    if (!isPlaceOrder) {
      await route.continue();
      return;
    }

    let outgoing = body as Buffer;
    let mangled = false;
    let error: string | null = null;
    if (options.mangleTotal) {
      const result = mangleExpectedTotal(outgoing);
      outgoing = result.body;
      error = result.error;
      mangled = error === null;
    }

    state.captured = {
      url: request.url(),
      headers: await request.allHeaders(),
      postData: outgoing,
      mangled,
      error,
    };
    await route.continue(mangled ? { postData: outgoing } : {});
  });

  return { captured: () => state.captured };
}

/** Re-send a captured place-order request exactly as the browser sent it. */
async function replayPlaceOrder(
  page: Page,
  capture: CapturedAction,
  options: { mangle?: boolean } = {},
): Promise<{ status: number; text: string }> {
  const headers: Record<string, string> = { ...capture.headers };
  for (const forbidden of ["host", "cookie", "content-length", "connection", "accept-encoding"]) {
    delete headers[forbidden];
  }
  const data = options.mangle ? mangleExpectedTotal(capture.postData).body : capture.postData;
  const response = await page.request.post(capture.url, { headers, data });
  return { status: response.status(), text: await response.text() };
}

/* ── A: placement ───────────────────────────────────────────────────── */

test("A: a guest order lands in the database and in the owner's queue", async ({ page }) => {
  await seedCart(page, [meal(2)]);
  const interceptor = await installPlaceOrderCapture(page);

  await page.goto("/checkout");
  await fillCustomer(page, "delivery");

  // The owner's labelled policy is what makes a truthful total possible.
  await expect(page.getByTestId("area-supported")).toContainText(
    "In the E2E Test Metro delivery area. Delivery fee $7.00 CAD.",
  );
  await expect(page.getByText("E2E test HST")).toBeVisible();
  await expect(page.getByTestId("amount-due")).toHaveText(TOTAL_TWO_MEALS);
  await expect(page.getByText("Nothing is paid online.")).toBeVisible();

  await page.locator("#payment-cash").check();
  await page.getByTestId("place-order").click();

  await expect(page).toHaveURL(/\/order-confirmation\?ref=PS-[0-9A-F]{10}/);
  firstReference = new URL(page.url()).searchParams.get("ref") ?? "";
  expect(firstReference).toMatch(/^PS-[0-9A-F]{10}$/);

  // The confirmation is real, priced from the stored snapshot, and still
  // opens after a reload (the capability lives in this tab only).
  await expect(page.getByTestId("order-confirmation")).toBeVisible();
  await expect(page.getByTestId("confirmation-total")).toHaveText(TOTAL_TWO_MEALS);
  await expect(page.getByTestId("confirmation-amount-due")).toHaveText(TOTAL_TWO_MEALS);
  await page.reload();
  await expect(page.getByTestId("order-confirmation")).toBeVisible();
  await expect(page.getByTestId("confirmation-total")).toHaveText(TOTAL_TWO_MEALS);

  storedConfirmations = await page.evaluate((key) => window.sessionStorage.getItem(key), CONFIRMATIONS_KEY);
  expect(storedConfirmations).toContain(firstReference);

  // The submission itself is kept for the idempotency and rate-limit tests.
  placeOrderCapture = interceptor.captured();
  expect(placeOrderCapture, "the Place order request should be captured").not.toBeNull();
  expect(placeOrderCapture?.error).toBeNull();

  await login(page);
  await page.goto("/admin/orders");
  await expect(orderCount(page, "1")).toBeVisible();
  await expect(page.getByRole("row").filter({ hasText: firstReference })).toContainText(TOTAL_TWO_MEALS);
  await expect(page.getByRole("row").filter({ hasText: firstReference })).toContainText("Unpaid");
});

/* ── B: idempotency and price safety ────────────────────────────────── */

test("B1: replaying the same submission keeps one order, not two", async ({ page }) => {
  await seedCart(page, [largePortion]);
  const interceptor = await installPlaceOrderCapture(page);

  await page.goto("/checkout");
  await fillCustomer(page, "delivery");
  await page.locator("#payment-cash").check();
  await page.getByTestId("place-order").click();

  await expect(page).toHaveURL(/\/order-confirmation\?ref=PS-[0-9A-F]{10}/);
  secondReference = new URL(page.url()).searchParams.get("ref") ?? "";
  expect(secondReference).not.toBe(firstReference);

  const capture = interceptor.captured();
  expect(capture, "the Place order request should be captured").not.toBeNull();

  // Identical bytes, identical idempotency key: the server must return the
  // SAME order rather than create a second one.
  const replay = await replayPlaceOrder(page, capture as CapturedAction);
  expect(replay.status).toBe(200);
  expect(replay.text).toContain(secondReference);

  await login(page);
  await page.goto("/admin/orders");
  await expect(orderCount(page, "2")).toBeVisible();
  await expect(page.getByRole("row").filter({ hasText: secondReference })).toContainText(TOTAL_LARGE);
});

test("B2: a total tampered with on the wire is refused before an order exists", async ({ page }) => {
  await seedCart(page, [meal(1)]);
  const interceptor = await installPlaceOrderCapture(page, { mangleTotal: true });

  await page.goto("/checkout");
  await fillCustomer(page, "delivery");
  await page.locator("#payment-cash").check();
  await page.getByTestId("place-order").click();

  // No order: the customer is told the total moved and must acknowledge it.
  const panel = page.getByTestId("price-change");
  await expect(panel).toBeVisible();
  await expect(panel).toContainText("The total changed while you were reviewing it");
  await expect(panel).toContainText("The order was not submitted");
  await expect(panel).toContainText(TOTAL_ONE_MEAL_DELIVERED);
  await expect(page).toHaveURL(/\/checkout/);
  await expect(page.getByText("Review the new total above to continue.")).toBeVisible();
  await expect(page.getByTestId("place-order")).toBeDisabled();

  const capture = interceptor.captured();
  expect(capture, "the tampered Place order request should be captured").not.toBeNull();
  expect(capture?.error).toBeNull();
  expect(capture?.mangled, "the claimed total should have been rewritten on the wire").toBe(true);

  // Acknowledging brings the button back — and still submits nothing by
  // itself, and records no confirmation capability in this tab.
  await panel.getByRole("button", { name: "I have reviewed the new total" }).click();
  await expect(page.getByTestId("price-change")).toHaveCount(0);
  await expect(page.getByTestId("place-order")).toBeEnabled();
  await expect(page).toHaveURL(/\/checkout/);
  expect(await page.evaluate((key) => window.sessionStorage.getItem(key), CONFIRMATIONS_KEY)).toBeNull();
});

/* ── C: Cash on Arrival ─────────────────────────────────────────────── */

test("C: payment is recorded once and counted honestly", async ({ page, context }) => {
  await login(page);
  await page.goto("/admin/orders");
  await expect(orderCount(page, "2")).toBeVisible();

  // A second operator window, opened while the payment is still pending.
  const stale = await context.newPage();
  await stale.goto(`/admin/orders/${firstReference}`);
  await expect(stale.getByRole("button", { name: "Record payment received" })).toBeVisible();

  // Record the money (two presses, like any significant admin action).
  await page.goto(`/admin/orders/${firstReference}`);
  await pressTwoStep(paymentForm(page).getByRole("button"), "Confirm payment received");
  await expect(page.getByText("Payment recorded for this order.")).toBeVisible();
  await expect(page.getByText("Payment for this order has been recorded.")).toBeVisible();

  // The other window still holds a stale token. Rewriting it to the CURRENT
  // version and pressing again must still be refused: the form carries no
  // amount and cannot pay an order twice.
  const currentVersion = await page.locator('input[name="expectedVersion"]').first().inputValue();
  const staleVersionToken =
    'form:has(input[name="expectedVersion"]):not(:has(input[name="to"])) input[name="expectedVersion"]';
  await pressTwoStep(paymentForm(stale).getByRole("button"), "Confirm payment received", () =>
    // Arming re-renders the control, so the token is rewritten afterwards.
    setHiddenValue(stale, staleVersionToken, currentVersion),
  );
  await expect(stale.getByText("Payment has already been recorded for this order.")).toBeVisible();
  await stale.close();

  // Collected money counts PAID orders only; the unpaid one is outstanding.
  await page.goto("/admin");
  await expect(orderStat(page, "Orders")).toHaveText("2");
  await expect(orderStat(page, "In progress")).toHaveText("2");
  await expect(orderStat(page, "Awaiting payment")).toHaveText("1");
  await expect(orderStat(page, "Collected")).toHaveText(TOTAL_TWO_MEALS);
  await expect(orderStat(page, "Outstanding")).toHaveText(TOTAL_LARGE);
});

/* ── D: lifecycle ───────────────────────────────────────────────────── */

test("D: both lifecycles advance legally and refuse everything else", async ({ page, context }) => {
  /* ── pickup order ─────────────────────────────────────────────── */

  await seedCart(page, [meal(1)]);
  await page.goto("/checkout");
  await page.getByRole("radio", { name: /Pickup/ }).check();
  await fillCustomer(page, "pickup");
  await expect(page.getByTestId("pickup-fields")).toContainText("Labelled E2E test pickup point");
  await expect(page.getByTestId("amount-due")).toHaveText(TOTAL_ONE_MEAL_PICKUP);
  await page.locator("#payment-cash").check();
  await page.getByTestId("place-order").click();

  await expect(page).toHaveURL(/\/order-confirmation\?ref=PS-[0-9A-F]{10}/);
  pickupReference = new URL(page.url()).searchParams.get("ref") ?? "";
  expect(pickupReference).not.toBe(firstReference);

  await login(page);
  await page.goto(`/admin/orders/${pickupReference}`);
  await expect(page.getByText("Current status: Placed. Pickup order.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Mark as out for delivery" })).toHaveCount(0);

  // A hostile operator rewrites the target to a state this order cannot
  // reach from where it stands.
  await setHiddenValue(page, 'input[name="to"][value="confirmed"]', "out_for_delivery");
  await page.getByRole("button", { name: "Mark as confirmed" }).click();
  await expect(page.getByText("An order cannot go from Placed to Out for delivery.")).toBeVisible();
  await expect(page.getByText("Current status: Placed. Pickup order.")).toBeVisible();

  await page.reload();
  await page.getByRole("button", { name: "Mark as confirmed" }).click();
  await expect(page.getByText("Order marked as confirmed.")).toBeVisible();
  await page.getByRole("button", { name: "Mark as preparing" }).click();
  await expect(page.getByText("Order marked as preparing.")).toBeVisible();

  // The edge exists (preparing -> out for delivery) but not for a pickup
  // order: this is the method-aware refusal.
  await setHiddenValue(page, 'input[name="to"][value="ready_for_pickup"]', "out_for_delivery");
  await page.getByRole("button", { name: "Mark as ready for pickup" }).click();
  await expect(page.getByText("Only delivery orders can be marked out for delivery.")).toBeVisible();
  await expect(page.getByText("Current status: Preparing. Pickup order.")).toBeVisible();

  await page.reload();

  // A stale version token (this window claims an older order state).
  await setHiddenValue(
    page,
    'form:has(input[name="to"][value="ready_for_pickup"]) input[name="expectedVersion"]',
    "1",
  );
  await page.getByRole("button", { name: "Mark as ready for pickup" }).click();
  await expect(
    page.getByText("This order changed while you were viewing it. Reload the page to see the current state."),
  ).toBeVisible();

  await page.reload();
  await page.getByRole("button", { name: "Mark as ready for pickup" }).click();
  await expect(page.getByText("Order marked as ready for pickup.")).toBeVisible();
  await expect(page.getByText("Current status: Ready for pickup. Pickup order.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Mark as out for delivery" })).toHaveCount(0);

  /* ── delivery order (paid in C) ───────────────────────────────── */

  await page.goto(`/admin/orders/${firstReference}`);
  await expect(page.getByText("Current status: Placed. Delivery order.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Mark as ready for pickup" })).toHaveCount(0);

  await page.getByRole("button", { name: "Mark as confirmed" }).click();
  await expect(page.getByText("Order marked as confirmed.")).toBeVisible();
  await page.getByRole("button", { name: "Mark as preparing" }).click();
  await expect(page.getByText("Order marked as preparing.")).toBeVisible();
  await page.getByRole("button", { name: "Mark as out for delivery" }).click();
  await expect(page.getByText("Order marked as out for delivery.")).toBeVisible();

  // A second window, opened while the order was still on the road.
  const stale = await context.newPage();
  await stale.goto(`/admin/orders/${firstReference}`);
  await expect(stale.getByRole("button", { name: "Mark as completed" })).toBeVisible();

  await pressTwoStep(statusButton(page, "completed"), "Confirm completed");
  await expect(page.getByText("Order marked as completed.")).toBeVisible();
  await expect(page.getByText("This order is finished. Its status cannot change again.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Mark as ready for pickup" })).toHaveCount(0);

  // The stale window cannot reopen a finished order. It arms its own
  // control first (which keeps the target intact), then the hostile target
  // is written into the live DOM, so the confirmation press sends
  // `preparing` for an order that is already completed. The version token is
  // advanced by the one completion that happened since this window opened,
  // which isolates the terminal-state rule from the concurrency rule.
  const completedForm = 'form:has(input[name="to"][value="completed"])';
  const hostileButton = statusButton(stale, "completed");
  const staleToken = Number(
    await stale.locator(`${completedForm} input[name="expectedVersion"]`).inputValue(),
  );
  expect(staleToken).toBeGreaterThan(0);
  await hostileButton.click();
  await expect(hostileButton).toHaveText("Confirm completed");
  await setHiddenValue(stale, `${completedForm} input[name="expectedVersion"]`, String(staleToken + 1));
  await setHiddenValue(stale, 'input[name="to"][value="completed"]', "preparing");
  await stale.getByRole("button", { name: "Confirm completed" }).click();
  await expect(stale.getByText("This order is already completed. Its status cannot change again.")).toBeVisible();
  await stale.close();

  /* ── cancellation needs a reason ──────────────────────────────── */

  await page.goto(`/admin/orders/${secondReference}`);
  await pressTwoStep(statusButton(page, "cancelled"), "Confirm cancellation");
  await expect(page.getByText("Add a reason for cancelling this order")).toBeVisible();

  await page.getByLabel("Cancellation reason").fill("Customer asked to cancel this test order.");
  await pressTwoStep(statusButton(page, "cancelled"), "Confirm cancellation");
  await expect(page.getByText("The order has been cancelled.")).toBeVisible();
  await expect(page.getByText("Customer asked to cancel this test order.").first()).toBeVisible();

  // A cancelled unpaid order is nobody's outstanding money any more.
  await page.goto("/admin");
  await expect(orderStat(page, "Orders")).toHaveText("3");
  await expect(orderStat(page, "In progress")).toHaveText("1");
  await expect(orderStat(page, "Awaiting payment")).toHaveText("1");
  await expect(orderStat(page, "Collected")).toHaveText(TOTAL_TWO_MEALS);
  await expect(orderStat(page, "Outstanding")).toHaveText(TOTAL_ONE_MEAL_PICKUP);
});

/* ── E: security ────────────────────────────────────────────────────── */

test("E1: the confirmation link is worthless without its capability", async ({ browser }) => {
  const url = `/order-confirmation?ref=${firstReference}`;
  expect(storedConfirmations, "test A should have stored a confirmation capability").toBeTruthy();

  // 1. The reference alone opens nothing: no order, no name, no totals.
  const bare = await browser.newContext();
  const barePage = await bare.newPage();
  await barePage.goto(url);
  await expect(barePage.getByTestId("confirmation-notice")).toContainText(
    "This confirmation can only be opened where the order was placed",
  );
  await expect(barePage.getByTestId("order-confirmation")).toHaveCount(0);
  await bare.close();

  // 2. A wrong capability is indistinguishable from an unknown reference.
  const wrong = await browser.newContext();
  await wrong.addInitScript(
    ({ key, reference }) => {
      window.sessionStorage.setItem(
        key,
        JSON.stringify([{ reference, key: "0".repeat(64), at: Date.now() }]),
      );
    },
    { key: CONFIRMATIONS_KEY, reference: firstReference },
  );
  const wrongPage = await wrong.newPage();
  await wrongPage.goto(url);
  await expect(wrongPage.getByTestId("confirmation-notice")).toContainText("We could not find that order");
  await expect(wrongPage.getByTestId("order-confirmation")).toHaveCount(0);
  await wrong.close();

  // 3. The device that placed the order keeps working, on this order only.
  const owner = await browser.newContext();
  await owner.addInitScript(
    ({ key, value }) => {
      window.sessionStorage.setItem(key, value);
    },
    { key: CONFIRMATIONS_KEY, value: storedConfirmations as string },
  );
  const ownerPage = await owner.newPage();
  await ownerPage.goto(url);
  await expect(ownerPage.getByTestId("order-confirmation")).toBeVisible();
  await expect(ownerPage.getByTestId("confirmation-total")).toHaveText(TOTAL_TWO_MEALS);
  await owner.close();
});

test("E2: admin pages and admin actions re-authorize every request", async ({ page, context }) => {
  for (const path of ["/admin", "/admin/orders", `/admin/orders/${pickupReference}`]) {
    await page.goto(path);
    await expect(page).toHaveURL(/\/admin\/login/);
  }

  // A signed-in operator is dropped mid-session: the button is still on
  // screen, but the SERVER must refuse the request it sends.
  await login(page);
  await page.goto(`/admin/orders/${pickupReference}`);
  const button = statusButton(page, "completed");
  await button.click();
  await expect(button).toHaveText("Confirm completed");

  await context.clearCookies();
  const actionResponse = page.waitForResponse(
    (response) => response.request().method() === "POST" && Boolean(response.request().headers()["next-action"]),
  );
  await button.click();

  const body = await (await actionResponse).text();
  expect(body).toContain("Your session has expired. Please sign in again.");
  await expect(page).toHaveURL(/\/admin\/login/);
});

test("E3: repeated order submissions are rate limited", async ({ page }) => {
  expect(placeOrderCapture, "test A should have captured a place-order request").not.toBeNull();

  // Burn the remaining attempt budget with the captured body until the
  // limiter answers. The bucket is a 15-minute wall-clock window, so the
  // loop tolerates a rollover instead of assuming a fixed count.
  let limited = false;
  for (let attempt = 0; attempt < 25 && !limited; attempt += 1) {
    const replay = await replayPlaceOrder(page, placeOrderCapture as CapturedAction, { mangle: true });
    limited = replay.text.includes("rate_limited");
  }
  expect(limited, "the create limiter should trip within 25 attempts").toBe(true);

  // The real customer-facing flow says so plainly and submits nothing.
  await seedCart(page, [meal(1)]);
  await page.goto("/checkout");
  await fillCustomer(page, "delivery");
  await page.locator("#payment-cash").check();
  await page.getByTestId("place-order").click();

  await expect(page.getByTestId("submit-error")).toContainText("Too many order attempts from this connection");
  await expect(page).toHaveURL(/\/checkout/);
  await expect(page.getByTestId("order-confirmation")).toHaveCount(0);
});
