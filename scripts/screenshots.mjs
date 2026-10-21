/**
 * Design-review utility: captures full-page screenshots of every public
 * route at the Phase 1 reference viewports and flags horizontal overflow.
 *
 * Usage:
 *   1. Start the app:        npm run dev   (or `npm run build && npm start`)
 *   2. Capture screenshots:  npm run screenshots
 *
 * Output: ./screenshots/<page>-<width>.png
 */
import { chromium } from "@playwright/test";
import { mkdir } from "node:fs/promises";

const baseURL = process.env.BASE_URL ?? "http://localhost:3000";
const outDir = process.env.OUT_DIR ?? "screenshots";

const routes = ["/", "/menu", "/about", "/contact"];
const widths = [360, 390, 768, 1024, 1440];

await mkdir(outDir, { recursive: true });

const browser = await chromium.launch();
let failures = 0;

for (const route of routes) {
  const name = route === "/" ? "home" : route.slice(1);
  for (const width of widths) {
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    await page.goto(`${baseURL}${route}`, { waitUntil: "networkidle" });
    // Scroll through the page gradually (like a real visitor) so every
    // scroll-reveal section enters the viewport before capturing.
    const height = await page.evaluate(() => document.body.scrollHeight);
    for (let y = 0; y <= height; y += 450) {
      await page.mouse.wheel(0, 450);
      await page.waitForTimeout(120);
    }
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
    await page.waitForTimeout(500);

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    if (overflow > 0) {
      failures += 1;
      console.error(`✗ ${name} @ ${width}px — horizontal overflow of ${overflow}px`);
    }

    await page.screenshot({ path: `${outDir}/${name}-${width}.png`, fullPage: true });
    console.log(`✓ ${name} @ ${width}px`);
    await page.close();
  }
}

await browser.close();

if (failures > 0) {
  console.error(`\n${failures} viewport(s) overflow horizontally.`);
  process.exit(1);
}
console.log(`\nAll screenshots captured in ./${outDir} — no horizontal overflow detected.`);
