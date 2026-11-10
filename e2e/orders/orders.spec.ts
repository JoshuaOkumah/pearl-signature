import {
  expect,
  test,
  type Browser,
  type BrowserContext,
  type Locator,
  type Page,
} from "@playwright/test";
import { E2E_ADMIN_EMAIL, E2E_ADMIN_PASSWORD } from "../admin/credentials";
import {
  CHECKOUT_CODE_SUBJECT,
  E2E_ORDERS_SINK_FILE,
  RECOVERY_CODE_SUBJECT,
} from "./guest-fixture";
import { readLatestCode } from "./otp";

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

async function fillCustomer(page: Page, method: "delivery" | "pickup", email: string): Promise<void> {
  await page.getByLabel(/^Full name/).fill("Ada Okonkwo");
  await page.getByLabel(/^Email address/).fill(email);
  await page.getByLabel(/^Phone number/).fill("(416) 555-0123");
  if (method === "delivery") {
    await page.getByLabel(/^Street address/).fill("100 Queen Street West");
    await page.getByLabel(/^City or town/).fill("Toronto");
    await page.getByLabel(/^Province or territory/).selectOption("ON");
    await page.getByLabel(/^Postal code/).fill("M5H 2N2");
  }
}

/**
 * Complete the mandatory Phase 7B email verification.
 *
 * The code is generated server-side and delivered through the file sink, so it
 * is read from disk rather than from a real inbox. Each test uses a DISTINCT
 * synthetic address: the per-email issuance budget is deliberately small, and a
 * shared address would exhaust it across the suite.
 */
async function verifyCheckoutEmail(page: Page, email: string): Promise<void> {
  const panel = page.getByTestId("email-verification");
  await expect(panel).toBeVisible();
  await panel.getByRole("button", { name: "Send verification code" }).click();
  await expect(
    panel.getByText(`We sent a six digit code to ${email}. It expires in ten minutes.`),
  ).toBeVisible();

  const code = await readLatestCode(email, CHECKOUT_CODE_SUBJECT, E2E_ORDERS_SINK_FILE);
  expect(code).toMatch(/^\d{6}$/);
  await panel.getByLabel("Six digit code").fill(code);
  await panel.getByRole("button", { name: "Verify email" }).click();
  await expect(page.getByTestId("email-verified")).toBeVisible();
}

async function login(page: Page): Promise<void> {
  await page.goto("/admin/login");
  await expect(page.getByRole("heading", { level: 1, name: "Sign in" })).toBeVisible();
  await page.getByRole("textbox", { name: "Email (required)" }).fill(E2E_ADMIN_EMAIL);
  await page.getByRole("textbox", { name: "Password (required)" }).fill(E2E_ADMIN_PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL("/admin");
}

function moneyStat(page: Page, label: string): Locator {
  return page
    .locator('section[aria-label="Money in detail"]')
    .getByText(label, { exact: true })
    .locator("xpath=following-sibling::p[1]");
}

function summaryStat(page: Page, label: string): Locator {
  return page
    .locator('section[aria-label="This week"]')
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
  const email = "ada.delivery@example.test";
  await seedCart(page, [meal(2)]);
  const interceptor = await installPlaceOrderCapture(page);

  await page.goto("/checkout");
  await fillCustomer(page, "delivery", email);
  await verifyCheckoutEmail(page, email);

  // The owner's labelled policy is what makes a truthful total possible.
  await expect(page.getByTestId("area-supported")).toContainText(
    "In the E2E Test Metro delivery area. Delivery fee $7.00 CAD.",
  );
  await expect(page.getByText("E2E test HST")).toBeVisible();
  await expect(page.getByTestId("amount-due")).toHaveText(TOTAL_TWO_MEALS);
  await expect(page.getByText("You pay in full when your order is delivered or collected.")).toBeVisible();
  // No Stripe test configuration exists in this harness, so the online action
  // must be visibly unavailable rather than silently falling back.
  await expect(page.locator("#payment-stripe")).toBeDisabled();

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
  const email = "ada.idempotency@example.test";
  await seedCart(page, [largePortion]);
  const interceptor = await installPlaceOrderCapture(page);

  await page.goto("/checkout");
  await fillCustomer(page, "delivery", email);
  await verifyCheckoutEmail(page, email);
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
  const email = "ada.price@example.test";
  await seedCart(page, [meal(1)]);
  const interceptor = await installPlaceOrderCapture(page, { mangleTotal: true });

  await page.goto("/checkout");
  await fillCustomer(page, "delivery", email);
  await verifyCheckoutEmail(page, email);
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
  await expect(page.getByRole("link", { name: "In progress: 2" })).toBeVisible();
  await page.goto("/admin?view=analytics");
  await expect(summaryStat(page, "All orders")).toHaveText("2");
  await expect(moneyStat(page, "Cash collected")).toHaveText(TOTAL_TWO_MEALS);
  await expect(moneyStat(page, "Cash outstanding")).toHaveText(TOTAL_LARGE);
  await expect(moneyStat(page, "Paid online")).toHaveText("$0.00 CAD");
  await expect(moneyStat(page, "Gross collected")).toHaveText(TOTAL_TWO_MEALS);
  await expect(moneyStat(page, "Confirmed refunds")).toHaveText("$0.00 CAD");
  await expect(moneyStat(page, "Net collected")).toHaveText(TOTAL_TWO_MEALS);
});

/* ── D: lifecycle ───────────────────────────────────────────────────── */

test("D: both lifecycles advance legally and refuse everything else", async ({ page, context }) => {
  /* ── pickup order ─────────────────────────────────────────────── */

  await seedCart(page, [meal(1)]);
  await page.goto("/checkout");
  await page.getByRole("radio", { name: /Pickup/ }).check();
  await fillCustomer(page, "pickup", "ada.pickup@example.test");
  await verifyCheckoutEmail(page, "ada.pickup@example.test");
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
  await expect(page.getByRole("link", { name: "In progress: 1" })).toBeVisible();
  await page.goto("/admin?view=analytics");
  await expect(summaryStat(page, "All orders")).toHaveText("3");
  await expect(moneyStat(page, "Cash collected")).toHaveText(TOTAL_TWO_MEALS);
  await expect(moneyStat(page, "Cash outstanding")).toHaveText(TOTAL_ONE_MEAL_PICKUP);
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
    "This order is not open on this device",
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
  await expect(wrongPage.getByTestId("confirmation-notice")).toContainText(
    "This order is not open on this device",
  );
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
  const email = "ada.ratelimit@example.test";
  await seedCart(page, [meal(1)]);
  await page.goto("/checkout");
  await fillCustomer(page, "delivery", email);
  await verifyCheckoutEmail(page, email);
  await page.locator("#payment-cash").check();
  await page.getByTestId("place-order").click();

  await expect(page.getByTestId("submit-error")).toContainText("Too many order attempts from this connection");
  await expect(page).toHaveURL(/\/checkout/);
  await expect(page.getByTestId("order-confirmation")).toHaveCount(0);
});

test("online payment stays unavailable without explicit Stripe test configuration and cash remains available", async ({ page }) => {
  const email = "ada.online@example.test";
  await seedCart(page, [meal(1)]);
  await page.goto("/checkout");
  await fillCustomer(page, "delivery", email);
  await verifyCheckoutEmail(page, email);

  const cash = page.locator("#payment-cash");
  const online = page.locator("#payment-stripe");
  await expect(cash).toBeEnabled();
  await expect(online).toBeDisabled();
  await expect(page.getByText("Online payment is not available yet. Cash on Arrival remains available.")).toBeVisible();
  await cash.check();
  await expect(page.getByTestId("place-order")).toBeEnabled();
});

/* -- Phase 7B guest journey (A-J) ------------------------------------- */

const GUEST_BASE = "http://localhost:3003";

/**
 * A fresh browser context with its OWN client address.
 *
 * The rate limits are per address, so giving every journey scenario a distinct
 * synthetic address keeps one test from spending another test's budget. It also
 * models the real situation: a customer on another device, not the operator's
 * machine.
 */
async function guestContext(
  browser: Browser,
  ip: string,
  options: {
    viewport?: { width: number; height: number };
    isMobile?: boolean;
    hasTouch?: boolean;
    storageState?: Awaited<ReturnType<BrowserContext["storageState"]>>;
  } = {},
) {
  return browser.newContext({
    baseURL: GUEST_BASE,
    extraHTTPHeaders: { "x-forwarded-for": ip },
    ...options,
  });
}

/** Verify only when this checkout does not already have a fresh proof. */
async function ensureCheckoutVerified(page: Page, email: string): Promise<void> {
  const panel = page.getByTestId("email-verification");
  const verified = page.getByTestId("email-verified");
  await expect(panel.or(verified)).toBeVisible();
  if (await verified.isVisible()) return;
  await verifyCheckoutEmail(page, email);
}

/** Seed a cart, complete the verified checkout and return the new reference. */
async function placeCashOrder(
  page: Page,
  options: { email: string; items: CartLine[]; method: "delivery" | "pickup" },
): Promise<string> {
  await seedCart(page, options.items);
  await page.goto("/checkout");
  if (options.method === "pickup") {
    await page.getByRole("radio", { name: /Pickup/ }).check();
  }
  await fillCustomer(page, options.method, options.email);
  await ensureCheckoutVerified(page, options.email);
  await page.locator("#payment-cash").check();
  await page.getByTestId("place-order").click();
  await expect(page).toHaveURL(/\/order-confirmation\?ref=PS-[0-9A-F]{10}/);
  return new URL(page.url()).searchParams.get("ref") ?? "";
}

/** Email-only recovery from My Orders: request, read the sink, verify. */
async function recoverOrders(page: Page, email: string): Promise<void> {
  await page.goto("/my-orders");
  await expect(page.getByTestId("find-my-orders")).toBeVisible();
  await page.getByLabel("Email address").fill(email);
  await page.getByRole("button", { name: "Email me a code" }).click();
  await expect(page.getByText(/If that address can receive email/)).toBeVisible();

  const code = await readLatestCode(email, RECOVERY_CODE_SUBJECT, E2E_ORDERS_SINK_FILE);
  await page.getByLabel("Six digit code").fill(code);
  await page.getByRole("button", { name: "Show my orders" }).click();
  await expect(page.getByTestId("my-orders")).toBeVisible();
}

async function horizontalOverflow(page: Page): Promise<number> {
  return page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
}

test("J1: the confirmation survives closing and reopening the browser", async ({ browser }) => {
  const email = "journey.reopen@example.test";
  const first = await guestContext(browser, "198.51.100.11");
  const page = await first.newPage();
  const reference = await placeCashOrder(page, {
    email,
    items: [meal(1)],
    method: "delivery",
  });
  await expect(page.getByTestId("order-confirmation")).toBeVisible();

  // The remembered device is a host-only, HttpOnly cookie. The raw token must
  // never be readable from JavaScript, a URL or web storage.
  const cookie = (await first.cookies()).find((entry) => entry.name === "pearl_guest");
  expect(cookie).toBeTruthy();
  expect(cookie?.httpOnly).toBe(true);
  expect(cookie?.sameSite).toBe("Lax");
  expect(cookie?.path).toBe("/");
  expect(cookie?.domain).toBe("localhost");
  const browserStorage = await page.evaluate(() =>
    JSON.stringify({ local: { ...localStorage }, session: { ...sessionStorage } }),
  );
  expect(browserStorage).not.toContain(cookie?.value);
  expect(page.url()).not.toContain(cookie?.value);

  // A genuinely separate lifecycle: sessionStorage is gone, only the persisted
  // cookie store survives.
  const persisted = await first.storageState();
  await first.close();
  const second = await guestContext(browser, "198.51.100.11", { storageState: persisted });
  const reopened = await second.newPage();
  await reopened.goto(`/order-confirmation?ref=${reference}`);
  await expect(reopened.getByTestId("order-confirmation")).toBeVisible();
  await expect(reopened.getByTestId("confirmation-total")).toHaveText(TOTAL_ONE_MEAL_DELIVERED);
  await second.close();
});

test("J2: a different device opens the order only after verifying the email", async ({ browser }) => {
  const email = "journey.device@example.test";
  const owner = await guestContext(browser, "198.51.100.12");
  const ownerPage = await owner.newPage();
  const reference = await placeCashOrder(ownerPage, {
    email,
    items: [meal(1)],
    method: "pickup",
  });
  await owner.close();

  const other = await guestContext(browser, "198.51.100.13");
  const page = await other.newPage();
  await page.goto(`/order-confirmation?ref=${reference}`);
  await expect(page.getByTestId("confirmation-notice")).toContainText(
    "This order is not open on this device",
  );
  await expect(page.getByTestId("order-confirmation")).toHaveCount(0);

  await recoverOrders(page, email);
  await expect(page.getByText(reference)).toBeVisible();
  await page.getByRole("link", { name: /View Order/ }).first().click();
  await expect(page).toHaveURL(new RegExp(`/track\\?ref=${reference}`));
  await expect(page.getByTestId("order-tracking")).toBeVisible();
  await expect(page.getByTestId("tracking-status")).toContainText("received");
  await other.close();
});

test("J3: every order for one verified email appears in My Orders", async ({ browser }) => {
  const email = "journey.multiple@example.test";
  const context = await guestContext(browser, "198.51.100.14");
  const page = await context.newPage();

  const firstReference = await placeCashOrder(page, {
    email,
    items: [meal(2)],
    method: "delivery",
  });
  const secondReference = await placeCashOrder(page, {
    email,
    items: [largePortion],
    method: "pickup",
  });

  await page.goto("/my-orders");
  await expect(page.getByTestId("my-orders")).toBeVisible();
  await expect(page.getByText(firstReference)).toBeVisible();
  await expect(page.getByText(secondReference)).toBeVisible();
  await expect(page.getByTestId("my-orders-email")).toHaveText("j***@example.test");
  await context.close();
});

test("J4: changing the email needs a new code and hides the previous identity", async ({ browser }) => {
  const firstEmail = "journey.first@example.test";
  const secondEmail = "journey.second@example.test";
  const context = await guestContext(browser, "198.51.100.15");
  const page = await context.newPage();

  const firstReference = await placeCashOrder(page, {
    email: firstEmail,
    items: [meal(1)],
    method: "delivery",
  });
  await page.goto("/my-orders");
  await expect(page.getByText(firstReference)).toBeVisible();

  await seedCart(page, [meal(1)]);
  await page.goto("/checkout");
  await fillCustomer(page, "delivery", secondEmail);
  // The address changed, so the previous proof is revoked by construction.
  await expect(page.getByTestId("email-verification")).toBeVisible();
  await verifyCheckoutEmail(page, secondEmail);
  await page.locator("#payment-cash").check();
  await page.getByTestId("place-order").click();
  await expect(page).toHaveURL(/\/order-confirmation\?ref=PS-[0-9A-F]{10}/);
  const secondReference = new URL(page.url()).searchParams.get("ref") ?? "";

  await page.goto("/my-orders");
  await expect(page.getByText(secondReference)).toBeVisible();
  await expect(page.getByText(firstReference)).toHaveCount(0);
  await context.close();
});

test("J5: a shared device switches identity without merging two customers' orders", async ({ browser }) => {
  const firstEmail = "journey.shared.a@example.test";
  const secondEmail = "journey.shared.b@example.test";

  // The second customer orders on their own device first, so there is real
  // history to leak if the shared device got this wrong.
  const secondDevice = await guestContext(browser, "198.51.100.16");
  const secondPage = await secondDevice.newPage();
  const secondReference = await placeCashOrder(secondPage, {
    email: secondEmail,
    items: [meal(1)],
    method: "pickup",
  });
  await secondDevice.close();

  const shared = await guestContext(browser, "198.51.100.17");
  const page = await shared.newPage();
  const firstReference = await placeCashOrder(page, {
    email: firstEmail,
    items: [meal(2)],
    method: "delivery",
  });
  await page.goto("/my-orders");
  await expect(page.getByText(firstReference)).toBeVisible();
  await expect(page.getByText(secondReference)).toHaveCount(0);

  await page.getByRole("button", { name: /Forget this device/ }).click();
  await expect(page.getByTestId("find-my-orders")).toBeVisible();

  // Back and forward must not resurrect the previous identity's history.
  await page.goBack();
  await page.goForward();
  await expect(page.getByTestId("find-my-orders")).toBeVisible();
  await expect(page.getByText(firstReference)).toHaveCount(0);

  await recoverOrders(page, secondEmail);
  await expect(page.getByText(secondReference)).toBeVisible();
  await expect(page.getByText(firstReference)).toHaveCount(0);
  await shared.close();
});

test("J6: admin progress reaches the customer's My Orders and tracking", async ({ browser }) => {
  const email = "journey.progress@example.test";
  const context = await guestContext(browser, "198.51.100.18");
  const page = await context.newPage();
  const reference = await placeCashOrder(page, {
    email,
    items: [meal(1)],
    method: "delivery",
  });

  const adminContext = await browser.newContext({ baseURL: GUEST_BASE });
  const admin = await adminContext.newPage();
  await login(admin);
  await admin.goto(`/admin/orders/${reference}`);
  await admin.getByRole("button", { name: "Mark as confirmed" }).click();
  await expect(admin.getByText("Order marked as confirmed.")).toBeVisible();
  await admin.getByRole("button", { name: "Mark as preparing" }).click();
  await expect(admin.getByText("Order marked as preparing.")).toBeVisible();
  await adminContext.close();

  await page.goto("/my-orders");
  const card = page.getByTestId("my-orders").locator("article", { hasText: reference });
  await expect(card).toContainText("Preparing");
  await card.getByRole("link", { name: /View Order/ }).click();
  await expect(page.getByTestId("order-tracking")).toBeVisible();
  await expect(page.getByTestId("tracking-status")).toContainText("being prepared");
  await context.close();
});

test("J7: Cash on Arrival stays honestly unpaid everywhere", async ({ browser }) => {
  const email = "journey.payment@example.test";
  const context = await guestContext(browser, "198.51.100.19");
  const page = await context.newPage();
  const reference = await placeCashOrder(page, {
    email,
    items: [meal(1)],
    method: "delivery",
  });

  await expect(page.getByText("Nothing has been paid online.")).toBeVisible();
  await expect(page.getByTestId("confirmation-amount-due")).toHaveText(TOTAL_ONE_MEAL_DELIVERED);

  await page.goto("/my-orders");
  const card = page.getByTestId("my-orders").locator("article", { hasText: reference });
  await expect(card).toContainText("Cash on arrival");
  await expect(card).toContainText("Unpaid");
  await context.close();
});

test("J8: a guest cookie grants no admin access and an admin cookie grants no history", async ({ browser }) => {
  const email = "journey.security@example.test";
  const context = await guestContext(browser, "198.51.100.20");
  const page = await context.newPage();
  const interceptor = await installPlaceOrderCapture(page);
  const reference = await placeCashOrder(page, {
    email,
    items: [meal(1)],
    method: "delivery",
  });

  // 1. The guest cookie is not an admin session.
  await page.goto("/admin");
  await expect(page).toHaveURL(/\/admin\/login/);

  // 2. The admin cookie is not a guest identity.
  const adminContext = await browser.newContext({ baseURL: GUEST_BASE });
  const admin = await adminContext.newPage();
  await login(admin);
  await admin.goto("/my-orders");
  await expect(admin.getByTestId("find-my-orders")).toBeVisible();
  await expect(admin.getByTestId("my-orders")).toHaveCount(0);
  await adminContext.close();

  // 3. The captured submission replayed with no remembered device is refused
  //    BEFORE any order is created, even though it carries a real order body.
  const capture = interceptor.captured();
  expect(capture, "the place-order request should be captured").not.toBeNull();
  const attacker = await guestContext(browser, "198.51.100.23");
  const headers: Record<string, string> = { ...(capture as CapturedAction).headers };
  for (const forbidden of ["host", "cookie", "content-length", "connection", "accept-encoding"]) {
    delete headers[forbidden];
  }
  const replay = await attacker.request.post((capture as CapturedAction).url, {
    headers,
    data: (capture as CapturedAction).postData,
  });
  expect(await replay.text()).toContain("verification_required");
  await attacker.close();

  // The real order is still open on the device that placed it.
  await page.goto(`/order-confirmation?ref=${reference}`);
  await expect(page.getByTestId("order-confirmation")).toBeVisible();
  await context.close();
});

test("J9: the whole journey works on a 390px phone without horizontal overflow", async ({ browser }) => {
  const email = "journey.mobile@example.test";
  const context = await guestContext(browser, "198.51.100.21", {
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  const page = await context.newPage();
  await placeCashOrder(page, { email, items: [meal(1)], method: "delivery" });

  await expect(page.getByTestId("order-confirmation")).toBeVisible();
  expect(await horizontalOverflow(page)).toBeLessThanOrEqual(1);

  await page.goto("/my-orders");
  await expect(page.getByTestId("my-orders")).toBeVisible();
  expect(await horizontalOverflow(page)).toBeLessThanOrEqual(1);

  await page.getByRole("link", { name: /View Order/ }).first().click();
  await expect(page.getByTestId("order-tracking")).toBeVisible();
  expect(await horizontalOverflow(page)).toBeLessThanOrEqual(1);
  await context.close();
});

test("J10: recovery for an address with no orders reaches an honest empty state", async ({ browser }) => {
  const email = "journey.empty@example.test";
  const context = await guestContext(browser, "198.51.100.22");
  const page = await context.newPage();

  await page.goto("/my-orders");
  await expect(page.getByTestId("find-my-orders")).toBeVisible();
  // Nothing before verification may confirm whether this address has orders.
  await expect(page.getByText(/If that address can receive email/)).toHaveCount(0);

  await recoverOrders(page, email);
  await expect(page.getByTestId("my-orders-empty")).toBeVisible();
  await expect(page.getByText("You haven't placed any orders yet.")).toBeVisible();
  await expect(page.getByRole("link", { name: /Browse the menu/ })).toBeVisible();
  await context.close();
});
