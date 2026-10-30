# PEARL Signature

**Authentic Nigerian flavours, made beautifully.**

PEARL Signature is a premium Canadian-based online food business serving
authentic Nigerian foods, pastries, snacks and traditional drinks. Customers
browse the menu online and order for home delivery or prearranged pickup,
paying online or with cash on arrival.

This repository contains the public storefront and the private owner
dashboard. It is a live commercial project — Phase 1 (project foundation,
design system and interactive storefront), Phase 2 (catalogue data layer
and product experience), Phase 3 (admin authentication, catalogue
management and signed uploads), Phase 4 (guest cart and checkout review),
Phase 5 (order placement, Cash on Arrival and order management), Phase 6
(Stripe hosted Checkout, verified payment webhooks and reconciliation, test
mode only) and Phase 7 (transactional email and secure guest order tracking)
are implemented. Live payments, deployment and a real email account require
later approval (see `docs/PHASE_PROGRESS.md`).

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
| Orders | Snapshot documents in MongoDB: unique reference, idempotency key, optimistic concurrency |
| Payments | Cash on Arrival recorded by the owner; Stripe hosted Checkout for online payment (test mode only, no card data on this site) |
| Rate limiting | MongoDB attempt buckets with TTL (login, order placement, confirmation reads, payment initiation) |
| Notifications | Outbox queue with atomic claims, leases and bounded retries; Resend transactional email (free tier) plus a guarded processor |
| Order tracking | Private `/track` page: guest capability or a hashed, order-scoped grant obtained by verifying the order's email address |
| Unit tests | Vitest + React Testing Library |
| E2E tests | Playwright (storefront, cart/checkout, disposable admin stack, disposable orders stack, disposable tracking stack) |
| Packages | npm |

**Reserved for later phases:** live Stripe activation, refund automation,
marketing/SMS notifications and a deployment scheduler. No
Supabase/Firebase/Postgres; no paid services.

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
npm run notifications:process   # drain the notification outbox once (bounded scan)
```

Catalogue source rules: with `MONGODB_URI` set the site reads MongoDB;
`CATALOGUE_SOURCE=fixtures` forces the labelled preview catalogue (dev/preview
only); production without either shows an honest "temporarily unavailable"
state — never silent fallbacks.

## Environment

Copy `.env.example` to `.env.local` and fill only what you need. The
application builds and runs with none of it set.

| Variable | Purpose |
| --- | --- |
| `MONGODB_URI` | Atlas connection string (server-only) |
| `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET` | Photo delivery and signed uploads |
| `NEXT_PUBLIC_SITE_URL` | Canonical origin for metadata and payment return URLs |
| `STRIPE_PAYMENTS_ENABLED` | Explicit server switch, must be exactly `true` to enable online payment |
| `STRIPE_SECRET_KEY` | Stripe **test** secret key (`sk_test_*`); live keys are rejected |
| `STRIPE_WEBHOOK_SECRET` | Webhook signing secret (`whsec_*`) |
| `NOTIFICATION_PROVIDER`, `RESEND_API_KEY`, `EMAIL_FROM` | Transactional email (Resend, free tier); blank means nothing is sent |
| `OWNER_NOTIFICATION_EMAIL` | Where store alerts go; blank falls back to the active owner admin |
| `NOTIFICATION_PROCESSOR_SECRET` | Bearer secret for the guarded processor endpoint |
| `RESEND_WEBHOOK_SECRET` | Optional delivery callbacks (bounced/complained/delivered) |

Online payment also needs the owner switch at `/admin/settings`, and it stays
off until both are configured. Full setup, webhook registration and the manual
test-mode pass: `docs/STRIPE_INTEGRATION.md`.

Email is off until a provider, key and sender exist; the queue still records
every event. Full setup: `docs/EMAIL_NOTIFICATIONS.md` and
`docs/NOTIFICATION_PROCESSING.md`.

## Quality & test commands

```bash
npm run lint         # ESLint (next/core-web-vitals + TypeScript rules)
npm run typecheck    # tsc --noEmit (run `npx next typegen` first if .next/ is empty)
npm run test         # Vitest unit/component tests (single run)
npm run test:watch   # Vitest watch mode
npm run test:e2e     # Playwright: storefront suites + admin suite (disposable
                     # cart fixtures on port 3002, admin memory MongoDB on 3001)
                     # + the Phase 5 orders suite (port 3003) + the Phase 7
                     # tracking suite (port 3004), each with its own memory DB
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
│   ├── checkout/           # Checkout review, pricing and order submission
│   ├── order-confirmation/ # Guest confirmation behind an opaque capability
│   ├── api/stripe/webhook/ # Signature-verified Stripe event endpoint (POST)
│   ├── about/page.tsx
│   ├── contact/page.tsx
│   ├── admin/              # Owner dashboard: login, products, categories, orders, settings
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
│   ├── tracking/           # Guest order tracking view, timeline, recovery form
│   ├── shared/             # Wordmark, FoodMedia, ProductCard
│   └── providers/          # MotionProvider (reduced-motion config)
├── data/                   # Labelled preview fixtures (dev/preview only)
├── models/                 # Mongoose schemas (autoIndex off): category, product,
│                           # admin, admin-session, login-attempt, audit-log,
│                           # order, order-attempt, notification-outbox, store-config,
│                           # payment-attempt, stripe-event, payment-refund,
│                           # tracking-challenge, order-access-grant
├── lib/
│   ├── db/                 # Server-only Mongoose connection (cached, HMR-safe)
│   ├── auth/               # Password (Argon2id), sessions, guards, rate limit, audit
│   ├── cloudinary/         # Signed uploads + server-side asset verification
│   ├── actions/            # Server Actions: login, catalogue, images, cart quote, orders, payments, tracking
│   ├── cart/               # Guest cart store, quote reconciliation, limits, pricing rules
│   ├── checkout/           # Order pricing, checkout readiness, attempt keys
│   ├── orders/             # Order creation, lifecycle rules, public rate limiting, tracking helpers
│   ├── payments/           # Stripe readiness, Checkout sessions, verified events, reconciliation
│   ├── notifications/      # Outbox processing, provider adapters, templates, email rendering, observability
│   ├── repositories/       # Catalogue read layer + admin list/dashboard queries
│   ├── store/              # Owner-managed fulfilment, fee and tax configuration
│   ├── validations/        # Zod schemas: catalogue, admin, checkout, orders, settings, tracking
│   └── server/             # Page data loaders (io() + React cache)
└── types/                  # Shared domain types
e2e/                        # Playwright: storefront, cart/checkout, admin, orders, tracking suites
scripts/screenshots.mjs     # Design-review utility (storefront + admin + tracking captures)
scripts/seed.ts             # Explicit, idempotent MongoDB seed (never auto-runs)
scripts/admin-bootstrap.ts  # Guarded first-owner CLI (hidden password prompt)
scripts/admin-reset-password.ts  # Guarded password rotation (revokes sessions)
scripts/process-notifications.ts # Bounded outbox drain (one scan, then exit)
scripts/e2e-admin-server.ts # Disposable admin e2e stack (memory MongoDB + seed + bootstrap)
scripts/e2e-cart-server.ts  # Isolated fixture-only cart server on port 3002
scripts/e2e-orders-server.ts # Disposable orders/tracking stack (ports 3003 and 3004)
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
  control exists. Fulfilment, fees and taxes remain unconfirmed. (Phase 4
  boundary: Phase 5 adds the submission control and real configuration.)
- 496 Vitest tests, 79 Playwright tests and 161 responsive screenshots passed;
  screenshots reported zero horizontal overflow.

**Phase 5 — implemented, awaiting review:** orders, Cash on Arrival and order
management (see `docs/PHASE5_REPORT.md`, `docs/ORDER_ARCHITECTURE.md`,
`docs/ORDER_LIFECYCLE.md`, `docs/CASH_ON_ARRIVAL.md`,
`docs/ADMIN_ORDER_OPERATIONS.md`, `docs/ORDER_NOTIFICATIONS.md` and
`docs/BUSINESS_CONFIGURATION.md`):

- Owner-managed configuration (intake switch, delivery areas with fees,
  pickup instructions, tax treatment) with no hardcoded fee, rate or
  address; unconfigured tax blocks live submission with a stated reason.
- The server re-quotes and reprices every submission, then stores a frozen
  snapshot order with a unique `PS-` reference, an idempotency key and an
  optimistic-concurrency `version`. A double submit creates one order; a
  tampered total is refused before anything is written.
- Cash on Arrival only: the owner records receipt on the order, a second
  recording is refused, and payment state never changes the lifecycle state.
- Lifecycle and admin management at `/admin/orders` and
  `/admin/orders/[id]`: legal transitions only, required cancellation
  reasons, conflict messages, notes, history, and dashboard metrics counted
  from real records (unpaid orders are outstanding, never collected).
- `/order-confirmation` opens only for the browser that placed the order;
  public submission and confirmation reads are rate limited; notifications
  sit in a tested outbox that stays honestly `pending` until a provider is
  chosen.

**Phase 6 — implemented in Stripe test mode, awaiting review:** online payment,
verified webhooks and reconciliation (see `docs/PHASE6_REPORT.md`,
`docs/STRIPE_INTEGRATION.md`, `docs/PAYMENT_LIFECYCLE.md` and
`docs/PAYMENT_RECONCILIATION.md`):

- Checkout now offers **Cash on arrival** or **Online payment**. The online
  choice is visibly disabled with an honest message until a complete Stripe
  test-mode configuration exists **and** the owner turns it on in
  `/admin/settings`.
- Payment is a hosted Stripe Checkout Session for the immutable order snapshot
  total in CAD cents. No card form, no card data, and no browser-supplied
  amount, fee, tax, currency or status is accepted.
- A durable attempt with a stable idempotency key is written before the Stripe
  call, so an ambiguous timeout cannot produce a second chargeable session;
  retries reuse a valid open session and replace only a provider-confirmed
  expired or failed one.
- `/api/stripe/webhook` verifies the signature over the raw body and records
  every event durably before changing financial state. Duplicate and
  out-of-order events cannot corrupt a paid order; a completed but unpaid
  session becomes `processing`, not `paid`; a late payment after cancellation
  is retained, flagged for review and never resurrects the order.
- Refunds are recorded from verified provider events only. No refund is
  initiated, offered or automated, and cancelling an order is not a refund.
- The admin shows payment detail, attempt history, provider refunds and a
  dry-run-first reconciliation control whose apply step requires a second
  confirmation and is audited. The dashboard separates online settlement,
  cash collection, outstanding, pending, failed, refunds, gross and net.
- 713 Vitest tests (52 files) and 88 Playwright tests pass; the new orders test
  proves online payment stays unavailable without explicit test configuration.
  A genuine Stripe test-mode payment has **not** been executed in this
  environment; the operator steps are in `docs/STRIPE_INTEGRATION.md` §11.

**Phase 7 — implemented, awaiting review:** transactional email and secure
guest order tracking (see `docs/PHASE7_REPORT.md`, `docs/EMAIL_NOTIFICATIONS.md`,
`docs/NOTIFICATION_PROCESSING.md` and `docs/ORDER_TRACKING.md`):

- Resend transactional email behind a provider contract, with eleven branded
  responsive templates that each carry a plain-text alternative. No invented
  business facts, no secrets in a message, no em dashes in customer copy.
- The Phase 5 outbox extended rather than replaced: distinct lifecycle events,
  provider message id and acceptance state, atomic claims with leases, bounded
  retries, a separate ambiguous-outcome budget and a 30-day TTL from acceptance
  so unresolved failures are never silently deleted.
- A guarded processor (`POST /api/notifications/process` with a bearer secret,
  plus `npm run notifications:process`). Missing configuration changes nothing
  about ordering: events are still recorded, nothing is reported as sent and
  the admin shows an honest warning.
- `/admin/notifications`: readiness without secrets, queue counts, recent
  accepted messages, last attempt and last acceptance, and a failed list with
  sanitised reasons and an entry-id-only retry that keeps the idempotency key.
- `/track`: guest tracking on the existing capability, plus cross-device
  recovery by reference and email. Recovery answers generically whether or not
  the order exists, emails a single-use six-digit code and issues a hashed,
  order-scoped, 24-hour grant. No capability appears in a URL and there is no
  reference-only lookup.
- A timeline per fulfilment method with honest payment states: a cancelled
  order is never shown as completed, and a refund the provider has not
  confirmed is never described as money returned.
- 794 Vitest tests (59 files) and 96 Playwright tests across five projects pass.
  **No real email has been sent**: no Resend account, verified domain, sender or
  owner recipient was supplied, and no automatic scheduler exists yet.

Hosted Atlas and real Cloudinary verification remain pending owner-supplied
credentials. Prices, delivery areas, pickup arrangements, business hours and
contact details remain pending until supplied by the business
(`docs/BUSINESS_CONFIGURATION.md` carries the pre-launch checklist). Live
Stripe activation, email credentials, a deployment scheduler and deployment
itself require explicit approval for a later phase.

## Documentation

| File | Contents |
| --- | --- |
| `docs/PROJECT_SPEC.md` | Business requirements, features, unresolved details |
| `docs/DESIGN_SYSTEM.md` | Colours, typography, spacing, motion, a11y, imagery |
| `docs/PHASE_PROGRESS.md` | Phase 1–7 results, verification log and approval boundary |
| `docs/PHASE1B_REMEDIATION_REPORT.md` | Root causes, fixes, verification and evidence for the mobile remediation |
| `docs/PHASE2_REPORT.md` | Phase 2 implementation report (sections A–L) |
| `docs/PHASE3_REPORT.md` | Phase 3 implementation report (sections A–M) |
| `docs/PHASE4_REPORT.md` | Phase 4 implementation report (sections A–O) |
| `docs/PHASE5_REPORT.md` | Phase 5 implementation report (sections A–O) |
| `docs/PHASE6_SPEC.md` | Phase 6 requirements snapshot |
| `docs/PHASE6_PROGRESS.md` | Phase 6 milestones, integration map and verification log |
| `docs/PHASE6_REPORT.md` | Phase 6 implementation report (sections A–S) |
| `docs/PHASE7_SPEC.md` | Phase 7 requirements snapshot |
| `docs/PHASE7_PROGRESS.md` | Phase 7 milestones, decisions and verification log |
| `docs/PHASE7_REPORT.md` | Phase 7 implementation report (sections A–S) |
| `docs/EMAIL_NOTIFICATIONS.md` | Provider setup, events, templates and failure behaviour |
| `docs/NOTIFICATION_PROCESSING.md` | Claims, leases, retries, guarded processor and scheduling |
| `docs/ORDER_TRACKING.md` | `/track`, capability/grant access and email recovery |
| `docs/STRIPE_INTEGRATION.md` | Stripe configuration, readiness gates, session shape and test-mode pass |
| `docs/PAYMENT_LIFECYCLE.md` | Payment states, event mapping, monotonicity and refund foundations |
| `docs/PAYMENT_RECONCILIATION.md` | Dry-run/apply reconciliation, safety properties and limits |
| `docs/ORDER_ARCHITECTURE.md` | Order placement pipeline, request contract, idempotency and rate limits |
| `docs/ORDER_LIFECYCLE.md` | Status graph, method-aware rules, refusals and concurrency |
| `docs/CASH_ON_ARRIVAL.md` | Payment recording, dashboard accounting rules and exclusions |
| `docs/ADMIN_ORDER_OPERATIONS.md` | Owner guide: order list, detail page, confirmations and metrics |
| `docs/ORDER_NOTIFICATIONS.md` | Outbox design, configuration states, retries and privacy |
| `docs/BUSINESS_CONFIGURATION.md` | What the owner must configure, plus the pre-launch checklist |
| `docs/CART_ARCHITECTURE.md` | Guest cart state, limits, server quote and failure behaviour |
| `docs/CHECKOUT_FOUNDATION.md` | Review-only checkout, Canadian field validation and explicit exclusions |
| `docs/MANUAL_TESTING.md` | Plain-language review guide for the business owner |
| `docs/ADMIN_AUTH.md` | Admin authentication & security model (sessions, rate limiting, CLIs) |
| `docs/ADMIN_OPERATIONS.md` | Owner guide: dashboard, products, categories, photos |
| `docs/DATABASE_SCHEMA.md` | Collections, fields, indexes, validation and visibility rules |
| `docs/MONGODB_SETUP.md` | Atlas M0 setup, env config, connection behaviour, seeding |
| `docs/CLOUDINARY_SETUP.md` | Cloud setup, delivery guards, gallery behaviour, migration path |
| `docs/CLOUDINARY_UPLOADS.md` | Signed upload flow, verification contract, runbook |
