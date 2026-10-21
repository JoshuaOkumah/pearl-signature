# PEARL Signature

**Authentic Nigerian flavours, made beautifully.**

PEARL Signature is a premium Canadian-based online food business serving
authentic Nigerian foods, pastries, snacks and traditional drinks. Customers
browse the menu online and order for home delivery or prearranged pickup,
paying online or with cash on arrival.

This repository contains the public storefront. It is a live commercial
project — Phase 1 (project foundation, design system and interactive
storefront) is complete; database, payments, cart and admin belong to later
phases (see `docs/PHASE_PROGRESS.md`).

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
| Unit tests | Vitest + React Testing Library |
| E2E tests | Playwright |
| Packages | npm |

**Not yet used (reserved for later phases):** MongoDB Atlas M0, Mongoose,
Cloudinary, Stripe, Zod, session-based admin auth. No Supabase/Firebase/Postgres.

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
npm run build        # production build
npm run start        # serve the production build
```

## Quality & test commands

```bash
npm run lint         # ESLint (next/core-web-vitals + TypeScript rules)
npm run typecheck    # tsc --noEmit (run `npx next typegen` first if .next/ is empty)
npm run test         # Vitest unit/component tests (single run)
npm run test:watch   # Vitest watch mode
npm run test:e2e     # Playwright smoke tests (starts its own server)
npm run screenshots  # capture responsive screenshots + overflow check
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
│   ├── menu/page.tsx       # Menu preview (streams searchParams via Suspense)
│   ├── about/page.tsx
│   ├── contact/page.tsx
│   ├── globals.css         # Design tokens (@theme) + base/utility styles
│   └── icon.svg            # Favicon (pearl mark)
├── components/
│   ├── ui/                 # Primitives: Button, Chip, Badge, Section, Accordion…
│   ├── layout/             # Header, MobileNav, Footer
│   ├── home/               # Homepage sections (Hero, Categories, …)
│   ├── menu/               # MenuExplorer + skeleton
│   ├── shared/             # Wordmark, FoodMedia, ProductCard
│   └── providers/          # MotionProvider (reduced-motion config)
├── data/                   # Typed preview data: products, categories, faqs, nav
├── lib/                    # Utilities: cn, slugify, menu filtering
└── types/                  # Shared domain types
e2e/                        # Playwright smoke tests
scripts/screenshots.mjs     # Responsive design-review utility
docs/                       # Project spec, design system, phase progress
vitest.config.mts           # Vitest setup (jsdom)
playwright.config.ts        # Playwright setup
```

## Current implementation status

**Phase 1 — complete**

- `/` — homepage: hero, categories, signature favourites, brand story,
  ordering journey, closing CTA, FAQ accordion
- `/menu` — category-filterable menu preview over local typed data (no prices,
  no checkout — ordering features are being prepared)
- `/about`, `/contact` — informational pages (no invented contact details)
- Sticky responsive header with accessible mobile navigation; brand footer
- Design tokens, animation system, reduced-motion support
- 23 Vitest unit tests + 4 Playwright smoke tests passing

**Deliberately out of scope for Phase 1:** MongoDB, Cloudinary, Stripe, cart,
checkout, order placement, admin auth/dashboard, notifications, deployment.
Prices, delivery areas, business hours and contact details remain pending until
supplied by the business — nothing is invented.

## Documentation

| File | Contents |
| --- | --- |
| `docs/PROJECT_SPEC.md` | Business requirements, features, unresolved details |
| `docs/DESIGN_SYSTEM.md` | Colours, typography, spacing, motion, a11y, imagery |
| `docs/PHASE_PROGRESS.md` | Phase 1 results, verification log, next phase |
