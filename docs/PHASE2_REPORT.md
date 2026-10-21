# PEARL Signature — Phase 2 Report

**Phase:** 2 — Catalogue data & product experience (MongoDB Atlas M0 +
Mongoose + Zod foundation, Cloudinary display, `/menu` + `/menu/[slug]`).
**Date:** 2026-10-21. **Status:** implemented and verified locally; **awaiting
review before Phase 3**.

---

## A. Summary & scope

Phase 2 replaced the production data source (`src/data`) with a database
read layer, added dynamic product detail pages, and wired honest pricing,
SEO and 404 behaviour — while staying inside the phase's cost and security
rules (free tiers only, no cart/checkout/Stripe/admin/uploads/deployment).

**Shipped:** server-only MongoDB connection; `categories` + `products`
Mongoose schemas with integer-cent money rules; Zod validation at every
boundary; a repository with the full read set; DB-driven `/menu` with
shareable URL state; `/menu/[slug]` with gallery, related products and real
404 status codes; Cloudinary display path in `FoodMedia` (guarded,
placeholder-preserving); an explicit, idempotent seed tool; unit + e2e
coverage; screenshots across the full viewport matrix; and updated docs.

**Deliberately not touched:** cart, checkout, Stripe, auth, admin CRUD,
uploads, deployment, paid services. Phase 1/1B behaviour (mobile nav,
contrast, em-dash-free copy) preserved and regression-tested.

**Cloud verification: PENDING.** No `MONGODB_URI` and no Cloudinary
credentials were supplied; nothing was created, upgraded or queried on any
cloud by this phase. Every claim below marked *verified* was executed
locally (see section K).

## B. Data layer: connection & configuration

- `src/lib/db/mongoose.ts` — `server-only` guarded, cached global
  connection (dev-HMR safe), `autoIndex: false`, `bufferCommands: false`,
  5-second connect/server-selection timeouts, `logDatabaseError` with
  credential redaction. Config is validated **at use time**, not import
  time, so builds and tests never need the env.
- Source resolution (`resolveCatalogueSource`): `CATALOGUE_SOURCE=fixtures`
  → labelled fixtures; `MONGODB_URI` present → database; non-production
  without URI → fixtures; **production without URI → unavailable state**
  (honest error, never silent fixtures). A *failed query* returns
  `{ ok: false }` → friendly retry state; it **never** falls back to
  fixtures.
- `.env.example` added (placeholders only) with `.gitignore` exception; no
  secrets exist in source. ESLint `no-restricted-imports` blocks
  `src/lib/db` and `src/models/*` from `src/components/**`.

## C. Models & schema

- `src/models/category.ts`, `src/models/product.ts` — full field rules per
  `docs/DATABASE_SCHEMA.md`: unique normalised slugs (slugify setter),
  embedded image/variant subdocuments, `status` draft/published,
  availability, featured, sortOrder, tags, timestamps, stock scaffolding
  (unused), and indexes:
  - categories: `{isActive, sortOrder}`; products: `{status, sortOrder}`,
    `{status, categoryId, sortOrder}`, `{status, featured, sortOrder}`;
    unique slugs on both.
  - `autoIndex: false` — indexes are created by `npm run seed` (via
    `createIndexes()`, which only adds what's missing).
- **Money:** `priceCents: number | null`, integer-only validators
  (`Number.isInteger`, ≥ 1 cent) on products *and* variants, `currency`
  enum `"CAD"`. Zero-dollar placeholders rejected; `null` renders as
  "Price to be confirmed". No floats anywhere.
- **Images:** references only (`https` secureUrl, required alt ≤ 300,
  sortOrder, optional publicId/width/height, ≤ 10 per product).

## D. Validation, repositories, reads

- `src/lib/validations/catalogue.ts` (Zod 4): DTO schemas (per-record
  parsing of database documents), slug pattern, and bounded input rules —
  page ≥ 1, pageSize 1–48 (default 12), search ≤ 100 chars.
- `src/lib/repositories/catalogue.ts` — the single public read funnel:
  active categories; published products (paged); by category; search;
  by slug; featured; related (same category, self excluded); category
  counts; homepage showcase; totals. Guarantees: `status: "published"` +
  active category only; search input regex-escaped (`escapeRegExp`) and
  length-capped (M0-friendly substring match, no Atlas Search); stable
  sort by `sortOrder` then slug; invalid records dropped + logged (never
  crash, never render); `ReadResult` instead of throws; `_id` serialised
  to string.
- Draft leakage is impossible through any read: verified by unit tests
  (listings, search, counts, related, featured, detail, slug lookup).

## E. `/menu` — filter, search, pagination

- Server-driven explorer: category chips (`router.push`), debounced search
  (350 ms, `router.replace`), pending-state transitions, `aria-pressed`
  chips, `aria-live` result summary, pagination links with
  `aria-current="page"` and a bounded page window.
- **Shareable URL state** (`category`, `search`, `page`, `pageSize`)
  through `menuUrl()`; Back/Forward restore state (e2e-verified);
  malformed params fall back safely; a page past the end shows an honest
  "That's the end of the menu" state instead of a silent clamp.
- Cards: image/placeholder, name, short description, price **only when
  configured** (`$18.00 CAD` formatting via `formatCad`; otherwise "Price
  to be confirmed"), availability badge, Signature badge for featured
  items, and a detail link. **No Add-to-Cart / buy affordances anywhere.**
- Homepage "Signature Favourites" reads the DB showcase (featured +
  published) with an honest empty state and a calm error state.

## F. `/menu/[slug]` — detail, related, 404

- Breadcrumb trail (Home / Menu / category / name), back link, gallery
  (main + thumbnails, keyboard + `aria-pressed`, decorative thumb images
  with descriptive button labels), price-or-"Price to be confirmed",
  "About this dish", and **related products excluding the current item**.
- 404s for unknown, **draft**, and malformed slugs. Draft never leaks via
  metadata, JSON-LD or related products.
- **Real 404 status codes** (not soft 404s): under Cache Components the
  route's static shell would flush with `200` before `notFound()` ran —
  verified empirically (200 + correct UI + `noindex` patch). Per the
  framework's own guidance (`/docs/messages/blocking-prerender-client-hook`)
  the existence check now runs in **`src/proxy.ts`** (Next 16 Proxy, Node
  runtime, runs before any response starts):
  - malformed slug → 404 rewrite without touching the database;
  - unknown/draft slug → repository check → 404 rewrite;
  - **database trouble → pass-through** (the page renders its retry
    state; an outage must never look like "product missing");
  - fixtures mode and unavailable-catalogue mode share the same
    repository function as the pages — one implementation of every rule.
  - Verified on the production server: `/menu/does-not-exist`,
    `/menu/preview-draft-item`, `/menu/Not%20ASlug` → **404** with the
    designed not-found UI; published product and all other routes → 200.
- `export const instant = false` opts the segment out of shell validation
  (also required because the shared header's `usePathname()` cannot
  prerender for build-time-unknown params), and `connection()` in the
  segment layout keeps every visit a fresh request-time render. The
  segment keeps its `loading.tsx` streaming skeleton for valid reads;
  404 correctness does not depend on it, because the proxy decides
  before any rendering — the shell never commits a status for a missing
  slug.

## G. Cloudinary display & gallery

- `FoodMedia` renders `next/image` only when `NEXT_PUBLIC_CLOUDINARY_ENABLED`
  (inlined from `CLOUDINARY_CLOUD_NAME` **at build**) is set **and** the
  URL validates (`https`, host exactly `res.cloudinary.com`, path
  `/<cloud>/image/upload/`, pinned to your cloud when configured). Any
  other URL → designed placeholder. No API secrets anywhere; the config
  gate keeps the render guard and `images.remotePatterns` in agreement.
- Fixed aspect boxes + explicit dimensions/sizing → no layout shift;
  `onError` falls back to the placeholder; alt text comes from the record
  (required in the schema). Phase 1 placeholder art preserved everywhere
  delivery is disabled (all builds this phase).
- The demo product now carries two **preview media slots** so the gallery
  is exercised end-to-end (screenshots + e2e thumbnail assertions). No
  upload/delete endpoints exist (Phase 3+).

## H. Pricing & content honesty

- `formatCad` renders configured amounts as `$18.00 CAD`; unconfigured
  prices render "Price to be confirmed" (detail) / hide the price line
  (cards) with the explanatory note "Final pricing is published when
  ordering opens."
- No invented prices, hours, contact details, delivery regions, reviews,
  ratings or "bestseller" claims anywhere; schema.org `Product` JSON-LD
  includes `offers`/`aggregateRating`/`review` **only if real data exists**
  (it doesn't → omitted). Canonical URLs render only when a production
  `NEXT_PUBLIC_SITE_URL` is configured; preview-catalogue pages are
  `noindex` (build-time default, plus Next's own patch on streamed 404s).

## I. Caching / PPR / build behaviour

- DB reads happen **only at request time**: page loaders `await io()`
  (from `next/cache`) before any read, so prerendering never touches the
  database; React `cache()` dedupes page + `generateMetadata` queries per
  request. **No `"use cache"` on catalogue data** — prices and availability
  are always fresh, never indefinitely cached.
- Verified: `next build` succeeds with **no database configured** (zero
  build-time DB work). Route table: `/` and `/menu` keep Partial Prerender
  shells; `/menu/[slug]` is request-rendered (`instant = false` +
  `connection()`); `ƒ Proxy (Middleware)` registered. Catalogue updates appear without a
  redeploy.

## J. Seeding (explicit and safe)

`npm run seed` (`scripts/seed.ts`, tsx) — **never runs automatically**:
- Refuses without `MONGODB_URI`, without `--yes`, and in production
  without `--force-production`.
- Prints a **masked target** (`host / database`) before connecting.
- `$setOnInsert` only → idempotent, cannot overwrite existing documents;
  no drops/deletes; `createIndexes()` adds missing indexes only.
- Seeds 3 categories + 11 published preview products + the draft record
  (seeded **as draft**); prices insert as `null` (honest).
- All four safety paths smoke-tested locally with a deliberately
  unresolvable host (`.invalid`): refusal messages, masked dry run,
  production refusal, and a clean failure with **no credentials in
  output**. **Not run against any hosted database** (no credentials exist).

## K. Design, mobile, testing & verification

**Design/mobile:** tokens, fonts and palette untouched; `Section` padding
rule honoured; all interactions keep `focus-gold` + reduced-motion support.
No horizontal overflow at **320/360/375/390/430/667×375/844×390/768/1024/1440**
for any route including the new states (screenshot utility asserts it).
Phase 1B mobile-nav architecture (portal panel) untouched and re-tested.
Copy is Canadian English and **em-dash-free** (e2e scan includes the detail
page).

**Command results (all executed locally):**

| Command | Result |
| --- | --- |
| `npx next typegen` | ✅ Types generated successfully |
| `npm run typecheck` | ✅ 0 errors |
| `npm run lint` | ✅ 0 errors, 0 warnings |
| `npm run test` | ✅ **133/133** (17 files) — +106 new Phase 2 tests |
| `npm run build` | ✅ success; no DB at build; PPR kept on `/` + `/menu`; proxy registered |
| `npm run test:e2e` | ✅ **32/32** — smoke + mobile + new `catalogue` suite, run against the **production build** |
| `npm run screenshots` | ✅ **75 captures** (7 routes × 10 viewports + 5 open-menu) + 6 unavailable-state captures, **0 horizontal overflow** |
| Visual review | ✅ two passes (mobile, desktop) incl. detail gallery, filter state, 404, unavailable states |

**E2E note:** the suite's webServer now runs `next build && next start`
with `CATALOGUE_SOURCE=fixtures`. Reason: dev-server compile contention
under 5 workers caused false timeouts, and 404/metadata/proxy assertions
should test the real artifact. The suite covers: listing/filter/search/
pagination/reset/past-end/malformed params, shareable URLs + Back/Forward,
detail page (breadcrumb, price state, gallery thumbnails, related
excluded), metadata + JSON-LD (no fabricated offers/ratings/review),
`noindex` in preview mode, 404 for unknown/draft/malformed slugs, and no
internals in error copy.

## L. Limitations, pending items & next steps

**Pending cloud verification (no credentials supplied):**
- Atlas M0 cluster creation, real `MONGODB_URI` reads, seed-against-hosted-DB
  (requires owner authorization), and the five verification steps in
  `docs/MONGODB_SETUP.md`.
- Cloudinary account/cloud, real image delivery, and the checks in
  `docs/CLOUDINARY_SETUP.md`.

**Known limitations:**
- Homepage category tiles remain local presentation data (the menu page is
  the DB-driven surface) — documented, intentional.
- Fixtures mode (`noindex` + "Preview catalogue" badge) is the reviewable
  default until credentials exist; production without a database shows the
  honest unavailable state.
- Proxy DB checks run per product-page request (including link prefetches);
  one indexed read, acceptable at this scale.
- Client-side navigation to a product detail page shows the segment's
  loading skeleton while the database read streams in; the route renders
  per request (`connection()`), so there is no static shell for it.
- `npm audit` still reports the Phase 1 dev-only `braces` advisory (no
  upstream fix; no production impact).

**Git:** Phase 1 (`a27bf20`) and Phase 1B (`4ad3cce`) preserved on local
`main`; Phase 2 committed on top. **Push to GitHub attempted, still
blocked:** no stored credential, no SSH key, no `gh` CLI on this machine —
and embedding tokens is forbidden. The exposed PAT from earlier must be
rotated by the owner (it is not usable by me and must not be re-shared).

**Next (requires approval): Phase 3** — admin auth + CRUD, image uploads,
cart/checkout decisions, deployment. Business inputs still outstanding:
logo, photography, prices, hours, contact details, delivery regions.
