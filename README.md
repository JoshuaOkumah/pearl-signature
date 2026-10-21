# PEARL Signature

**Authentic Nigerian flavours, made beautifully.**

PEARL Signature is a premium Canadian-based online food business serving
authentic Nigerian foods, pastries, snacks and traditional drinks. Customers
browse the menu online and order for home delivery or prearranged pickup,
paying online or with cash on arrival.

This repository contains the public storefront. It is a live commercial
project — Phase 1 (project foundation, design system and interactive
storefront) and Phase 2 (catalogue data layer and product experience) are
complete; payments, cart and admin belong to later phases (see
`docs/PHASE_PROGRESS.md`).

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
| Unit tests | Vitest + React Testing Library |
| E2E tests | Playwright |
| Packages | npm |

**Reserved for later phases:** Stripe, session-based admin auth, Cloudinary
uploads. No Supabase/Firebase/Postgres; no paid services.

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
npm run test:e2e     # Playwright: smoke, mobile/responsive and catalogue suites
                     # (webServer runs `next build && next start` in fixtures mode)
npm run screenshots  # capture responsive screenshots (incl. open-menu states) + overflow check
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
│   ├── about/page.tsx
│   ├── contact/page.tsx
│   ├── globals.css         # Design tokens (@theme) + base/utility styles
│   └── icon.svg            # Favicon (pearl mark)
├── proxy.ts                # Next 16 Proxy: slug check before render (real 404 status)
├── components/
│   ├── ui/                 # Primitives: Button, Chip, Badge, Section, Accordion…
│   ├── layout/             # Header, MobileNav, Footer
│   ├── home/               # Homepage sections (Hero, Categories, …)
│   ├── menu/               # MenuExplorer, gallery, breadcrumbs, detail, states
│   ├── shared/             # Wordmark, FoodMedia, ProductCard
│   └── providers/          # MotionProvider (reduced-motion config)
├── data/                   # Labelled preview fixtures (dev/preview only)
├── models/                 # Mongoose schemas: category, product (autoIndex off)
├── lib/
│   ├── db/                 # Server-only Mongoose connection (cached, HMR-safe)
│   ├── repositories/       # Catalogue read layer (single public funnel)
│   ├── validations/        # Zod schemas: DTOs, URL bounds, slug rules
│   └── server/             # Page data loaders (io() + React cache)
└── types/                  # Shared domain types
e2e/                        # Playwright: smoke, mobile/responsive, catalogue suites
scripts/screenshots.mjs     # Responsive design-review utility (incl. open-menu captures)
scripts/seed.ts             # Explicit, idempotent MongoDB seed (never auto-runs)
scripts/audit-mobile.mjs    # Diagnostic: DOM geometry, hit-testing, contrast measurement
docs/                       # Spec, design system, phase progress, reports, DB/Cloudinary guides
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

**Still out of scope:** Stripe, cart, checkout, order placement, admin
auth/dashboard, Cloudinary uploads, notifications, deployment. Hosted Atlas
and Cloudinary verification are pending owner-supplied credentials — see
`docs/MONGODB_SETUP.md` and `docs/CLOUDINARY_SETUP.md`. Prices, delivery
areas, business hours and contact details remain pending until supplied by
the business — nothing is invented.

## Documentation

| File | Contents |
| --- | --- |
| `docs/PROJECT_SPEC.md` | Business requirements, features, unresolved details |
| `docs/DESIGN_SYSTEM.md` | Colours, typography, spacing, motion, a11y, imagery |
| `docs/PHASE_PROGRESS.md` | Phase 1/1B/2 results, verification log, next phase |
| `docs/PHASE1B_REMEDIATION_REPORT.md` | Root causes, fixes, verification and evidence for the mobile remediation |
| `docs/PHASE2_REPORT.md` | Phase 2 implementation report (sections A–L) |
| `docs/DATABASE_SCHEMA.md` | Collections, fields, indexes, validation and visibility rules |
| `docs/MONGODB_SETUP.md` | Atlas M0 setup, env config, connection behaviour, seeding |
| `docs/CLOUDINARY_SETUP.md` | Cloud setup, delivery guards, gallery behaviour, migration path |
