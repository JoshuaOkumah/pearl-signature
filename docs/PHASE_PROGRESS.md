# PEARL Signature — Phase Progress

> **Phase 1: Project Foundation, Design System & Interactive Storefront — COMPLETE.**
> **Phase 1B: Mobile Responsiveness, Navigation & UI Remediation — COMPLETE**
> (see `docs/PHASE1B_REMEDIATION_REPORT.md`). Phase 1 was not approved as-is;
> the defects found in manual review were fixed and regression-tested.
> **Phase 2: Catalogue Data & Product Experience — IMPLEMENTED, awaiting review**
> (see `docs/PHASE2_REPORT.md`). **Phase 2B: Title-First Search Relevance
> & UX Refinement — IMPLEMENTED** (see section 1D).
> **Phase 3: Secure Admin, Catalogue Management & Signed Uploads —
> IMPLEMENTED, awaiting review** (see `docs/PHASE3_REPORT.md`, section 1E).
> **Phase 4: Guest Cart & Checkout Review — IMPLEMENTED, awaiting review**
> (see `docs/PHASE4_REPORT.md`, section 1F). Order submission, payment,
> Stripe, inventory reservation and deployment remain out of scope and require
> separate approval.

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

## 1C. Phase 2 — catalogue data & product experience

Full report: `docs/PHASE2_REPORT.md`. Schema: `docs/DATABASE_SCHEMA.md`.
Operator guides: `docs/MONGODB_SETUP.md`, `docs/CLOUDINARY_SETUP.md`.

### What shipped
- **Data layer:** server-only Mongoose connection (cached, HMR-safe, 5s
  timeouts, `autoIndex: false`, redacted logging); Zod validation at every
  boundary; repository implementing the full read set (categories, paged
  published products, search, by slug, featured, related, counts, homepage
  showcase) with `ReadResult` errors and safe ID serialisation.
  `src/data` is no longer the production source: fixtures run only in
  explicit dev/preview mode and are always labelled; production without
  `MONGODB_URI` shows an honest unavailable state (never silent fallbacks).
- **Schemas:** `categories` + `products` with unique normalised slugs,
  embedded image/variant subdocs, draft/published status, availability,
  featured, sortOrder, tags, timestamps, listing indexes — and
  **integer-CAD-cent prices** (`priceCents: number | null`, no floats, no
  `$0` placeholder; unconfigured → "Price to be confirmed").
- **`/menu`:** DB-driven filter chips, debounced search and server-side
  pagination (default 12, max 48) in shareable URL params with intact
  Back/Forward, honest empty/past-end states; cards gain availability and
  price states; no fake Add-to-Cart.
- **`/menu/[slug]`:** breadcrumb, back link, gallery (thumbnails with
  `aria-pressed` + arrow-key navigation, decorative thumb images),
  price-or-pending, related products excluding self, and **404 for
  unknown/draft/malformed slugs with genuine 404 status codes** via
  `src/proxy.ts` (Next 16 Proxy checks the slug before any response
  streams; database trouble passes through to the retry state instead of
  404-ing).
- **Cloudinary display:** `FoodMedia` delivers through `next/image` only
  when the build configured an allowlisted host and the URL validates,
  otherwise the Phase 1 placeholder (no CLS, required alt, no secrets, no
  hotlinks, no upload endpoints).
- **SEO/honesty:** real metadata + canonical only when a production URL is
  configured, preview content `noindex`, schema.org Product **without**
  fabricated offers/ratings/reviews.
- **Cache Components:** `await io()` keeps the database out of prerendering
  entirely; no `"use cache"` on catalogue data (prices never go stale);
  `/` and `/menu` keep PPR shells; `/menu/[slug]` is request-rendered
  (`instant = false` + `connection()`), with genuine 404 status codes
  decided by `src/proxy.ts` before any rendering starts.
- **Seeding:** `npm run seed` — explicit `--yes` (+ `--force-production`
  for production), masked target display, `$setOnInsert`-only idempotent
  upserts, no drops, never auto-runs; **not executed against any hosted
  database** (no credentials exist; authorization required regardless).
- **Tests:** unit suite 27 → **133** (repository, validations, models,
  formatting, URL/image helpers, menu explorer, gallery, cards, states,
  showcase, breadcrumbs); Playwright 21 → **32** with a new `catalogue`
  suite; screenshots extended to filter/detail/404 routes + a separate
  unavailable-state capture set.

### Phase 2 verification (all executed)
| Command | Result |
| --- | --- |
| `npx next typegen && npm run typecheck` | ✅ PASS — 0 errors |
| `npm run lint` | ✅ PASS — 0 errors/warnings |
| `npm run test` | ✅ PASS — **133/133** (17 files) |
| `npm run build` | ✅ PASS — no DB configured/queried at build; PPR kept; `ƒ Proxy` registered; `/menu/[slug]` request-rendered |
| `npm run test:e2e` | ✅ PASS — **32/32** against the production build (fixtures mode) |
| `npm run screenshots` | ✅ PASS — **75 captures** + 6 unavailable-state captures, **0 horizontal overflow** |
| Seed safety smoke tests | ✅ PASS — refuses without URI/`--yes`, production refusal, masked output, clean offline failure (unresolvable host, no credentials printed) |
| 404 status probe | ✅ PASS — unknown/draft/malformed → **404**; published → 200 (production server) |
| Visual review | ✅ PASS — mobile + desktop passes incl. gallery, filter state, 404, unavailable states |

**Pending (not verifiable without owner-supplied credentials):** hosted
Atlas reads/seed and real Cloudinary delivery — both documented step-by-step
in their setup guides.

---

## 1D. Phase 2B — title-first search relevance & UX refinement

### Problem found in manual testing
A single-letter query such as `f` returned unrelated products (Egusi Soup
matched because its *description* contains "favourite"), with no relevance
ordering.

### Root cause
Both search paths (database `buildFilter` and fixtures
`fixtureQueryFilter`) matched an unanchored literal substring across
`name + shortDescription + description`; results came back in plain
`sortOrder` order with no ranking.

### What changed
- **`src/lib/search.ts` (new, pure, shared by both data sources):**
  `normalizeSearchTerm` (trim, collapse whitespace, case-fold, 100-char
  bound), `nameMatchTier` (1 = name prefix, 2 = word prefix, 3 = substring
  for 3+ character terms), `searchCandidateRegex` (escaped, length-aware
  candidate pattern: `^f` / `(?:^|\b)me` / literal substring),
  `compareSearchRelevance` (tier → `sortOrder` → slug, fully deterministic).
- **Matching rules:** names only — descriptions, categories and tags are
  never searched. 1 character matches only names *beginning* with it; 2
  characters add word prefixes; 3+ characters add substrings, ranked last.
  Case-insensitive; surrounding whitespace ignored.
- **Database path:** the candidate regex lives in the *same* filter as
  `status`/`categoryId`; matches are fetched, ranked in memory, then sliced
  for the page (pagination and `countDocuments` totals operate on the true
  match set — no duplicates across pages, stable across requests).
  M0-compatible: escaped, anchored, name-only, no Atlas Search.
- **Fixtures path:** identical rules through the same functions
  (parity unit-tested).
- **UX:** 350 ms debounce kept; visible clear control (32 px, clears within
  the current category, resets page); trim-on-commit and same-value guards
  prevent redundant navigations; `motion-safe:` pending spinner;
  search-aware no-results copy echoing the query; label/placeholder now
  say "by name". Back/Forward re-sync and shareable URLs unchanged.

### Phase 2B verification (all executed)
| Command | Result |
| --- | --- |
| `npx next typegen && npm run typecheck` | ✅ PASS — 0 errors |
| `npm run lint` | ✅ PASS — 0 errors/warnings |
| `npm run test` | ✅ PASS — **162/162** (18 files; +29 search/UX tests) |
| `npm run build` | ✅ PASS — production build, no DB at build |
| `npm run test:e2e` | ✅ PASS — **39/39** against the production build (fixtures mode) |
| `npm run screenshots` | ✅ PASS — **95 captures** (incl. search results + empty states), **0 horizontal overflow** |
| Visual review | ✅ PASS — search results/empty states correct at 320/360/1440 px; Phase 1B mobile nav intact |

---

## 1E. Phase 3 — secure admin, catalogue management & signed uploads

Full report: `docs/PHASE3_REPORT.md`. Auth & security: `docs/ADMIN_AUTH.md`.
Day-to-day operations: `docs/ADMIN_OPERATIONS.md`. Upload flow:
`docs/CLOUDINARY_UPLOADS.md`.

### What shipped
- **Admin authentication:** Argon2id (`@node-rs/argon2`, split into pure
  `password-core.ts` + server-only `password.ts`); database-backed sessions
  with a 256-bit opaque token stored **hashed** (SHA-256) in MongoDB,
  7-day absolute TTL; `pearl_admin_session` cookie (HttpOnly, Secure in
  production, SameSite=Lax, Path=/admin); generic credential errors
  (unknown email / wrong password / disabled account are indistinguishable).
- **Rate limiting without Redis:** MongoDB buckets keyed by
  `sha256(address|email|15-min-bucket)` with atomic `$inc` upserts and TTL
  expiry; fail-closed when the database is unreachable.
- **Audit log:** login success/failure/rate-limit, logout, password reset,
  product/category mutations, image attach/update/remove — hashed client
  addresses, 180-day TTL, never any password/token/secret material.
- **Guarded operator CLIs:** `npm run admin:bootstrap` (first owner only,
  hidden confirmed password prompt, explicit `--yes`, prints host/database
  never credentials, production double-guard) and `npm run admin:reset`
  (rotates a password **and revokes every live session**). Neither ever
  runs from a web request or on startup; automation passwords come from
  the environment, never argv.
- **Authorization on every mutation:** each Server Action independently
  re-validates the session (`requireActionAdmin()`); Zod schemas strip
  unknown keys (no mass assignment); safe ObjectId checks; optimistic
  concurrency on product/category edits; `safeAdminRedirect` blocks
  open redirects after login.
- **Routes:** `/admin/login`, `/admin` (real-data dashboard: product
  counts by status, unavailable list, category counts, recently updated),
  `/admin/products` (search, status/category/unavailable filters, sort,
  pagination), `/admin/products/new`, `/admin/products/[id]/edit`,
  `/admin/categories`.
- **Products:** create/edit with integer-cent prices (dollars entered,
  cents stored), optional variants, draft/published visibility, tags and
  display order; **archive instead of delete** (reversible, referenced
  history preserved); slug editable on edit with up to five previous slugs
  that 308-redirect via `src/proxy.ts` (page-level redirect kept only as
  fallback).
- **Categories:** create/rename with **fixed slugs** (public filter links
  never break), display order, and **disable instead of delete**
  (confirmation required when products reference the category).
- **Cloudinary signed uploads:** session-guarded server signature
  (`signUpload`) fixes folder/overwrite/filename/timestamp; browser posts
  the file directly to Cloudinary; the server then re-fetches the asset
  from the Admin API (`verifyUploadedAsset`) and builds the stored image
  record **only** from that response; ≤5 MB, JPEG/PNG/WebP, ≤10 images per
  product (atomic guard), orphan cleanup for invalid or excess uploads,
  reference-counted deletion. Without credentials the edit page shows the
  honest "not configured" notice; nothing fails silently.
- **Storefront integration:** every mutation calls `revalidatePath` so
  the public site reflects changes on the next request; Phase 2B
  search behaviour preserved (verified end-to-end); product detail pages
  resolve previous slugs and require the product's category to be active.
- **Next 16 Cache Components correctness:** every admin page and the
  dashboard layout call `await connection()` as their first statement, so
  no prerender/prefetch/shell pass ever executes admin DB reads (this
  fixed a deterministic 500 after `revalidatePath` purged shells — see
  PHASE3_REPORT §6). All `/admin/**` routes build as dynamic (`ƒ`).
- **E2E architecture:** one Playwright config, two projects — `chromium`
  (storefront, port 3000, owns build+start, fixtures) and `admin`
  (disposable stack: mongodb-memory-server + real seed + bootstrap +
  `next start` on port 3001, reuses `.next`).

### Phase 3 verification (all executed)
| Command | Result |
| --- | --- |
| `npx next typegen && npm run typecheck` | ✅ PASS — 0 errors |
| `npm run lint` | ✅ PASS — 0 errors/warnings |
| `npm run test` | ✅ PASS — **328/328** (30 files) |
| `npm run build` | ✅ PASS — all `/admin/**` routes dynamic (`ƒ`); storefront routes unchanged |
| `npm run test:e2e` | ✅ PASS — **50/50** (39 storefront + **11 admin**), clean server logs (zero prerender noise) |
| `npm run screenshots` | ✅ PASS — **129 captures** (95 public + **34 admin**: login/dashboard/products/forms/categories/drawer/upload-not-configured at 360–1440), **0 horizontal overflow** |
| Visual review | ✅ PASS — admin surfaces inspected (focus rings, real seeded counts, honest states, mobile drawer) |

**Pending (not verifiable without owner-supplied credentials):** hosted
Atlas admin operations and real Cloudinary uploads — both documented
step-by-step in `docs/ADMIN_AUTH.md` and `docs/CLOUDINARY_UPLOADS.md`.

---

## 1F. Phase 4 — guest cart & checkout review foundation

Full report: `docs/PHASE4_REPORT.md`. Cart design: `docs/CART_ARCHITECTURE.md`.
Checkout validation and manual review: `docs/CHECKOUT_FOUNDATION.md` and
`docs/MANUAL_TESTING.md`.

### What shipped
- Versioned guest cart in `localStorage`, keyed by `(slug, variantName)`;
  bounded line/unit counts, quantity editing/removal, explicit clear
  confirmation, header control and accessible portalled cart drawer.
- Read-only `quoteCartAction` is authoritative for current names, option
  eligibility, availability and integer-cent prices. Quote requests contain
  no client-supplied prices. Invalid, archived, draft and disabled-category
  products are safely masked; quote errors withhold prices rather than using
  stale storage hints.
- `/cart` editing and `/checkout` review shell; Canadian name/email/phone and
  conditional delivery fields are locally validated. Details stay in tab
  memory, no form action exists, and no order is submitted.
- Delivery, taxes, delivery coverage and pickup arrangements remain “To be
  confirmed” / “Not yet confirmed”. No fees, total, place-order button,
  payment, inventory reservation or order record was introduced.
- Fixture catalogue image validation now drops invalid preview images per
  image, matching the database path, instead of dropping an otherwise valid
  product. Preview Cloudinary mismatch is handled hermetically in e2e.
- 320px cart wrapping and narrow header layout corrected; a dedicated 320px
  priced/unresolvable cart regression test was added.

### Phase 4 verification (all executed)
| Command | Result |
| --- | --- |
| `npx next typegen && npm run typecheck` | ✅ PASS — 0 errors |
| `npm run lint` | ✅ PASS — 0 errors/warnings |
| `npm run test` | ✅ PASS — **496/496** (40 files) |
| `npm run test:e2e` | ✅ PASS — **79/79** (storefront, cart/checkout, disposable admin) |
| `npm run screenshots` | ✅ PASS — **161 captures**, 0 horizontal overflow (public, cart/checkout and admin) |
| Visual review | ✅ PASS — reviewed 320px cart/unresolvable line, 390px checkout/drawer, home and product detail |

### Explicitly not implemented
Order submission, customer-data transmission/storage, Stripe or cash payment,
order history/status, inventory reservation, promo codes, delivery pricing or
coverage, taxes and pickup scheduling. No MongoDB schema changes were made.

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
- Cloudinary credentials (cloud name, API key, API secret) to enable photo
  uploads — until supplied, the admin shows the honest "not configured"
  state and the storefront keeps designed placeholders.
- Owner sign-in credentials for the production database (created once via
  `npm run admin:bootstrap`, see `docs/ADMIN_AUTH.md` §6).
- Prices, portion sizes, customisation options.
- Delivery regions, fees and schedules; pickup windows and locations.
- Operating hours, verified business email/phone/social accounts.
- Domain/hosting choice and production deployment.
- Confirming that “Signature” badge/wording matches brand preferences.

## 4. Known limitations

- **Admin and catalogue writes are DB-backed; commerce is not.** Phase 3
  added owner auth, product/category CRUD and signed uploads; cart,
  checkout, Stripe and order lifecycle remain Phase 4. Until `MONGODB_URI`
  exists, the site runs on labelled preview fixtures (dev/preview) or shows
  the honest unavailable state (production without configuration), and the
  admin requires a real database (the disposable e2e stack uses an in-memory
  MongoDB).
- **Cloudinary uploads are implemented but unverified against a real
  cloud** (no credentials were supplied this phase); the edit page shows
  the designed "not configured" state until `CLOUDINARY_*` variables exist.
- Homepage category tiles are local presentation data (menu categories are
  curated copy); the `/menu` page is the database-driven surface.
- Product detail pages render per request (`connection()` in the segment
  layout), so there is no static shell for them; client-side navigations
  show the segment's loading skeleton while the database read streams in.
  Genuine 404 status codes come from `src/proxy.ts`, which checks the slug
  before any response starts.
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

## 5. Next planned phase (requires separate approval)

Phase 4 is implemented and awaiting review. Any next phase may add order
creation, payment, inventory or deployment only after explicit business-owner
approval and the required business inputs. See `docs/PROJECT_SPEC.md` for
unresolved details. Do not treat checkout review as an order.
