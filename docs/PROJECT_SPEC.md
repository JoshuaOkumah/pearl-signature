# PEARL Signature — Product Specification

> Status: **Phase 1 complete** (foundation, design system, interactive
> storefront); **Phase 2/2B complete** (catalogue data, search relevance);
> **Phase 3 complete** (admin authentication, catalogue management, signed
> uploads). This document records the agreed requirements. It describes
> planned features without implementing them — see `docs/PHASE_PROGRESS.md`
> for what exists today.

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

Phase 1 only presents this journey; no transactional behaviour is implemented.

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

### Reserved for later phases (NOT implemented yet)
| Technology | Purpose |
| --- | --- |
| Stripe | Online payments |

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

### Upcoming (documented, not implemented)
- Shopping cart, checkout, Stripe online payments + cash-on-arrival option.
- Delivery zones, fees, pickup scheduling (all values supplied by business).
- Order lifecycle & fulfilment views in the admin dashboard.
- Customer account/order history, notifications (channels TBD).
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

These are **known unknowns**. The product must not invent them:

- Prices (CAD), portions/sizes, pricing strategy
- Delivery regions, zones, fees and schedules
- Pickup locations, times and windows
- Operating hours / kitchen hours
- Business email, phone number, social accounts
- Official logo (P+S monogram with pearl detail)
- Real product photography (current imagery is clearly temporary illustration)
- Stripe merchant account / currency & tax rules
- Pickup vs delivery availability per location
- Whether preorders, catering or subscriptions are ever offered
