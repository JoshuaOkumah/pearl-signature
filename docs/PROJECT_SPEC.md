# PEARL Signature — Product Specification

> Status: **Phases 1–5 implemented** (foundation, catalogue, admin, guest
> cart and checkout review, then orders). Phase 5 adds real order creation,
> Cash on Arrival recording, the order lifecycle, admin order management and
> a notification outbox. Online card payment, customer accounts and
> deployment remain out of scope. This document records agreed requirements;
> see `docs/PHASE_PROGRESS.md` for implementation and verification details.

---

## 1. Business overview

| Item | Value |
| --- | --- |
| Business name | PEARL Signature |
| Type | Online food store (online-only, no walk-in storefront) |
| Operating country | Canada |
| Currency | CAD |
| Fulfilment | Home delivery and optionally prearranged pickup |
| Payments | Online payment and cash on arrival |
| Management | Private admin dashboard (`/admin`, implemented in Phase 3) |

PEARL Signature sells authentic Nigerian cuisine — traditional foods, pastries,
snacks and traditional drinks — through a premium website. Customers order
online; the business prepares each order to fulfil it via delivery or a
prearranged pickup.

There is **no restaurant, dining room, walk-in storefront or publicly
advertised physical address**, and none should be implied anywhere in the UI or copy.

## 2. Customer audience

- Canadian consumers seeking authentic, carefully prepared Nigerian food.
- Individuals and families ordering comforting traditional meals at home.
- People hosting gatherings who need pastries, snacks and traditional drinks.
- The diaspora community reconnecting with familiar “taste of home” flavours.
- Newcomers to Nigerian cuisine who need clear, honest menu descriptions.

The experience must feel premium yet approachable, appetising, and trustworthy
on a phone first.

## 3. Product categories (Phase 1 catalogue)

### Traditional Foods
- Bitterleaf Soup
- Egusi Soup
- Vegetable Soup
- Ukwa

### Pastries & Snacks
- Shawarma
- Turkey Pie
- Meat Pie
- Egg Roll
- Chicken Pie

### Drinks
- Zobo
- Soya Milk

**Extensibility:** the data model (`src/types`, `src/data`) is built to accept
new categories, products, sizes and customisation options later. Adding a
category requires a `CategorySlug` entry and data only — no redesign.

## 4. Business model — online only

- No physical storefront exists or should be advertised.
- All ordering happens through the website.
- Fulfilment = **home delivery** and **prearranged pickup**.
- Payment options = **secure online payment** and **cash on arrival**.
- Delivery regions, fees, taxes, hours and contact details are **not yet known**
  and must remain configurable/pending — never invented.
- A private admin dashboard manages products and categories today (Phase 3);
  orders and fulfilment join it in a later phase.

## 5. Planned ordering journey

1. Explore the menu.
2. Choose your favourites.
3. Select delivery or arranged pickup.
4. Complete the order — paying online or with cash on arrival.

The current implementation supports browsing, guest-cart editing and a
checkout review of locally entered details with server-verified item prices.
It does **not** submit an order, take payment, reserve inventory or send/store
the customer's details. Fulfilment coverage, costs and pickup arrangements
remain unconfirmed and are shown as such.

## 6. Technology decisions

### Locked stack (Phase 1)
- Next.js (App Router, Cache Components + Partial Prefetching)
- TypeScript with strict type checking
- React
- Tailwind CSS v4
- Motion for React (`motion`)
- Lucide React icons
- `next/font` (Fraunces + Manrope)
- npm

### Added in Phase 2 (implemented, free tiers only)
| Technology | Status & purpose |
| --- | --- |
| MongoDB Atlas M0 | **Target database (free tier).** Code + docs ready; cluster/credentials pending the owner (see `docs/MONGODB_SETUP.md`) |
| Mongoose 9 | ODM — `categories` + `products` schemas, `autoIndex: false`, server-only |
| Zod 4 | Boundary validation — DTOs, URL input bounds, slug rules |
| Cloudinary | **Display path implemented** (`FoodMedia` → `next/image`, allowlisted host, placeholder fallback). Upload/delete and account provisioning remain later (see `docs/CLOUDINARY_SETUP.md`) |
| Next 16 Proxy (`proxy.ts`) | Pre-render slug check so unknown/draft product URLs return genuine 404 status codes |

### Added in Phase 3 (implemented, free tiers only)
| Technology | Status & purpose |
| --- | --- |
| Argon2id (`@node-rs/argon2`) | Owner password hashing (OWASP parameters, native Rust binding) |
| DB-backed sessions | Opaque 256-bit token, SHA-256 at rest, HttpOnly/Secure/SameSite cookie, 7-day TTL |
| MongoDB rate limiting | Login attempt buckets with TTL indexes (no Redis, no paid service) |
| Cloudinary signed uploads | Server-signed direct browser uploads + server-side Admin API verification (account/credentials pending the owner, see `docs/CLOUDINARY_SETUP.md`) |

### Added in Phase 4 (implemented, no new paid services)
| Technology | Status & purpose |
| --- | --- |
| Browser `localStorage` | Versioned guest-cart persistence; customer-controlled prices are hints only |
| Next.js Server Action | Read-only cart quote against the public catalogue; returns current eligible names/prices and line issues |
| Zod 4 | Strict cart-quote and local checkout-form boundaries with explicit quantity and text limits |

### Added in Phase 5 (implemented, no new paid services)
| Technology | Status & purpose |
| --- | --- |
| MongoDB `orders` collection | Snapshot order records with unique public reference, idempotency key and optimistic-concurrency `version` |
| MongoDB rate limiting (second bucket) | Public order-submission and confirmation-read attempt budgets in `order_attempts`, separate from login budgets |
| Notification outbox | `notification_outbox` queue with idempotent keys, bounded retries and a provider-registry seam; no provider is wired yet |
| Owner-managed `store_configs` singleton | Delivery areas and fees, pickup instructions, tax treatment and order intake: no fee, rate or address is hardcoded |

### Added in Phase 6 (implemented, test mode only)
| Technology | Status & purpose |
| --- | --- |
| Stripe Node SDK (`stripe`) | Hosted Checkout Session creation, signature verification and server-side provider reads; test mode only, live keys rejected |
| MongoDB `payment_attempts` collection | One durable row per provider attempt: sequence, amount, idempotency key, session/intent ids, reconciliation state |
| MongoDB `stripe_events` collection | Durable webhook ledger keyed by Stripe event id; `received`, `processed`, `retry`, `quarantined` |
| MongoDB `payment_refunds` collection | Verified provider refund records keyed by `stripeRefundId`; foundation for refund reporting, no refunds are initiated |
| Owner-managed `payments.onlineEnabled` switch | Default-off business switch, independent of order intake and of environment variables |

### Reserved for later phases (NOT implemented yet)
| Technology | Purpose |
| --- | --- |
| Notification provider | A real email/SMS transport registered in `src/lib/notifications/provider.ts` |
| Live Stripe mode | Live keys, live webhooks and real customer charges are explicitly out of scope |

**Rejected dependencies:** Supabase, Firebase, PostgreSQL — must not be added.
No paid services, subscriptions or premium dependencies. No secrets in source.

## 7. Visual identity summary

Creative concept: **THE SIGNATURE TABLE** — Warm Premium Nigerian Food
Commerce × Modern Editorial Design. Full detail lives in `docs/DESIGN_SYSTEM.md`.

- Background: Soft Cream `#FDFBF7`
- Structure/text/primary buttons: Deep Charcoal Navy `#1A2530`
- Accent (restrained): Champagne Gold `#D4AF37`
- Support: Leaf Green `#5C7A58`, Warm Terracotta `#B86A4F`, Earthy Brown `#8A6A52`
- Headlines: Fraunces (serif). UI/body: Manrope (sans).
- Wordmark: temporary typographic “PEARL ● Signature” mark — the final P+S
  monogram with a pearl detail will replace it when the business supplies it.

## 8. Major product features

### Phase 1 (implemented)
- Public website shell: sticky header, mobile navigation, footer.
- Homepage: hero, categories, signature favourites, brand story, ordering
  journey, closing CTA, accessible FAQ.
- `/menu`: category filtering over typed local preview data, product cards,
  empty states, streaming skeleton.
- `/about`, `/contact` informational pages.
- Animation & microinteraction system with reduced-motion support.
- Testing foundation (Vitest unit tests + Playwright smoke tests).

### Phase 2 (implemented)
- Catalogue read layer: MongoDB/Mongoose schemas (`categories`, `products`),
  Zod validation, repository with paginated/filtered/search reads, draft
  protection, integer-CAD-cent pricing.
- `/menu` driven by the catalogue with shareable URL filter/search/pagination
  state; honest empty, past-end and unavailable states.
- `/menu/[slug]` product detail pages: breadcrumb, gallery with accessible
  thumbnails, related products, genuine 404 status for unknown/draft slugs.
- Cloudinary display path in `FoodMedia` (guarded `next/image`, placeholder
  fallback); preview media slots on the demo product.
- Honest metadata/JSON-LD (no fabricated offers, ratings or reviews);
  preview content noindexed.
- Explicit idempotent seeding tool; 133 unit + 32 e2e tests.

### Phase 3 (implemented)
- Owner authentication: Argon2id hashing, database-backed sessions with
  hashed opaque tokens, rate limiting without Redis, audit logging,
  guarded bootstrap and password-reset CLIs.
- `/admin` dashboard with real data; `/admin/products` (search, filters,
  pagination); product create/edit with integer-cent pricing, optional
  variants, draft/published visibility, archive/restore (never delete);
  editable slugs with automatic redirects from previous addresses.
- `/admin/categories`: create/rename with fixed slugs, disable (never
  delete) with confirmation when products reference the category.
- Cloudinary signed uploads: server-fixed parameters, direct browser
  upload, server-side asset verification before attach, orphan cleanup,
  honest "not configured" state without credentials.
- Storefront reflects every mutation immediately; Phase 2B search
  behaviour regression-protected; 328 unit + 50 e2e tests.

### Phase 4 (implemented, review only)
- Guest cart at the header drawer and `/cart`; cart lines are identified by
  product slug plus option, persisted locally, and reconciled against current
  catalogue data before any price is shown as verified.
- `/checkout` is a review foundation with local-only field validation. Delivery
  and pickup choices are explicitly unconfirmed; delivery fees and taxes say
  “To be confirmed”. There is no Place Order control or submission endpoint
  (Phase 4 boundary; Phase 5 adds both).
- Cart and checkout create no database records and do not reserve inventory.
  Customer details remain in component state in the current tab and are not
  transmitted.

### Phase 5 (implemented)
- Real order creation: the server re-reads configuration, re-quotes the cart,
  recomputes totals and stores a frozen snapshot. Nothing the browser sends
  about price or payment status is trusted.
- Cash on Arrival only: the customer pays at handover, and the owner records
  the receipt on the order. No card data, no online charge, no refund path.
- Order lifecycle (`placed` through `completed` or `cancelled`) with
  method-aware rules, required cancellation reasons and optimistic
  concurrency for admin updates.
- `/admin/orders` and `/admin/orders/[id]` with filters, pagination, staged
  confirmation controls, operational notes and status history.
- Guest confirmation page opened only with an opaque capability held by the
  placing browser; references cannot be enumerated.
- Public rate limits on order submission and confirmation reads, plus an
  idempotency key so a double submission creates exactly one order.
- Notification outbox for order events, honest while unconfigured: entries
  stay pending with a stated reason and never fail the underlying action.
- Dashboard money metrics computed from real records: unpaid Cash on Arrival
  counts as outstanding, never as collected.

### Phase 6 (implemented, test mode only)
- Online payment through Stripe's hosted Checkout page for an existing order.
  The customer never enters card details on this site and no card data is
  stored or transmitted by this application.
- Server-authoritative amounts: the Checkout amount is the immutable Phase 5
  order snapshot in integer CAD cents. No browser value, price, fee, tax,
  currency or status is accepted.
- A durable provider attempt before every Stripe call, with a stable
  idempotency key so an ambiguous timeout cannot create a second chargeable
  session; retries reuse a valid open session and replace only a
  provider-confirmed expired or failed one.
- A signature-verified webhook endpoint with a durable event ledger. Redirects
  are never treated as proof of payment, duplicate and out-of-order events
  cannot corrupt a paid order, and paid is monotonic.
- Payment states beyond `unpaid|paid`: awaiting, processing, failed, expired,
  partially refunded, refunded and review required. Fulfilment stays
  independent of payment.
- A cancelled order that receives a late verified payment keeps the payment,
  stays cancelled and is flagged for review. Cancelling is not a refund.
- Verified refund records and partial/full refund totals derived only from
  trusted provider events. No refund is initiated, offered or automated.
- Owner-visible online payment switch, Stripe readiness panel, per-order
  attempts and refunds, a dry-run-first audited reconciliation control, and a
  dashboard that separates online settlement, cash collection, outstanding,
  pending, failed, refunds, gross and net.
- Payment notifications reuse the Phase 5 outbox with idempotent keys; no
  provider is configured, so nothing claims delivery.

### Upcoming (documented, not implemented)
- Live Stripe activation (real keys, real charges) and any customer-initiated
  refund or dispute flow.
- A registered notification provider (email/SMS transport).
- Pickup and delivery time slots or scheduling (none offered; any future
  promise must be supplied by the business).
- Customer account/order history.
- Verified contact channels, social profiles, operating hours.

## 9. Security & accessibility priorities

- No secrets in source; env-var configuration for future integrations.
- Admin authentication required before any dashboard work ships.
- Zod validation for all future API input.
- Semantic HTML, correct heading hierarchy, landmark roles.
- Visible keyboard focus everywhere (`focus-gold`).
- WCAG AA text contrast; gold never as small text on cream.
- Alt text for meaningful imagery (decorative media marked `aria-hidden`).
- `prefers-reduced-motion` honoured globally (Motion `reducedMotion="user"`).
- Mobile-first, touch-friendly targets (≥44px controls in primary nav/CTA).

## 10. Unresolved business details (must be configured or marked pending)

These are **known unknowns**. The product must not invent them. The
configuration checklist in `docs/BUSINESS_CONFIGURATION.md` walks through
each one before the first real order:

- Prices (CAD), portions/sizes, pricing strategy
- Delivery regions, zones, fees and schedules
- Pickup locations, times and windows
- Operating hours / kitchen hours
- Business email, phone number, social accounts
- Official logo (P+S monogram with pearl detail)
- Real product photography (current imagery is clearly temporary illustration)
- Stripe merchant account / currency & tax rules
- Pickup vs delivery availability per location
- Tax treatment (zero-rated or an exact rate, and what it applies to)
- Whether order intake is switched on (implemented; the owner's switch)
- Whether preorders, catering or subscriptions are ever offered
