/**
 * Phase 1B diagnostic audit — measures real DOM geometry, hit-testing and
 * computed contrast at mobile viewports, and captures open-menu evidence.
 *
 * Usage:  npm run start   (in another shell)
 *         node scripts/audit-mobile.mjs
 *
 * Output: console report + screenshots/audit/*.png
 */
import { chromium } from "@playwright/test";
import { mkdir } from "node:fs/promises";

const baseURL = process.env.BASE_URL ?? "http://localhost:3000";
const outDir = "screenshots/audit";

await mkdir(outDir, { recursive: true });
const browser = await chromium.launch();

/* ── 1. Mobile menu geometry & hit-testing ──────────────────────────── */
const menuViewports = [
  { width: 320, height: 568 },
  { width: 360, height: 800 },
  { width: 390, height: 844 },
  { width: 430, height: 932 },
  { width: 667, height: 375 }, // phone landscape below md — hamburger still shown
];

for (const viewport of menuViewports) {
  const page = await browser.newPage({ viewport });
  await page.goto(`${baseURL}/`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Open menu" }).click();
  await page.waitForTimeout(700);

  const report = await page.evaluate(() => {
    const nav = document.getElementById("mobile-navigation");
    const header = document.querySelector("header");
    const trigger = document.querySelector('button[aria-controls="mobile-navigation"]');
    const navRect = nav.getBoundingClientRect();
    const headerRect = header.getBoundingClientRect();
    const triggerRect = trigger.getBoundingClientRect();
    const cx = triggerRect.left + triggerRect.width / 2;
    const cy = triggerRect.top + triggerRect.height / 2;
    const hit = document.elementFromPoint(cx, cy);
    const navStyle = getComputedStyle(nav);
    const headerStyle = getComputedStyle(header);
    const firstLink = nav.querySelector("a");
    const lastLink = [...nav.querySelectorAll("a")].at(-1);
    return {
      viewport: { w: innerWidth, h: innerHeight },
      navRect: { x: Math.round(navRect.x), y: Math.round(navRect.y), w: Math.round(navRect.width), h: Math.round(navRect.height) },
      headerRect: { x: Math.round(headerRect.x), y: Math.round(headerRect.y), w: Math.round(headerRect.width), h: Math.round(headerRect.height) },
      navPosition: navStyle.position,
      navZ: navStyle.zIndex,
      navBg: navStyle.backgroundColor,
      navOverflowY: navStyle.overflowY,
      navScroll: { scrollHeight: nav.scrollHeight, clientHeight: nav.clientHeight },
      headerBackdrop: headerStyle.backdropFilter,
      headerZ: headerStyle.zIndex,
      bodyOverflow: getComputedStyle(document.body).overflow,
      triggerHitTest: hit
        ? { tag: hit.tagName, label: hit.getAttribute("aria-label"), insideNav: !!hit.closest("#mobile-navigation") }
        : null,
      firstLinkRect: firstLink ? { y: Math.round(firstLink.getBoundingClientRect().y), bottom: Math.round(firstLink.getBoundingClientRect().bottom) } : null,
      lastLinkRect: lastLink ? { y: Math.round(lastLink.getBoundingClientRect().y), bottom: Math.round(lastLink.getBoundingClientRect().bottom) } : null,
      contentClipped: nav.scrollHeight > nav.clientHeight + 1,
    };
  });
  console.log(`\n── menu open @ ${viewport.width}×${viewport.height}`);
  console.log(JSON.stringify(report, null, 2));

  const name = `menu-open-${viewport.width}x${viewport.height}`;
  await page.screenshot({ path: `${outDir}/${name}.png` });
  console.log(`   saved screenshots/audit/${name}.png`);

  // close via the visible X inside the panel
  await page.locator('#mobile-navigation [aria-label="Close menu"]').click({ timeout: 2000 }).then(
    () => console.log("   X click: closed OK"),
    (e) => console.log(`   X click FAILED: ${String(e).split("\n")[0]}`),
  );
  await page.waitForTimeout(400);
  const stillOpen = await page.locator("#mobile-navigation").count();
  console.log(`   nav still in DOM after X click: ${stillOpen > 0}`);
  await page.close();
}

/* ── 1b. Horizontal overflow probe at 320px (find offenders) ───────── */
for (const route of ["/", "/menu", "/about", "/contact"]) {
  const p = await browser.newPage({ viewport: { width: 320, height: 700 } });
  await p.goto(`${baseURL}${route}`, { waitUntil: "networkidle" });
  const overflow = await p.evaluate(() => {
    const doc = document.documentElement;
    const offenders = [];
    for (const el of document.querySelectorAll("body *")) {
      const r = el.getBoundingClientRect();
      if (r.width > 0 && r.right > doc.clientWidth + 1) {
        offenders.push({
          tag: el.tagName,
          cls: String(el.className).slice(0, 90),
          right: Math.round(r.right),
          w: Math.round(r.width),
        });
      }
    }
    return {
      scrollWidth: doc.scrollWidth,
      clientWidth: doc.clientWidth,
      offenders: offenders.slice(0, 12),
    };
  });
  console.log(`\n── overflow probe ${route} @ 320 (scrollWidth ${overflow.scrollWidth})`);
  console.log(JSON.stringify(overflow.offenders, null, 2));
  await p.close();
}

/* ── 2. Contrast sampling of real computed colors ───────────────────── */
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
await page.goto(`${baseURL}/`, { waitUntil: "networkidle" });

const samples = [
  ["footer copyright line", "All rights reserved"],
  ["footer blurb", "Canadian online kitchen celebrating"],
  ["footer link", "How ordering works"],
  ["hero eyebrow", "Authentic Nigerian kitchen"],
  ["hero body", "carefully prepared Nigerian favourites"],
  ["CTA paragraph on navy", "Ordering opens soon"],
  ["CTA eyebrow gold on navy", "Your table is waiting"],
  ["closing tile gold italic", "one beautifully set table"],
  ["step number gold on card", "01"],
  ["trust item", "Delivery or arranged pickup"],
];

const contrast = await page.evaluate(async (list) => {
  const parse = (str) => {
    if (!str || str === "transparent") return null;
    let m = str.match(/^rgba?\(([^)]+)\)$/);
    if (m) {
      const p = m[1].split(/[,/\s]+/).filter(Boolean).map((s) => parseFloat(s));
      return { r: p[0], g: p[1], b: p[2], a: p.length > 3 && !Number.isNaN(p[3]) ? p[3] : 1 };
    }
    m = str.match(/^color\(srgb\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)(?:\s*\/\s*([\d.]+))?\)$/);
    if (m) return { r: +m[1] * 255, g: +m[2] * 255, b: +m[3] * 255, a: m[4] !== undefined ? +m[4] : 1 };
    return null;
  };
  const over = (fg, bg) => {
    const a = fg.a ?? 1;
    return {
      r: fg.r * a + bg.r * (1 - a),
      g: fg.g * a + bg.g * (1 - a),
      b: fg.b * a + bg.b * (1 - a),
      a: 1,
    };
  };
  const lum = (c) => {
    const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
    return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b);
  };
  const ratio = (a, b) => {
    const l1 = lum(a), l2 = lum(b);
    return ((Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05)).toFixed(2);
  };
  const effectiveBg = (el) => {
    const stack = [];
    let node = el;
    while (node) {
      const c = parse(getComputedStyle(node).backgroundColor);
      if (c && c.a > 0) { stack.push(c); if (c.a === 1) break; }
      node = node.parentElement;
    }
    let result = { r: 253, g: 251, b: 247, a: 1 };
    for (let i = stack.length - 1; i >= 0; i--) result = over(stack[i], result);
    return result;
  };
  const find = (text) => {
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let n;
    while ((n = walker.nextNode())) {
      if (n.nodeValue.includes(text) && n.parentElement) {
        const el = n.parentElement;
        if (el.offsetParent !== null || getComputedStyle(el).position === "fixed") return el;
      }
    }
    return null;
  };
  const out = [];
  for (const [label, text] of list) {
    const el = find(text);
    if (!el) { out.push({ label, result: "NOT FOUND" }); continue; }
    const cs = getComputedStyle(el);
    const fgRaw = parse(cs.color);
    if (!fgRaw) { out.push({ label, result: "unparsed color: " + cs.color }); continue; }
    const bg = effectiveBg(el);
    const fg = over({ ...fgRaw, a: fgRaw.a ?? 1 }, bg);
    out.push({
      label,
      color: cs.color,
      bg: `rgb(${Math.round(bg.r)}, ${Math.round(bg.g)}, ${Math.round(bg.b)})`,
      fontSize: cs.fontSize,
      ratio: ratio(fg, bg),
      verdict: Number(ratio(fg, bg)) >= 4.5 ? "AA pass" : Number(ratio(fg, bg)) >= 3 ? "AA large only" : "FAIL",
    });
  }
  return out;
}, samples);

console.log("\n── contrast @ 390 (computed)");
console.table(contrast);

/* ── 3. Full-page captures at audit widths (for visual review) ─────── */
const pageWidths = [320, 375, 430];
for (const width of pageWidths) {
  for (const route of ["/", "/menu", "/about", "/contact"]) {
    const p = await browser.newPage({ viewport: { width, height: 800 } });
    await p.goto(`${baseURL}${route}`, { waitUntil: "networkidle" });
    const h = await p.evaluate(() => document.body.scrollHeight);
    for (let y = 0; y <= h; y += 450) { await p.mouse.wheel(0, 450); await p.waitForTimeout(100); }
    await p.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
    await p.waitForTimeout(400);
    const name = `${route === "/" ? "home" : "menu"}-${width}`;
    await p.screenshot({ path: `${outDir}/${name}.png`, fullPage: true });
    console.log(`saved screenshots/audit/${name}.png`);
    await p.close();
  }
}

await browser.close();
console.log("\naudit complete");
