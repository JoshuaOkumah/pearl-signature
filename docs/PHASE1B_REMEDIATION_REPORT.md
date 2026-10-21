# PEARL Signature — Phase 1B Remediation Report

> **Scope:** corrective design and frontend engineering only. No backend,
> database, payment, auth or cart work was started. Phase 2 remains unapproved.

---

## A. Root cause analysis

Every reported issue was reproduced in a real browser before any code was
changed. Measurements come from `scripts/audit-mobile.mjs` (DOM geometry,
hit-testing, computed colours) run against the pre-fix production build.

### Issue B — broken mobile navigation (critical)

The original `MobileNav` rendered `<motion.nav className="fixed inset-0 z-40">`
**inside `<header>`**. Three independent defects followed:

1. **`backdrop-filter` containing block.** The header applies
   `backdrop-filter: blur(12px)` when the menu is open, and a backdrop-filter
   creates a containing block for fixed-position descendants. The "full-screen"
   panel therefore resolved against the 72px header box, not the viewport:
   measured `navRect = {h: 72}` at 320/360/390/430/667 widths, with
   `scrollHeight 464` of content inside `clientHeight 72`. The cream
   background stopped at the header; the remaining ~460px of links and CTA
   overflowed with `overflow-y: visible` and painted **directly over the hero
   headline** (see `screenshots/audit/menu-open-390x844.png`). This is the
   "contents overlapped one another" and "text and background colours too
   similar" symptom.
2. **Paint order covered the close control.** The panel (positioned, `z-40`)
   paints above the header's static content row *within the header's stacking
   context* — the intended "z-50 header above z-40 nav" comparison never
   happens, because a child's z-index is compared only against its siblings.
   The panel's spacer bar covered the hamburger/X button. Hit-testing at the
   trigger's centre returned the panel (`insideNav: true`), and Playwright's
   actionability check failed the click ("element intercepts pointer
   events") — there was **no working close control** at any width ≥360.
   This is the "no obvious provision to close the menu" symptom.
3. **No internal scroll.** `overflow-y: visible` and no scroll container meant
   short landscape viewports (e.g. 667×375: 464px of content in ~300px of
   usable height) clipped content with no way to reach it.

### Issue A — poor mobile responsiveness

1. **Header row overflow at 320px.** `cn()` is a plain joiner (no
   tailwind-merge), so the header CTA carried both `inline-flex` (from
   `ButtonStyles` base) and `hidden md:inline-flex` (from the caller); in
   Tailwind v4's cascade the base `inline-flex` won and the "Explore Menu" CTA
   rendered at **every** width (measured `display: flex` at 320/360/390/430).
   Row min-width reached 332px inside a 280px content box → **32px horizontal
   scroll at 320px** and the whole header shifted.
2. **Crushed tap target.** The same overflow forced flex-shrink on the
   hamburger: measured **31px at 320 and 360, 32px at 375, 37px at 390** —
   full 44px only at ≥430. "Navigation elements colliding" and "awkwardly
   compressed content" in practice.
3. **Why the original checks missed it.** The screenshot utility only tested
   360+ (where shrink absorbs the overflow), the open-menu state was never
   captured, horizontal overflow was the *only* automated layout check, and
   contrast was judged from design tokens instead of computed colours.

### Contrast and visual hierarchy

| Pair | Measured | AA requirement | Verdict |
| --- | --- | --- | --- |
| Closing-panel Eyebrow (`gold-700`, override lost to base) on navy | 3.47:1 | 4.5:1 | fail, nearly invisible |
| Ordering step numbers (`gold` on `surface`) | 2.08:1 | 3:1 (large) | fail |
| Eyebrows (`gold-700` on cream) 12px | 4.34:1 | 4.5:1 | fail (marginal) |
| `Badge` gold (`gold-700` on `gold-100`) 12px | 3.83:1 | 4.5:1 | fail |
| `secondary` button (cream on `terracotta`) | 3.90:1 | 4.5:1 | fail (variant unused) |
| Footer `cream/55` on navy, hero `ink-muted`, chip counts, `gold` on navy | 5.5–7.4:1 | 4.5:1 | pass |

The Eyebrow failure was another `cn` conflict: the base `text-gold-700` and
the caller's `text-gold` both shipped, and `gold-700` won in the stylesheet.

### Copy

61 em dashes (U+2014) existed in `src`, 34 of them in customer-facing strings
(pages, components, data, metadata, footer and wordmark aria-labels).

---

## B. Fixes implemented

| File | Change |
| --- | --- |
| `src/components/layout/mobile-nav.tsx` | **Rebuilt** as a full-viewport modal panel portalled to `document.body` (`createPortal`, `useSyncExternalStore` client-mount detection). Own top bar with wordmark + visible 44px X close button; scrollable link list (`overflow-y-auto overscroll-contain`) that scrolls internally on short viewports; pinned CTA footer with `env(safe-area-inset-*)` padding; `role="dialog" aria-modal="true"`; focus moves to X on open, is trapped (Tab wraps at boundaries), returns to the hamburger on close; body-scroll lock with restore; Escape; closes and releases the lock when the viewport widens past `md`. z-70 (above header 50, skip-link 60) with the portal making `fixed inset-0` viewport-absolute regardless of ancestor styling. |
| `src/components/layout/header.tsx` | CTA and burger visibility now switch on wrapper divs (`hidden md:block`, `md:hidden`) so display classes can never conflict; right group and burger `shrink-0` (burger stays 44×44 at every width). |
| `src/app/globals.css` | `gold-700` darkened `#8F741F → #806519` (≥4.5:1 on cream, cream-100, cream-200, surface, gold-100); new `terracotta-800` for AA-safe `secondary` hover. |
| `src/components/ui/section.tsx` | `Eyebrow` gained `tone="default" | "inverse"` — inverse uses `gold` (7.4:1 on navy); the failing className override is gone. |
| `src/components/home/closing-cta.tsx` | Eyebrow uses `tone="inverse"`. |
| `src/components/home/how-ordering-works.tsx` | Step numbers `gold` → `gold-700` (2.08 → 5.49:1). |
| `src/components/ui/button.tsx` | `secondary` variant uses `terracotta-700`/`terracotta-800` so cream text is ≥4.5:1 at rest and hover. |
| Copy sweep (all pages, home components, `src/data/*`, `layout.tsx`, `footer.tsx`, `wordmark.tsx`) | All 34 customer-facing em dashes removed and the sentences rewritten (natural commas, full stops, colons; no mechanical substitution). Example: "…to your table — ordered online, made with care." → "…to your table, ordered online and made with care." Metadata titles/descriptions cleaned too; wordmark aria-label now "PEARL Signature, home page". |
| `e2e/mobile.spec.ts` | **New** 16-test regression suite (see F). |
| `src/components/layout/header.test.tsx` | Rewritten for the modal: dialog semantics, X, focus, scroll lock, trap, repeated cycles (27 unit tests total now). |
| `scripts/screenshots.mjs` | 10 viewports (320–1440 + two landscapes) × 4 routes + 5 open-menu captures, overflow asserted on every capture. |
| `scripts/audit-mobile.mjs` | **New** diagnostic that measures panel geometry, hit-tests the X, probes overflow offenders and samples computed contrast (it produced the evidence in section A). |
| `docs/DESIGN_SYSTEM.md`, `docs/PHASE_PROGRESS.md`, `README.md` | Updated for the new tokens, `cn` rules, mobile-menu behaviour, responsive standards and verification numbers. |

---

## C. Mobile navigation verification

All close mechanisms are implemented and tested (`e2e/mobile.spec.ts` +
`header.test.tsx`):

| Mechanism | Result |
| --- | --- |
| Visible X inside the panel (44×44, hit-test returns the button, click closes) | ✅ tested at 320/360/390/430/667×375 |
| Escape key | ✅ (focus returns to the hamburger) |
| Navigation link selection | ✅ (also verified the route-change close path; URL becomes `/menu`) |
| Backdrop | N/A — the panel is full-viewport by design (documented limitation; no backdrop exists to click) |
| Panel covers the viewport (not the header box) | ✅ bounding box == viewport at all five widths |
| Body scroll locked while open, released after close/resize | ✅ |
| Focus moves to X on open, trapped inside, returns to trigger | ✅ unit + e2e |
| Repeated open/close (×4 cycles) | ✅ |
| Short landscape 667×375: content scrolls internally, CTA reachable | ✅ (`scrollTop` reaches bottom; CTA `toBeInViewport`) |
| Widening past `md` while open | ✅ panel closes, lock released, desktop nav restored; narrowing again re-enables the hamburger |
| No element covers the panel | ✅ portal at z-70 above the sticky header |

---

## D. Responsive verification

Tested at 320/360/375/390/430/667×375/844×390/768/1024/1440 on `/`, `/menu`,
`/about`, `/contact`.

Issues found and corrected:
- **320px header:** horizontal scroll eliminated (scrollWidth 352 → 320 on all
  routes); hamburger never below 44px (31 → 44 at 320/360, 37 → 44 at 390);
  wordmark and controls no longer collide (asserted via bounding boxes).
- **Header CTA** removed from the mobile layout (was unintentionally visible);
  it now appears only at `md+`.
- **Hero, categories, favourites, story, steps, closing panel, FAQ, footer,
  menu chips/grid, about, contact** were re-captured and visually inspected
  section-by-section at 320 and 390 (detail frames) and as full pages at every
  width: stacking, wrapping, tap targets and spacing are correct; no overlap,
  clipping or incoherent whitespace observed.
- **Landscape:** 667×375 (hamburger) and 844×390 (desktop nav) captured; the
  menu panel scrolls internally at 667×375.
- Automated on every run: zero horizontal overflow at all 10 viewports × 4
  routes (screenshot tool + e2e), header-collision and 44px-target assertions,
  and "h1 inside viewport" checks.

---

## E. Copywriting changes

- All customer-facing em dashes removed (homepage, `/menu`, `/about`,
  `/contact`, footer, FAQ, product/category descriptions, page titles and
  meta descriptions, footer/wordmark aria-labels). Remaining U+2014
  occurrences in `src` are code comments only, which customers never see.
- Affected sentences were rewritten to read naturally (commas, full stops,
  colons, shorter sentences), preserving every business fact, the product
  scope and the "pending" placeholders. No new claims, prices, reviews or
  contact details were introduced.
- An e2e test scans the rendered text, `document.title` and every `aria-label`
  on all four routes for U+2014 and fails if any appear.

---

## F. Test results (actual, all executed)

| Command | Result |
| --- | --- |
| `npx next typegen` | ✅ PASS |
| `npm run typecheck` | ✅ PASS — 0 errors |
| `npm run lint` | ✅ PASS — 0 errors, 0 warnings |
| `npm run test` | ✅ PASS — **27/27** across 5 files |
| `npm run build` | ✅ PASS — `/`, `/about`, `/contact` static; `/menu` Partial Prerender |
| `npm run test:e2e` | ✅ PASS — **21/21** (5 smoke + 16 new mobile/responsive/contrast/copy tests) |
| `npm run screenshots` | ✅ PASS — **45 captures**, 0 horizontal overflow |
| `node scripts/audit-mobile.mjs` | ✅ PASS — panel == viewport at 5 widths, X hit-test passes, all sampled contrast pairs ≥ AA |

New e2e coverage maps directly to the original defects: viewport-matrix layout
tests (overflow, ≥44px targets, wordmark/burger collision, CTA-hidden,
h1-in-viewport), menu-usability tests (panel covers viewport, X visible/
hit-testable/clickable, no link/X bounding-box overlap, scroll lock), every
close mechanism, focus return, repeated cycles, landscape internal scrolling,
the widen-past-breakpoint flow, computed-colour WCAG AA pairs, and the
em-dash scan.

Limitations: jsdom unit tests cannot verify real geometry (covered by the
Playwright suites); the a11y-tree/contrast automation supplements, but does
not replace, the visual inspection described in section D.

---

## G. Screenshot evidence

All paths are on the working machine (`screenshots/` is git-ignored):

**Before (defect evidence)**
- `screenshots/audit/menu-open-390x844.png` — menu links floating over the
  hero headline, no background, no close button.
- `screenshots/audit/menu-open-320x568.png`, `menu-open-360x800.png`,
  `menu-open-430x932.png` — same defect at other widths.

**After (verification pass 1 — from the post-fix audit)**
- `screenshots/audit/menu-open-667x375.png` — landscape panel with internal
  scroll; `screenshots/audit/home-320x700.png` — no overflow at 320.
- Detail frames in `screenshots/audit/detail/` — hero, categories, favourites,
  story, steps, FAQ (open), footer, menu chips at 320px; about/contact tops.

**After (verification pass 2 — full matrix from `npm run screenshots`)**
- `screenshots/{home,menu,about,contact}-{320x700,360x800,375x812,390x844,430x932,667x375,844x390,768x1024,1024x900,1440x900}.png`
  (40 files).
- `screenshots/menu-open-{320x568,360x800,390x844,430x932,667x375}.png` — the
  mandatory open-menu captures; the X is visible and topmost, links are
  spaced and readable, contrast is strong at every width.

Both passes were visually inspected image by image (overlap, clipping, text
visibility, stacking, spacing, alignment); no outstanding visual defects were
observed.

---

## H. Remaining issues

1. **No backdrop layer** — the full-viewport panel closes via X/Escape/link
   only. A drawer-with-backdrop variant is possible if preferred later.
2. The header X (the hamburger in its open state) exists behind the panel and
   is covered by design while the menu is open; the panel's own X is the
   intended control. Keyboard and screen-reader users interact with the
   dialog, which is correctly labelled and modal.
3. Business inputs from Phase 1 are still pending (logo, photography, prices,
   delivery details, contact channels); nothing was invented.
4. Pre-existing, unchanged from Phase 1: five dev-only `braces` advisories
   under `eslint-config-next` with no upstream patch (documented in
   `PHASE_PROGRESS.md`).

## I. Phase readiness

**Phase 1 now meets its acceptance criteria** (subject to your re-review):
all four routes are composed for mobile at 320–430 and correct through
desktop; the hamburger menu opens and closes reliably via a clearly visible
X, Escape and links, with no overlap, sufficient contrast and correct
layering; typography, spacing and interactions are consistent and
reduced-motion-safe; customer-facing copy is em-dash-free; the browser test
suite covers the original failures; screenshots were inspected twice; and
typecheck, lint, unit (27), build, e2e (21) and screenshots (45, no overflow)
all pass. Phase 2 has **not** been started and awaits your approval.
