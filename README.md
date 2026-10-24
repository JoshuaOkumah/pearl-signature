# PEARL Signature

**Authentic Nigerian flavours, made beautifully.**

PEARL Signature is a premium Canadian-based online food business serving
authentic Nigerian foods, pastries, snacks and traditional drinks. Customers
browse the menu online and order for home delivery or prearranged pickup,
paying online or with cash on arrival.

This repository contains the public storefront and the private owner
dashboard. It is a live commercial project — Phase 1 (project foundation,
design system and interactive storefront), Phase 2 (catalogue data layer
and product experience) and Phase 3 (admin authentication, catalogue
management and signed uploads) and Phase 4 (guest cart and checkout review)
are implemented. Order submission, payments and deployment require later
approval (see `docs/PHASE_PROGRESS.md`).

---

## Tech stack

| Layer | Choice |
| --- | --- |
| Framework | Next.js 16 (App Router, Cache Components + Partial Prefetching) |
| Language | TypeScript (strict) |
| UI | React 19 |
| Styling | Tailwind CSS v4 (tokens via `@theme`) |
| Animation | Motion for React (`motion`) |
| Icons | Lucide React |
| Fonts | `next/font` — Fraunces (display) + Manrope (interface) |
| Database | MongoDB (Atlas M0 free tier) via Mongoose 9, server-only |
| Validation | Zod 4 at every server boundary |
| Admin auth | Argon2id (`@node-rs/argon2`) + DB-backed sessions (hashed opaque tokens) |
| Guest cart | Versioned browser `localStorage` + read-only server quote action |
| Unit tests | Vitest + React Testing Library |
| E2E tests | Playwright (storefront, cart/checkout fixtures + disposable admin stack) |
| Packages | npm |

**Reserved for later phases:** Stripe. No Supabase/Firebase/Postgres; no
paid services.

## Requirements

- Node.js 20.9+ (developed on Node 24)
- npm 10+
- Internet access on first install (fonts are self-hosted at build time)

## Installation

```bash
git clone https://github.com/JoshuaOkumah/pearl-signature.git
cd pearl-signature
npm install
```

## Development commands

```bash
npm run dev          # start dev server → http://localhost:3000
npm run build        # production build (never touches the database)
npm run start        # serve the production build
npm run seed -- --yes  # seed MongoDB (explicit, idempotent; see docs/MONGODB_SETUP.md)
npm run admin:bootstrap -- --yes   # create the first owner account (guarded CLI)
npm run admin:reset -- --email <email> --yes   # rotate a password, revoke its sessions
```

Catalogue source rules: with `MONGODB_URI` set the site reads MongoDB;
`CATALOGUE_SOURCE=fixtures` forces the labelled preview catalogue (dev/preview
only); production without either shows an honest "temporarily unavailable"
state — never silent fallbacks.

## Quality & test commands

```bash
npm run lint         # ESLint (next/core-web-vitals + TypeScript rules)
npm run typecheck    # tsc --noEmit (run `npx next typegen` first if .next/ is empty)
npm run test         # Vitest unit/component tests (single run)
npm run test:watch   # Vitest watch mode
npm run test:e2e     # Playwright: storefront suites + admin suite (disposable
                     # cart fixtures on port 3002, admin memory MongoDB on 3001)
npm run screenshots  # capture responsive screenshots (storefront + admin surfaces,
                     # incl. cart/checkout and modal states) + overflow check
node scripts/audit-mobile.mjs   # diagnostic: DOM geometry, hit-testing, computed contrast
```

First-time Playwright setup:

```bash
npx playwright install chromium
```

## Project structure

```
src/
├── app/                    # Routes (App Router), root layout, global styles
│   ├── layout.tsx          # Fonts, metadata, header/main/footer shell
│   ├── page.tsx            # Homepage composition
│   ├── menu/page.tsx       # Menu (streams searchParams via Suspense)
│   ├── menu/[slug]/        # Product detail (blocking route: real 404s)
│   ├── cart/               # Guest cart editing surface
│   ├── checkout/           # Local-only checkout review foundation
│   ├── about/page.tsx
│   ├── contact/page.tsx
│   ├── admin/              # Owner dashboard: login, products, categories
│   ├── globals.css         # Design tokens (@theme) + base/utility styles
│   └── icon.svg            # Favicon (pearl mark)
├── proxy.ts                # Next 16 Proxy: slug check + previous-slug 308 redirects
├── components/
│   ├── ui/                 # Primitives: Button, Chip, Badge, Section, Accordion…
│   ├── layout/             # Header, MobileNav, Footer, SiteChrome
│   ├── home/               # Homepage sections (Hero, Categories, …)
│   ├── menu/               # MenuExplorer, gallery, breadcrumbs, detail, states
│   ├── cart/               # Cart drawer, rows, summary, quantity controls
│   ├── checkout/           # Review UI and local customer form
│   ├── admin/              # AdminShell, forms, tables, image manager, fields
│   ├── shared/             # Wordmark, FoodMedia, ProductCard
│   └── providers/          # MotionProvider (reduced-motion config)
├── data/                   # Labelled preview fixtures (dev/preview only)
├── models/                 # Mongoose schemas (autoIndex off): category, product,
│                           # admin, admin-session, login-attempt, audit-log
├── lib/
│   ├── db/                 # Server-only Mongoose connection (cached, HMR-safe)
│   ├── auth/               # Password (Argon2id), sessions, guards, rate limit, audit
│   ├── cloudinary/         # Signed uploads + server-side asset verification
│   ├── actions/            # Server Actions: login, catalogue, images, read-only cart quote
│   ├── cart/               # Guest cart store, quote reconciliation, limits, pricing rules
│   ├── repositories/       # Catalogue read layer + admin list queries
│   ├── validations/        # Zod schemas: catalogue DTOs + admin forms
│   └── server/             # Page data loaders (io() + React cache)
└── types/                  # Shared domain types
e2e/                        # Playwright: storefront suites + admin suite (e2e/admin)
scripts/screenshots.mjs     # Design-review utility (storefront + admin captures)
scripts/seed.ts             # Explicit, idempotent MongoDB seed (never auto-runs)
scripts/admin-bootstrap.ts  # Guarded first-owner CLI (hidden password prompt)
scripts/admin-reset-password.ts  # Guarded password rotation (revokes sessions)
scripts/e2e-admin-server.ts # Disposable admin e2e stack (memory MongoDB + seed + bootstrap)
scripts/e2e-cart-server.ts  # Isolated fixture-only cart server on port 3002
scripts/audit-mobile.mjs    # Diagnostic: DOM geometry, hit-testing, contrast measurement
docs/                       # Spec, design system, phase progress, reports, guides
vitest.config.mts           # Vitest setup (jsdom)
playwright.config.ts        # Playwright setup (e2e runs against the production build)
```

## Current implementation status

**Phase 1 — complete**

- `/` — homepage: hero, categories, signature favourites, brand story,
  ordering journey, closing CTA, FAQ accordion
- `/about`, `/contact` — informational pages (no invented contact details)
- Sticky responsive header with accessible mobile navigation; brand footer
- Design tokens, animation system, reduced-motion support
- Copy is em-dash-free and WCAG AA contrast-verified on light and dark surfaces

**Phase 1B — complete:** mobile-first remediation after manual review found
navigation and layout defects (modal menu rebuilt as a portal panel with a
visible X, header overflow fixed at 320px, contrast misses corrected, copy
rewritten). See `docs/PHASE1B_REMEDIATION_REPORT.md`.

**Phase 2 — implemented, awaiting review:** the catalogue now reads from the
data layer (MongoDB when `MONGODB_URI` exists, labelled fixtures otherwise):

- `/menu` — database-driven filter chips, title-first name search (debounced,
  with clear control and relevance ranking) and server-side
  pagination (default 12, max 48) in shareable URL params; honest empty,
  past-end and "temporarily unavailable" states; cards show price only when
  configured (`$18.00 CAD` or "Price to be confirmed") — no checkout UI
- `/menu/[slug]` — product pages with breadcrumb, accessible gallery
  thumbnails, related products, and genuine 404 status codes for unknown,
  draft and malformed slugs (checked in `src/proxy.ts` before streaming)
- Draft products never leak into listings, search, related items, metadata
  or JSON-LD; prices are integer CAD cents with no invented amounts
- Cloudinary display path in `FoodMedia` (guarded `next/image`, placeholder
  fallback) ready for real photography; no upload endpoints yet
- 133 Vitest + 32 Playwright tests passing (catalogue, repository,
  gallery, mobile and smoke suites); 81 review screenshots with zero
  horizontal overflow

**Phase 3 — implemented, awaiting review:** the owner dashboard at
`/admin` (see `docs/ADMIN_AUTH.md`, `docs/ADMIN_OPERATIONS.md`,
`docs/PHASE3_REPORT.md`):

- Argon2id owner authentication with database-backed sessions (hashed
  opaque tokens, HttpOnly/Secure/SameSite cookie), MongoDB-backed login
  rate limiting (no Redis), audit logging, guarded bootstrap and
  password-reset CLIs
- Product management: create/edit with integer-cent pricing, optional
  variants, draft/published visibility, archive/restore (never delete),
  editable slugs with automatic redirects from previous addresses
- Category management: create/rename with fixed slugs, disable (never
  delete) with confirmation when products reference the category
- Signed Cloudinary uploads (server-fixed parameters, server-side asset
  verification, orphan cleanup); honest "not configured" state without
  credentials
- Storefront reflects every mutation immediately; Phase 2B search
  behaviour regression-protected; 328 Vitest + 50 Playwright tests
  (11 admin tests on a disposable in-memory MongoDB); 34 admin review
  screenshots with zero horizontal overflow

**Phase 4 — implemented, awaiting review:** guest cart and checkout review
(see `docs/PHASE4_REPORT.md`, `docs/CART_ARCHITECTURE.md` and
`docs/CHECKOUT_FOUNDATION.md`):

- Cart drawer and `/cart` support add, options, quantity changes, removal,
  clear confirmation and persistence in this browser.
- Every displayed price is checked by a read-only server quote. Client-stored
  price is only a hint and is never used as the verified amount.
- `/checkout` validates fields locally and reviews the basket. Details are
  not sent or saved; no order, payment, inventory reservation or submission
  control exists. Fulfilment, fees and taxes remain unconfirmed.
- 496 Vitest tests, 79 Playwright tests and 161 responsive screenshots passed;
  screenshots reported zero horizontal overflow.

Hosted Atlas and real Cloudinary verification remain pending owner-supplied
credentials. Prices, delivery areas, pickup arrangements, business hours and
contact details remain pending until supplied by the business. Stripe, order
creation and deployment require explicit approval for a later phase.

## Documentation

| File | Contents |
| --- | --- |
| `docs/PROJECT_SPEC.md` | Business requirements, features, unresolved details |
| `docs/DESIGN_SYSTEM.md` | Colours, typography, spacing, motion, a11y, imagery |
| `docs/PHASE_PROGRESS.md` | Phase 1–4 results, verification log and approval boundary |
| `docs/PHASE1B_REMEDIATION_REPORT.md` | Root causes, fixes, verification and evidence for the mobile remediation |
| `docs/PHASE2_REPORT.md` | Phase 2 implementation report (sections A–L) |
| `docs/PHASE3_REPORT.md` | Phase 3 implementation report (sections A–M) |
| `docs/PHASE4_REPORT.md` | Phase 4 implementation report (sections A–O) |
| `docs/CART_ARCHITECTURE.md` | Guest cart state, limits, server quote and failure behaviour |
| `docs/CHECKOUT_FOUNDATION.md` | Review-only checkout, Canadian field validation and explicit exclusions |
| `docs/MANUAL_TESTING.md` | Plain-language review guide for the business owner |
| `docs/ADMIN_AUTH.md` | Admin authentication & security model (sessions, rate limiting, CLIs) |
| `docs/ADMIN_OPERATIONS.md` | Owner guide: dashboard, products, categories, photos |
| `docs/DATABASE_SCHEMA.md` | Collections, fields, indexes, validation and visibility rules |
| `docs/MONGODB_SETUP.md` | Atlas M0 setup, env config, connection behaviour, seeding |
| `docs/CLOUDINARY_SETUP.md` | Cloud setup, delivery guards, gallery behaviour, migration path |
| `docs/CLOUDINARY_UPLOADS.md` | Signed upload flow, verification contract, runbook |
