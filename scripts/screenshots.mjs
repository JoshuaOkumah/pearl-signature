/**
 * Design-review utility: captures screenshots of every public route at the
 * Phase 1B reference viewports (including mobile landscape and the OPEN
 * mobile menu) and asserts zero horizontal overflow on every capture.
 *
 * Usage:
 *   1. Start the app:        npm run start   (or `npm run dev`)
 *   2. Capture screenshots:  npm run screenshots
 *
 * Output: ./screenshots/<page>-<width>x<height>.png
 *         ./screenshots/menu-open-<width>x<height>.png
 */
import { chromium } from "@playwright/test";
import { mkdir } from "node:fs/promises";

const baseURL = process.env.BASE_URL ?? "http://localhost:3000";
const outDir = process.env.OUT_DIR ?? "screenshots";

const routes = ["/", "/menu", "/about", "/contact"];

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
  const name = route === "/" ? "home" : route.slice(1);
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

await browser.close();

if (failures > 0) {
  console.error(`\n${failures} capture(s) overflow horizontally.`);
  process.exit(1);
}
console.log(`\nAll screenshots captured in ./${outDir} — no horizontal overflow detected.`);
