# PEARL Signature — Phase Progress

> **Phase 1: Project Foundation, Design System & Interactive Storefront — COMPLETE.**
> **Phase 1B: Mobile Responsiveness, Navigation & UI Remediation — COMPLETE**
> (see `docs/PHASE1B_REMEDIATION_REPORT.md`). Phase 1 was not approved as-is;
> the defects found in manual review were fixed and regression-tested.
> Phase 2 must not begin without explicit approval from the business owner.

---

## 1. Completed Phase 1 work

### Project initialization
- Inspected empty working directory; scaffolded Next.js **16.4.2** with the locked
  stack (App Router + Cache Components/Partial Prefetching, TypeScript strict,
  Tailwind CSS v4, ESLint flat config, `src/` layout, npm).
- Installed Phase 1 dependencies: `motion`, `lucide-react`, and the testing
  foundation (`vitest`, React Testing Library, `jsdom`, `@playwright/test`).
- Aligned `@types/node` to `^24` (matches Node 24 runtime; required by Vitest 5).
- Established the folder architecture: `src/app`, `src/components/{ui,layout,home,menu,shared,providers}`,
  `src/lib`, `src/data`, `src/types`, `public`, `docs`, `e2e`, `scripts`.

### Design system
- Semantic tokens in `src/app/globals.css` (`@theme`): cream/navy/gold/leaf/terracotta/brown
  plus derived surfaces, borders, muted text and interactive states — no raw hex
  scattered through components.
- Fonts via `next/font`: **Fraunces** (display) + **Manrope** (interface), with a
  responsive type scale and controlled line lengths (`text-balance`, max-w copy).
- Utility layers: `focus-gold` (keyboard focus), `skip-link`, `pearl-dot`,
  `motion-safe` pulse skeletons.

### Brand components
- Wordmark (temporary typographic “PEARL ● Signature” with pearl detail — **not**
  the final logo).
- `Button`/`ButtonLink` (primary, secondary, accent, outline, outlineLight, ghost;
  sm/md/lg/icon; disabled, focus, press states), `Chip`, `Badge`, `Section`,
  `Eyebrow`, `SectionHeading`, `Divider`, `Skeleton`, `Accordion`, `Reveal`,
  `FoodMedia`, `ProductCard`.

### Website shell
- Sticky header with active-route states and subtle elevation on scroll.
- Accessible mobile navigation: open/close animation, closes on link selection
  and Escape, focus moves in and returns to trigger, body-scroll lock, unmounts
  when closed, keyboard + focus-visible support.
- Brand footer: wordmark, intro, page links, category links, dynamic copyright
  year (build-time cached via `use cache`), reserved slot for verified contact
  and social details.

### Pages
- **`/`** — Hero (A), Menu Categories (B), Signature Favourites (C), Brand Story (D),
  How Ordering Works (E), Closing CTA (F), FAQ accordion (G).
- **`/menu`** — heading + intro, animated category chips with counts, responsive
  product grid from typed local data, empty state with reset, `aria-live` result
  count, “ordering opens soon” notice; `searchParams` streams behind a skeleton
  (Cache Components compliant).
- **`/about`**, **`/contact`** — polished informational pages with no invented
  biography, contact details or links.

### Motion & interactivity
- `MotionProvider` with `reducedMotion="user"`; 150–300ms microinteractions;
  one-shot scroll reveals with stagger; chip pill glide (`layoutId`); animated
  category filtering (`AnimatePresence popLayout`); card hover lift + media scale;
  accordion height animation; no continuous/decorative loops.

### Imagery
- `FoodMedia`: temporary per-dish plated-dish SVG illustrations with fixed
  aspect ratios (no CLS, no hotlinking, no fake photography). Props API is the
  Cloudinary/`next/image` migration point.

### Testing foundation
- Vitest (jsdom + RTL) with `vitest.config.mts`, `vitest.setup.ts`
  (explicit `afterEach(cleanup)` + browser-API mocks).
- Playwright configured with a dev-server harness; smoke tests.
- `scripts/screenshots.mjs` responsive design-review utility (`npm run screenshots`).

### Documentation
- `docs/PROJECT_SPEC.md`, `docs/DESIGN_SYSTEM.md`, `docs/PHASE_PROGRESS.md`,
  `README.md`, project notes appended to `AGENTS.md`.

---

## 1B. Phase 1B — mobile responsiveness, navigation & UI remediation

Phase 1 failed manual review: the mobile menu was unusable, the header
overflowed at 320px, several gold-on-light text pairs missed WCAG AA, and the
copy used em dashes throughout. Root causes, fixes and evidence are documented
in `docs/PHASE1B_REMEDIATION_REPORT.md`; summary:

### Root causes found (with measured evidence)
1. **Mobile nav collapsed into the header (critical).** `MobileNav` rendered
   `fixed inset-0` *inside* `<header>`, which applies `backdrop-filter` when
   open; backdrop-filter creates a containing block for fixed descendants, so
   the panel's box resolved to the 72px header instead of the viewport
   (measured `navRect.h = 72` at every width). Its cream background stopped at
   the header, ~460px of link content painted over the hero (measured
   `scrollHeight 464 / clientHeight 72`), and the panel covered the header's
   own trigger (hit-test at the X centre returned the panel), so there was no
   working close control.
2. **Header overflow at 320px.** `cn` is a plain joiner (no tailwind-merge),
   so the header CTA's base `inline-flex` beat the caller's `hidden` in
   Tailwind v4's cascade: the "Explore Menu" CTA rendered at every width.
   Row min-width (332px) exceeded the 280px content box → 32px horizontal
   scroll at 320, and flex-shrink crushed the hamburger to 31–37px at
   320/360/375/390 (44px only at ≥430).
3. **Contrast misses.** Eyebrow's base `text-gold-700` silently beat the
   closing panel's `text-gold` override (dark gold on navy = 3.5:1); the
   step numbers rendered `gold` on `surface` = 2.1:1; `gold-700` itself was
   4.34:1 on cream (eyebrows are 12px → AA needs 4.5:1); the unused
   `secondary` button was 3.9:1.
4. **Verification gaps.** Open-menu states were never captured, 320px was
   never tested, and contrast was judged from tokens instead of computed
   colours — tests passed while the UI was broken.

### Fixes implemented
- `MobileNav` rewritten as a full-screen modal panel **portalled to
  `document.body`** with its own top bar (wordmark + visible X), internal
  scrolling on short landscape viewports, pinned CTA with safe-area padding,
  focus trap, Escape, body-scroll lock, focus return, and an md-breakpoint
  guard that closes the panel and releases the lock on resize.
- Header: CTA/burger visibility switched on wrapper divs (`hidden md:block`,
  `md:hidden`) so display classes can't conflict; controls `shrink-0`.
- Tokens: `gold-700` darkened to `#806519` (≥4.5:1 on every light surface it
  is used on); new `terracotta-800` for the `secondary` button hover;
  step numbers switched to `gold-700`; `Eyebrow` gained `tone="inverse"`
  (`gold` on navy) so the closing panel renders 7.4:1 gold instead of 3.5:1.
- Copy: all customer-facing em dashes removed (60+ occurrences across pages,
  components, data, footer/wordmark aria-labels and metadata), rewritten as
  natural sentences.
- Tests: unit suite expanded 23 → 27; Playwright suite 5 → 21 — mobile-nav
  behaviour (open/close/focus/lock/repeat/resize), viewport-matrix layout
  assertions (overflow, 44px targets, collision, hit-testing), WCAG AA
  contrast pairs from computed styles, and an em-dash scan of every route.
- `scripts/screenshots.mjs` now captures 320/360/375/390/430/667×375/
  844×390/768/1024/1440 plus **open-menu states**, asserting zero overflow on
  every capture; `scripts/audit-mobile.mjs` is the measurement/contrast
  diagnostic that produced the root-cause evidence.

### Phase 1B verification (all executed)
| Command | Result |
| --- | --- |
| `npx next typegen && npm run typecheck` | ✅ PASS — 0 errors |
| `npm run lint` | ✅ PASS — 0 errors/warnings |
| `npm run test` | ✅ PASS — **27/27** (5 files) |
| `npm run build` | ✅ PASS — `/`, `/about`, `/contact` static; `/menu` Partial Prerender |
| `npm run test:e2e` | ✅ PASS — **21/21** (smoke + mobile/responsive/contrast/copy) |
| `npm run screenshots` | ✅ PASS — **45 captures** (40 pages + 5 open-menu), **0 horizontal overflow** |
| Visual review | ✅ Open-menu and full-page captures inspected at 320–1440 + landscape; detail frames at 320px per section |

---

## 2. Verification results (all executed)

| # | Command | Result |
| --- | --- | --- |
| 1 | `npm install` (+ Phase 1 deps) | ✅ PASS — installed; one peer conflict resolved by aligning `@types/node` `^20` → `^24` |
| 2 | `npx next typegen && npm run typecheck` | ✅ PASS — strict `tsc --noEmit`, no errors |
| 3 | `npm run lint` | ✅ PASS — zero errors, zero warnings |
| 4 | `npm run test` | ✅ PASS — **5 files, 23/23 tests** |
| 5 | `npm run build` | ✅ PASS — `/`, `/about`, `/contact` static; `/menu` Partial Prerender (skeleton + streamed explorer); fonts self-hosted |
| 6 | `npx playwright install chromium` | ✅ PASS — Chrome for Testing 156 + headless shell downloaded |
| 7 | `npm run test:e2e` | ✅ PASS — **5/5 tests** (hero/sections, menu filtering, about+contact routes, mobile nav Escape, reduced-motion) |
| 8 | `npm run screenshots` | ✅ PASS — 20 captures (4 routes × 360/390/768/1024/1440), **0 horizontal overflow** |
| 9 | Manual visual review of screenshots | ✅ PASS after fix (see below) — hero, categories, favourites, story, steps, CTA, FAQ, footer, menu grid, about, contact all render as designed |

### Defects found during verification and fixed
1. **Section padding cascade** — responsive `lg:py-28` overrode `pb-10`/`pt-0`
   class overrides, creating a ~220px gap on `/menu`. Fixed by moving vertical
   rhythm into a first-class `Section` `padding` prop (cascade-proof).
2. **Test isolation** — RTL auto-cleanup wasn’t registered (Vitest non-globals
   mode), so renders accumulated between tests. Fixed with explicit
   `afterEach(cleanup)` in `vitest.setup.ts`.
3. **ESLint `react-hooks/set-state-in-effect`** — route-change menu close moved
   from `useEffect` to React’s adjust-state-during-render pattern.
4. **`react-hooks/exhaustive-deps` ref warning** — `triggerRef.current` copied
   into the effect before cleanup use.
5. **Screenshot fidelity** — jump-scrolling outran scroll reveals; the capture
   utility now scrolls progressively (real-user behaviour).

---

## 3. Outstanding items (business inputs required before launch)

- Official logo (P+S monogram with pearl detail) — current wordmark is interim.
- Real product photography — current imagery is clearly temporary illustration.
- Prices, portion sizes, customisation options.
- Delivery regions, fees and schedules; pickup windows and locations.
- Operating hours, verified business email/phone/social accounts.
- Domain/hosting choice and production deployment.
- Confirming that “Signature” badge/wording matches brand preferences.

## 4. Known limitations

- **No backend of any kind** (by design): menu data is typed local preview data
  in `src/data`; presentation is already API-ready (same `Product` shape).
- The mobile menu is a **full-viewport** panel, so it has no backdrop layer;
  closing is via the X button, Escape, or a link. (A drawer-with-backdrop is
  an alternative design if the business prefers it later.)
- **`npm audit` reports 5 high advisories** in `braces` (via the *dev-only*
  chain `eslint-config-next → @next/eslint-plugin-next → fast-glob → micromatch`).
  Upstream has published no patched `braces` release (3.0.3 is latest and is
  itself listed), and npm’s suggested “fix” is a breaking downgrade to
  `eslint-config-next@14`, which was correctly rejected. **No production
  runtime impact** — not bundled; revisit each release until upstream patches.
- Vitest logs an informational deprecation note suggesting Vite’s native
  `resolve.tsconfigPaths` instead of the `vite-tsconfig-paths` plugin (plugin
  follows the official Next.js testing guide; behaviour unaffected).
- jsdom prints “Not implemented: scrollTo/navigation” notices during unit tests
  (harmless jsdom limitations; assertions unaffected).
- Playwright browsers are installed per machine
  (`npx playwright install chromium`) — required once for `test:e2e`/screenshots.
- Build uses Turbopack (Next 16 default); no PostCSS config (Tailwind v4 via
  `@tailwindcss/turbopack`).

## 5. Next planned phase (requires approval)

**Phase 2 — Catalogue data & product experience**, tentatively:
- MongoDB Atlas M0 + Mongoose models (Product, Category) — free tier only.
- Zod validation for API boundaries; typed data-access layer replacing `src/data`.
- Product detail routes (`/menu/[slug]`) with sizes/customisation scaffolding.
- Cloudinary upload/CDN integration replacing `FoodMedia` placeholders
  (keeping the component API).
- Continued no-invention rule: prices/details arrive only from the business.

Cart, checkout, Stripe, sessions and the admin dashboard remain reserved for
later phases as specified in `docs/PROJECT_SPEC.md`.
