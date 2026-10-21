import { expect, test } from "@playwright/test";

test.describe("PEARL Signature — smoke", () => {
  test("homepage renders the hero and key sections", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Authentic Nigerian flavours");
    await expect(page.getByRole("heading", { name: "Everything a Nigerian table loves" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Good to know" })).toBeVisible();
  });

  test("menu page filters products by category", async ({ page }) => {
    await page.goto("/menu");
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Explore the PEARL Signature menu");
    await expect(page.getByText("Egusi Soup")).toBeVisible();

    await page.getByRole("button", { name: /Drinks/ }).click();

    await expect(page.getByText("Zobo")).toBeVisible();
    await expect(page.getByText("Egusi Soup")).toHaveCount(0);
  });

  test("about and contact routes render", async ({ page }) => {
    await page.goto("/about");
    await expect(page.getByRole("heading", { level: 1 })).toContainText("premium online kitchen");

    await page.goto("/contact");
    await expect(page.getByRole("heading", { level: 1 })).toContainText("hear from you");
  });

  test("mobile navigation opens and closes with Escape", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/");

    await page.getByRole("button", { name: "Open menu" }).click();
    const nav = page.getByRole("navigation", { name: "Mobile" });
    await expect(nav).toBeVisible();

    await page.keyboard.press("Escape");
    await expect(nav).toHaveCount(0);
  });

  test("respects prefers-reduced-motion", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/");

    // Native smooth scrolling must be disabled under reduced motion.
    const scrollBehavior = await page.evaluate(() => getComputedStyle(document.documentElement).scrollBehavior);
    expect(scrollBehavior).toBe("auto");

    // Reveal content must still become fully visible (opacity settles without animation).
    const heading = page.getByRole("heading", { name: "Good to know" });
    await heading.scrollIntoViewIfNeeded();
    await expect
      .poll(() => heading.evaluate((el) => getComputedStyle(el).opacity), { timeout: 2000 })
      .toBe("1");
  });
});
