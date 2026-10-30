import { readFile } from "node:fs/promises";
import path from "node:path";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { E2E_ADMIN_EMAIL, E2E_ADMIN_PASSWORD } from "../admin/credentials";
import {
  TRACKING_CAPABILITY,
  TRACKING_CONFIRMATIONS_KEY,
  TRACKING_EMAIL,
  TRACKING_PROCESSOR_SECRET,
  TRACKING_REFERENCE,
  TRACKING_SINK_FILE,
} from "../orders/tracking-fixture";

/**
 * Phase 7 tracking suite (tracking project, port 3004).
 *
 * This project has its own disposable database and ONE seeded order (see
 * `e2e/orders/tracking-fixture.ts` and `scripts/e2e-orders-server.ts` with
 * `E2E_TRACKING_FIXTURE=1`), so it never disturbs the Phase 5 order counts or
 * the shared `order.create` rate-limit budget.
 *
 * Covered:
 *
 *  A. the same browser opens the order with the Phase 5 capability, with the
 *     pickup timeline, honest Cash on Arrival copy and a noindex page;
 *  B. the reference alone opens nothing and offers email recovery;
 *  C. a wrong capability is indistinguishable from an unknown order;
 *  D. cross-device recovery: request a code, read it from the file sink, verify
 *     it, and keep access after a reload (grant in sessionStorage);
 *  E. a wrong code is refused, and the per-challenge attempt cap stops even a
 *     correct code afterwards;
 *  F. a non-matching reference/email pair answers generically and emails
 *     nothing (no enumeration);
 *  G. the admin notification page reports readiness without secrets, and the
 *     processor route refuses an unauthenticated call but drains the queue with
 *     the configured bearer secret;
 *  H. manual Refresh shows the CURRENT status after an admin change and never
 *     a stale one.
 *
 * Polling itself (30s, visibility-aware, stops at terminal) is covered by the
 * Vitest matrix and the manual checklist; waiting 30s in CI would only add
 * flakiness without proving anything the manual Refresh test does not.
 */

test.describe.configure({ mode: "serial" });
test.setTimeout(180_000);

const SINK_PATH = path.resolve(process.cwd(), TRACKING_SINK_FILE);
const CODE_SUBJECT = "Your PEARL Signature tracking code";
const PREPARING_SUBJECT = `Order ${TRACKING_REFERENCE} is being prepared`;

interface SinkMessage {
  to?: string;
  subject?: string;
  text?: string;
}

async function sinkMessages(): Promise<SinkMessage[]> {
  try {
    const raw = await readFile(SINK_PATH, "utf8");
    return raw
      .split("\n")
      .filter((line) => line.trim() !== "")
      .map((line) => JSON.parse(line) as SinkMessage);
  } catch {
    return [];
  }
}

/** Wait for the newest tracking code emailed to this address and return it. */
async function readCodeFor(email: string): Promise<string> {
  const deadline = Date.now() + 15_000;
  for (;;) {
    const messages = (await sinkMessages()).filter(
      (message) => message.to === email && message.subject === CODE_SUBJECT,
    );
    const latest = messages.at(-1);
    const code = latest?.text ? /\b\d{6}\b/.exec(latest.text)?.[0] : undefined;
    if (code) return code;
    if (Date.now() >= deadline) throw new Error(`No tracking code was written to ${SINK_PATH}`);
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
}

async function seedCapability(page: Page): Promise<void> {
  await page.addInitScript(
    ({ key, reference, capability }) => {
      window.sessionStorage.setItem(
        key,
        JSON.stringify([{ reference, key: capability, at: Date.now() }]),
      );
    },
    { key: TRACKING_CONFIRMATIONS_KEY, reference: TRACKING_REFERENCE, capability: TRACKING_CAPABILITY },
  );
}

async function login(page: Page): Promise<void> {
  await page.goto("/admin/login");
  await expect(page.getByRole("heading", { level: 1, name: "Sign in" })).toBeVisible();
  await page.getByRole("textbox", { name: "Email (required)" }).fill(E2E_ADMIN_EMAIL);
  await page.getByRole("textbox", { name: "Password (required)" }).fill(E2E_ADMIN_PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL("/admin");
}

function statusButton(page: Page, to: string): Locator {
  return page.locator(`form:has(input[name="to"][value="${to}"])`).getByRole("button");
}

async function requestCode(page: Page, reference = TRACKING_REFERENCE, email = TRACKING_EMAIL) {
  const recovery = page.getByTestId("tracking-recovery");
  await expect(recovery).toBeVisible();
  await recovery.getByLabel("Order reference").fill(reference);
  await recovery.getByLabel("Email on the order").fill(email);
  await recovery.getByRole("button", { name: "Email me a code" }).click();
  await expect(
    recovery.getByText("If that email matches an order, a six digit code is on its way."),
  ).toBeVisible();
}

/* ── A: same-browser access ─────────────────────────────────────────── */

test("A: the device that holds the capability sees the order and its timeline", async ({ browser }) => {
  const context = await browser.newContext();
  const page = await context.newPage();
  await seedCapability(page);

  await page.goto(`/track?ref=${TRACKING_REFERENCE}`);

  const view = page.getByTestId("order-tracking");
  await expect(view).toBeVisible();
  await expect(view.getByText(TRACKING_REFERENCE)).toBeVisible();
  await expect(page.getByTestId("tracking-status")).toHaveText("Your order is being prepared.");
  await expect(page.getByText("Now", { exact: true })).toBeVisible();

  // Pickup path, not the delivery one.
  await expect(view.getByText("Ready for pickup", { exact: true })).toBeVisible();
  await expect(view.getByText("Out for delivery", { exact: true })).toHaveCount(0);

  // Cash on Arrival is not called paid before collection is recorded.
  await expect(page.getByTestId("tracking-payment")).toContainText("Cash on arrival");
  await expect(page.getByTestId("tracking-payment")).toContainText(
    "Payment is due when the order is delivered or collected.",
  );
  await expect(page.getByTestId("tracking-total")).toHaveText("$14.13 CAD");

  await expect(
    page.getByText("This order is open because this browser holds the private confirmation for it."),
  ).toBeVisible();

  // Personal page: never indexable.
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /nofollow/);

  await context.close();
});

/* ── B/C: reference alone and wrong capability ──────────────────────── */

test("B: the reference alone opens nothing", async ({ browser }) => {
  const context = await browser.newContext();
  const page = await context.newPage();

  await page.goto(`/track?ref=${TRACKING_REFERENCE}`);

  await expect(page.getByTestId("tracking-notice")).toContainText("This order needs private access");
  await expect(page.getByTestId("order-tracking")).toHaveCount(0);
  await expect(page.getByText(TRACKING_REFERENCE)).toHaveCount(0);
  await expect(page.getByTestId("tracking-recovery")).toBeVisible();

  await context.close();
});

test("C: a wrong capability is indistinguishable from an unknown order", async ({ browser }) => {
  const context = await browser.newContext();
  await context.addInitScript(
    ({ key, reference }) => {
      window.sessionStorage.setItem(
        key,
        JSON.stringify([{ reference, key: "0".repeat(64), at: Date.now() }]),
      );
    },
    { key: TRACKING_CONFIRMATIONS_KEY, reference: TRACKING_REFERENCE },
  );
  const page = await context.newPage();

  await page.goto(`/track?ref=${TRACKING_REFERENCE}`);

  await expect(page.getByTestId("tracking-notice")).toContainText("We could not open that order");
  await expect(page.getByTestId("order-tracking")).toHaveCount(0);
  await expect(page.getByText(TRACKING_REFERENCE)).toHaveCount(0);

  await context.close();
});

/* ── D: cross-device recovery ───────────────────────────────────────── */

test("D: a verified email code opens the order on another device and survives a reload", async ({ browser }) => {
  const context = await browser.newContext();
  const page = await context.newPage();

  await page.goto(`/track?ref=${TRACKING_REFERENCE}`);
  await requestCode(page);

  const code = await readCodeFor(TRACKING_EMAIL);
  expect(code).toMatch(/^\d{6}$/);

  await page.getByLabel("Six digit code").fill(code);
  await page.getByRole("button", { name: "Open this order" }).click();

  await expect(page.getByTestId("order-tracking")).toBeVisible();
  await expect(page.getByTestId("tracking-status")).toHaveText("Your order is being prepared.");
  await expect(
    page.getByText("This order is open because the email address on it was verified on this device."),
  ).toBeVisible();

  // The scoped grant lives in this tab's sessionStorage, so a reload keeps it.
  await page.reload();
  await expect(page.getByTestId("order-tracking")).toBeVisible();
  await expect(page.getByText(TRACKING_REFERENCE)).toBeVisible();

  await context.close();
});

/* ── E: wrong code and the attempt cap ──────────────────────────────── */

test("E: a wrong code is refused and the attempt cap stops even the right one", async ({ browser }) => {
  const context = await browser.newContext();
  const page = await context.newPage();

  await page.goto(`/track?ref=${TRACKING_REFERENCE}`);
  await requestCode(page);
  const code = await readCodeFor(TRACKING_EMAIL);

  const codeField = page.getByLabel("Six digit code");
  const submit = page.getByRole("button", { name: "Open this order" });

  for (let attempt = 0; attempt < 5; attempt += 1) {
    await codeField.fill("000000");
    await submit.click();
    await expect(submit).toBeEnabled();
    await expect(page.getByText("That code is invalid or has expired.")).toBeVisible();
  }

  // The challenge is exhausted: the real code no longer opens anything.
  await codeField.fill(code);
  await submit.click();
  await expect(submit).toBeEnabled();
  await expect(page.getByText("That code is invalid or has expired.")).toBeVisible();
  await expect(page.getByTestId("order-tracking")).toHaveCount(0);

  await context.close();
});

/* ── F: no enumeration ──────────────────────────────────────────────── */

test("F: a non-matching pair answers generically and emails nothing", async ({ browser }) => {
  const context = await browser.newContext();
  const page = await context.newPage();
  const missingReference = "PS-0000000000";

  await page.goto("/track");
  await expect(page.getByTestId("tracking-recovery")).toBeVisible();
  await expect(page.getByTestId("order-tracking")).toHaveCount(0);

  const before = (await sinkMessages()).filter((message) => message.subject === CODE_SUBJECT).length;

  await requestCode(page, missingReference, TRACKING_EMAIL);

  // Give a wrongly-triggered send time to land, then prove none did.
  await page.waitForTimeout(1_500);
  const after = (await sinkMessages()).filter((message) => message.subject === CODE_SUBJECT).length;
  expect(after).toBe(before);

  // The same neutral answer covers a reference that does not exist.
  await page.goto(`/track?ref=${missingReference}`);
  await expect(page.getByTestId("tracking-notice")).toContainText("This order needs private access");

  await context.close();
});

/* ── G: admin observability and the guarded processor ───────────────── */

test("G: admin readiness never leaks secrets and the processor is guarded", async ({ page }) => {
  await login(page);

  // No bearer secret: the route refuses before touching the queue.
  const unauthorized = await page.request.post("/api/notifications/process");
  expect(unauthorized.status()).toBe(401);

  // The harness seeds one due entry and nothing has kicked a scan yet, so this
  // call is deterministic: the configured secret drains exactly that entry.
  const authorized = await page.request.post("/api/notifications/process", {
    headers: { authorization: `Bearer ${TRACKING_PROCESSOR_SECRET}` },
  });
  expect(authorized.status()).toBe(200);
  const body = (await authorized.json()) as { processed: number; sent: number; quotaBlocked: boolean };
  expect(body.processed).toBeGreaterThanOrEqual(1);
  expect(body.sent).toBeGreaterThanOrEqual(1);
  expect(body.quotaBlocked).toBe(false);

  // The delivered message went to the file sink, not to a real inbox.
  const delivered = (await sinkMessages()).filter(
    (message) => message.to === TRACKING_EMAIL && message.subject === PREPARING_SUBJECT,
  );
  expect(delivered.length).toBeGreaterThanOrEqual(1);

  // An admin status change enqueues its own event; the background kick may
  // deliver it before the page is read, which is exactly the intended design.
  await page.goto(`/admin/orders/${TRACKING_REFERENCE}`);
  await page.getByRole("button", { name: "Mark as ready for pickup" }).click();
  await expect(page.getByText("Order marked as ready for pickup.")).toBeVisible();

  await page.goto("/admin/notifications");
  await expect(page.getByRole("heading", { level: 1, name: "Notifications" })).toBeVisible();
  await expect(page.getByText("Delivery readiness")).toBeVisible();
  await expect(page.getByText("file-sink").first()).toBeVisible();
  await expect(page.getByText("order.preparing").first()).toBeVisible();
  await expect(page.getByText(TRACKING_REFERENCE).first()).toBeVisible();

  // The page reports what is configured, never the configured values.
  const html = await page.content();
  expect(html).not.toContain(TRACKING_PROCESSOR_SECRET);
});

/* ── H: manual refresh ──────────────────────────────────────────────── */

test("H: Refresh shows the current status after an admin change, never a stale one", async ({ browser, page }) => {
  const context = await browser.newContext();
  const tracking = await context.newPage();
  await seedCapability(tracking);
  await tracking.goto(`/track?ref=${TRACKING_REFERENCE}`);
  await expect(tracking.getByTestId("tracking-status")).toHaveText("Your order is ready for pickup.");

  // Complete the order in the admin while the tracking tab stays open.
  await login(page);
  await page.goto(`/admin/orders/${TRACKING_REFERENCE}`);
  const complete = statusButton(page, "completed");
  await complete.click();
  await expect(complete).toHaveText("Confirm completed");
  await complete.click();
  await expect(page.getByText("Order marked as completed.")).toBeVisible();

  await tracking.getByRole("button", { name: "Refresh" }).click();
  await expect(tracking.getByTestId("tracking-status")).toHaveText("Your order is complete.");
  // A finished order has no current step and no "Now" badge.
  await expect(tracking.getByText("Now", { exact: true })).toHaveCount(0);

  await context.close();
});
