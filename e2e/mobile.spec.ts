import { expect, test, type Page } from "@playwright/test";

/**
 * Phase 1B regression suite: the mobile navigation, layout, contrast and
 * copy defects found in the manual audit are encoded here so they cannot
 * silently return. Assertions use real browser geometry (bounding boxes,
 * hit-testing, computed styles), not just "element exists" checks.
 */

const MOBILE = [
  { width: 320, height: 568 },
  { width: 360, height: 800 },
  { width: 390, height: 844 },
  { width: 430, height: 932 },
  { width: 667, height: 375 }, // phone landscape below the md breakpoint
];

const ROUTES = ["/", "/menu", "/about", "/contact"];

/* ── helpers ────────────────────────────────────────────────────────── */

function horizontalOverflow(page: Page) {
  return page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
}

function panelRect(page: Page) {
  return page.locator("#mobile-navigation").evaluate((el) => {
    const r = el.getBoundingClientRect();
    return { x: r.x, y: r.y, w: r.width, h: r.height };
  });
}

/** Resolves the element that would receive a click at the control's centre. */
function hitTest(page: Page, selector: string) {
  return page.locator(selector).evaluate((el) => {
    const r = el.getBoundingClientRect();
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return {
      target: el.getAttribute("aria-label") ?? el.tagName,
      hitInsideTarget: !!hit && (hit === el || el.contains(hit)),
      hitTag: hit?.tagName ?? null,
    };
  });
}

/* ── 1. layout: no overflow, controls intact at every mobile width ──── */

for (const viewport of MOBILE) {
  test(`layout holds at ${viewport.width}×${viewport.height}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    for (const route of ROUTES) {
      await page.goto(route);
      expect(await horizontalOverflow(page), `horizontal overflow on ${route}`).toBe(0);
    }

    await page.goto("/");
    // The hamburger must never be crushed below its 44px tap target.
    const burger = page.getByRole("button", { name: "Open menu" });
    const box = (await burger.boundingBox())!;
    expect(box.width).toBeGreaterThanOrEqual(44);
    expect(box.height).toBeGreaterThanOrEqual(44);

    // Header controls must not collide: wordmark ends before the burger starts.
    const wordmark = page.getByRole("banner").getByRole("link", { name: "PEARL Signature, home page" });
    const wordmarkBox = (await wordmark.boundingBox())!;
    expect(wordmarkBox.x + wordmarkBox.width).toBeLessThanOrEqual(box.x);

    // The desktop CTA must not appear on mobile widths.
    await expect(page.locator("header").getByRole("link", { name: "Explore Menu" })).toHaveCount(0);

    // Major content must be inside the viewport.
    const h1 = page.getByRole("heading", { level: 1 });
    const h1Box = (await h1.boundingBox())!;
    expect(h1Box.x).toBeGreaterThanOrEqual(0);
    expect(h1Box.x + h1Box.width).toBeLessThanOrEqual(viewport.width + 1);
  });
}

/* ── 2. mobile menu: opens, covers, closes reliably ─────────────────── */

for (const viewport of MOBILE) {
  test(`mobile menu is usable at ${viewport.width}×${viewport.height}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.goto("/");

    await page.getByRole("button", { name: "Open menu" }).click();
    const dialog = page.getByRole("dialog", { name: "Site navigation" });
    await expect(dialog).toBeVisible();

    // The panel must resolve against the viewport (the Phase 1B bug collapsed
    // it into the 72px header box via the header's backdrop-filter).
    const rect = await panelRect(page);
    expect(Math.round(rect.w)).toBe(viewport.width);
    expect(Math.round(rect.h)).toBe(viewport.height);
    expect(Math.round(rect.y)).toBe(0);

    // Scroll is locked while open.
    expect(await page.evaluate(() => getComputedStyle(document.body).overflow)).toBe("hidden");

    // The X close button must be visible, ≥44px, topmost (not covered) and
    // actually receive the click.
    const close = dialog.getByRole("button", { name: "Close menu" });
    await expect(close).toBeVisible();
    const closeBox = (await close.boundingBox())!;
    expect(closeBox.width).toBeGreaterThanOrEqual(44);
    expect(closeBox.height).toBeGreaterThanOrEqual(44);
    expect(await hitTest(page, "#mobile-navigation [aria-label='Close menu']")).toMatchObject({
      hitInsideTarget: true,
    });

    // Nav links must not overlap the X (no intersecting bounding boxes).
    const links = await dialog.locator("nav a").all();
    for (const link of links) {
      const lb = (await link.boundingBox())!;
      const overlaps =
        lb.x < closeBox.x + closeBox.width &&
        lb.x + lb.width > closeBox.x &&
        lb.y < closeBox.y + closeBox.height &&
        lb.y + lb.height > closeBox.y;
      expect(overlaps, "a menu link intersects the close button").toBe(false);
    }

    await close.click();
    await expect(dialog).toHaveCount(0);
    expect(await page.evaluate(() => document.body.style.overflow)).toBe("");
  });
}

/* ── 3. every close mechanism ───────────────────────────────────────── */

test("menu closes via X, Escape, and link selection", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");

  const open = () => page.getByRole("button", { name: "Open menu" }).click();
  const dialog = page.getByRole("dialog", { name: "Site navigation" });

  // X button
  await open();
  await dialog.getByRole("button", { name: "Close menu" }).click();
  await expect(dialog).toHaveCount(0);

  // Escape
  await open();
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);

  // Link selection (also exercises the route-change close path)
  await open();
  await dialog.getByRole("link", { name: /^menu$/i }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page).toHaveURL(/\/menu$/);

  // Focus must be back on the hamburger after close.
  await expect(page.getByRole("button", { name: "Open menu" })).toBeFocused();
});

test("menu survives repeated open/close cycles", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");

  const dialog = page.getByRole("dialog", { name: "Site navigation" });
  for (let i = 0; i < 4; i += 1) {
    await page.getByRole("button", { name: "Open menu" }).click();
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: "Close menu" }).click();
    await expect(dialog).toHaveCount(0);
  }
  expect(await page.evaluate(() => document.body.style.overflow)).toBe("");
});

test("menu content is reachable on short landscape viewports", async ({ page }) => {
  await page.setViewportSize({ width: 667, height: 375 });
  await page.goto("/");
  await page.getByRole("button", { name: "Open menu" }).click();

  const dialog = page.getByRole("dialog", { name: "Site navigation" });
  const cta = dialog.getByRole("link", { name: /explore the menu/i });

  // The CTA starts below the fold; the panel must scroll its own content.
  const scrolled = await cta.evaluate((el) => {
    const container = el.closest("#mobile-navigation")!.querySelector("nav")!;
    container.scrollTop = container.scrollHeight;
    return container.scrollTop > 0;
  });
  expect(scrolled).toBe(true);
  await expect(cta).toBeInViewport();
});

test("widening past the breakpoint releases the overlay and scroll lock", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.getByRole("button", { name: "Open menu" }).click();
  await expect(page.getByRole("dialog", { name: "Site navigation" })).toBeVisible();

  // Simulate the user widening the window (desktop nav takes over).
  await page.setViewportSize({ width: 1200, height: 844 });
  await expect(page.getByRole("dialog", { name: "Site navigation" })).toHaveCount(0);
  expect(await page.evaluate(() => document.body.style.overflow)).toBe("");
  await expect(page.getByRole("navigation", { name: "Primary" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Open menu" })).toHaveCount(0);

  // Narrow again: hamburger works again with no leftover state.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "Open menu" }).click();
  await expect(page.getByRole("dialog", { name: "Site navigation" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "Site navigation" })).toHaveCount(0);
});

/* ── 4. contrast of real computed colours ───────────────────────────── */

test("key text pairs meet WCAG AA contrast", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");

  const pairs: Array<[string, string, number]> = [
    // [label, text to locate, minimum AA ratio for its size]
    ["hero eyebrow (gold-700 on cream)", "Authentic Nigerian kitchen", 4.5],
    ["hero body (ink-muted on cream)", "carefully prepared Nigerian favourites", 4.5],
    ["step number (gold-700 on surface)", "01", 3], // large display text
    ["footer copyright (cream/55 on navy)", "All rights reserved", 4.5],
    ["footer blurb (cream/70 on navy)", "Canadian online kitchen celebrating", 4.5],
    ["closing CTA eyebrow (gold on navy)", "Your table is waiting", 4.5],
    ["CTA paragraph (cream/75 on navy)", "Ordering opens soon", 4.5],
  ];

  for (const [label, text, min] of pairs) {
    const ratio = await page.evaluate(async (needle) => {
      // Locate the deepest element containing the needle text.
      let target: HTMLElement | null = null;
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      let node: Node | null;
      while ((node = walker.nextNode())) {
        if (node.nodeValue?.includes(needle)) {
          target = node.parentElement;
          break;
        }
      }
      if (!target) return -1;
      const el = target;
      const parse = (str: string): number[] | null => {
        const rgb = str.match(/^rgba?\(([^)]+)\)$/);
        if (rgb) {
          const p = rgb[1].split(/[,/\s]+/).filter(Boolean).map(Number);
          return [p[0], p[1], p[2], p.length > 3 && !Number.isNaN(p[3]) ? p[3] : 1];
        }
        const oklch = str.match(/^oklab\(([\d.-]+)\s+([\d.-]+)\s+([\d.-]+)(?:\s*\/\s*([\d.]+))?\)$/);
        if (oklch) {
          const [L, a, b] = [+oklch[1], +oklch[2], +oklch[3]];
          const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
          const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
          const s_ = L - 0.0894841775 * a - 1.291485548 * b;
          const l = l_ ** 3;
          const m = m_ ** 3;
          const s = s_ ** 3;
          const lin = [
            4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
            -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
            -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
          ];
          const enc = lin.map((v) => (v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055));
          return [
            Math.max(0, Math.min(255, enc[0] * 255)),
            Math.max(0, Math.min(255, enc[1] * 255)),
            Math.max(0, Math.min(255, enc[2] * 255)),
            oklch[4] !== undefined ? +oklch[4] : 1,
          ];
        }
        return null;
      };
      const over = (fg: number[], bg: number[]) => fg.map((v, i) => (i < 3 ? v * fg[3] + bg[i] * (1 - fg[3]) : 1));
      const lum = (c: number[]) => {
        const f = (v: number) => {
          v /= 255;
          return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
        };
        return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]);
      };
      const stack: number[][] = [];
      let node2: HTMLElement | null = el;
      while (node2) {
        const c = parse(getComputedStyle(node2).backgroundColor);
        if (c && c[3] > 0) {
          stack.push(c);
          if (c[3] === 1) break;
        }
        node2 = node2.parentElement;
      }
      let bg = [253, 251, 247, 1];
      for (let i = stack.length - 1; i >= 0; i -= 1) bg = over(stack[i], bg);
      const fgRaw = parse(getComputedStyle(el).color);
      if (!fgRaw) return -1;
      const fg = over(fgRaw, bg);
      const l1 = lum(fg);
      const l2 = lum(bg);
      return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
    }, text);

    expect(ratio, `contrast: ${label} (got ${ratio.toFixed(2)})`).toBeGreaterThanOrEqual(min);
  }
});

/* ── 5. copy: no em dashes in customer-facing text ──────────────────── */

test("customer-facing copy contains no em dashes", async ({ page }) => {
  for (const route of ROUTES) {
    await page.goto(route);
    const findings = await page.evaluate(() => {
      const bad: string[] = [];
      if (document.title.includes("\u2014")) bad.push(`title: ${document.title}`);
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      let node: Node | null;
      while ((node = walker.nextNode())) {
        if (node.nodeValue?.includes("\u2014")) bad.push(node.nodeValue.trim().slice(0, 80));
      }
      for (const el of document.querySelectorAll("[aria-label]")) {
        const label = el.getAttribute("aria-label")!;
        if (label.includes("\u2014")) bad.push(`aria-label: ${label}`);
      }
      return bad;
    });
    expect(findings, `em dashes on ${route}`).toEqual([]);
  }
});
