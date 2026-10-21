# PEARL Signature — Database Schema (Phase 2)

Database: **MongoDB** (target: MongoDB Atlas M0 free tier).
ODM: **Mongoose 9**. Boundary validation: **Zod 4**.
Two collections only: `categories` and `products`. No customers, orders,
carts or sessions exist yet — those belong to later phases.

All indexes below are created by the seed script or an operator command
(`autoIndex` is **off** on the application connection, so the app never
mutates index state at runtime or build time).

---

## `categories`

| Field | Type | Rules | Notes |
| --- | --- | --- | --- |
| `_id` | ObjectId | — | Never exposed raw; DTOs serialise to string |
| `name` | string | required, ≤ 80, trimmed | Display name |
| `slug` | string | required, **unique**, lowercase, matches `^[a-z0-9]+(?:-[a-z0-9]+)*$` | Normalised at write time through a `slugify` setter (e.g. `"Traditional Foods"` → `traditional-foods`) |
| `description` | string | default `""`, ≤ 400 | Optional blurb |
| `sortOrder` | number | default `0` | Listing order |
| `isActive` | boolean | default `true` | Hides a category publicly without deleting it |
| `createdAt` / `updatedAt` | date | timestamps | |

**Indexes**

- `slug` (unique, from the schema)
- `{ isActive: 1, sortOrder: 1 }` — public listing

## `products`

| Field | Type | Rules | Notes |
| --- | --- | --- | --- |
| `_id` | ObjectId | — | Never exposed raw |
| `name` | string | required, ≤ 120, trimmed | |
| `slug` | string | required, **unique**, lowercase, slug pattern | Same `slugify` setter as categories |
| `shortDescription` | string \| null | default `null`, ≤ 180 | Card/search text |
| `description` | string | required, ≤ 4 000 | Detail body |
| `categoryId` | ObjectId | required, ref `Category` | Reference (not an embedded copy) so later admin renames never orphan products |
| `images` | ProductImage[] | ≤ 10, embedded subdocuments, `_id: false` | **Cloudinary references only** — binaries never live in MongoDB |
| `currency` | `"CAD"` | enum, default `"CAD"` | |
| `priceCents` | number \| null | default `null`; if set: **integer, ≥ 1** | Integer CAD cents. **No floats, no `$0` placeholder** — unconfigured means `null` and renders as "Price to be confirmed" |
| `variants` | ProductVariant[] | ≤ 20, `_id: false` | Optional sizes/portions (scaffolding; Phase 2 fixtures use none) |
| `status` | `"draft" \| "published"` | default `"draft"` | Drafts are never publicly readable |
| `availability` | `"available" \| "unavailable"` | default `"available"` | Surfaced as an "Unavailable" badge (never hidden — the item stays browsable) |
| `stock` | `{ tracked, quantity }` | default `{ tracked: false, quantity: null }` | **Unused scaffolding for a later phase** |
| `featured` | boolean | default `false` | Homepage Signature Favourites |
| `tags` | string[] | ≤ 10 × ≤ 40 chars | |
| `sortOrder` | number | default `0` | Stable listing order |
| `createdAt` / `updatedAt` | date | timestamps | |

### `ProductImage` (embedded)

| Field | Type | Rules |
| --- | --- | --- |
| `secureUrl` | string | required, must be `https://` |
| `publicId` | string (optional) | Cloudinary public id |
| `alt` | string | **required**, ≤ 300 — accessibility is part of the record |
| `sortOrder` | number | default `0`, ≥ 0 — gallery order |
| `width` / `height` | number (optional) | ≥ 1 — reserved for `next/image` sizing (no CLS) |

### `ProductVariant` (embedded)

| Field | Type | Rules |
| --- | --- | --- |
| `name` | string | required, ≤ 80 |
| `priceCents` | number \| null | default `null`; integer ≥ 1 when set (same money rules) |

**Indexes**

- `slug` (unique, from the schema)
- `{ status: 1, sortOrder: 1 }` — main listing
- `{ status: 1, categoryId: 1, sortOrder: 1 }` — category filter
- `{ status: 1, featured: 1, sortOrder: 1 }` — homepage showcase

Search does **not** use Atlas Search (paid). Since Phase 2B it is
title-first (`src/lib/search.ts`): product **names only**, matched by an
escaped, length-capped, tier-aware regex (`^f` for single characters,
`(?:^|\b)` prefixes for two characters, plain substring for three or more),
then ranked in memory by match tier → `sortOrder` → slug. The existing
indexes serve the candidate fetch and sort; the collection scan is
acceptable on an M0-sized catalogue and is documented in
`docs/MONGODB_SETUP.md`.

---

## Validation layers (three, complementary)

1. **Mongoose schema** — write-time safety for anything that reaches the
   database (seed, future admin): types, required fields, enums, limits,
   integer-cents price validators, slug setters.
2. **Zod (`src/lib/validations/catalogue.ts`)** — read-time safety at the
   server boundary: every database record is parsed before it becomes a DTO;
   an invalid record is dropped and logged, never rendered and never allowed
   to crash a page. Also validates URL pagination/search input with hard
   bounds (page ≥ 1, 1–48 per page, search ≤ 100 chars, escaped regex).
3. **Result types (`ReadResult<T>`)** — no repository ever throws past its
   caller; failures surface as `{ ok: false }` for a friendly retry state.

## Visibility rules (enforced in the repository, unit-tested)

- Public reads filter `status: "published"` **and** an active category.
- Drafts never appear in listings, search results, counts, related products,
  homepage showcase, metadata or JSON-LD.
- A published product with `priceCents: null` is still browsable; the UI
  shows "Price to be confirmed" and never an invented amount.
- Slug lookups go through `getPublishedProductBySlug`, which the page layer
  **and** `src/proxy.ts` (real 404 status codes) share, so there is exactly
  one implementation of every rule.

## ID serialisation

DTOs expose `_id` as a string (`string`) only. `ObjectId` instances and raw
Mongo documents never cross the repository boundary.
