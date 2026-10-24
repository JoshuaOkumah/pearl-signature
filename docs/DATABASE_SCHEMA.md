# PEARL Signature — Database Schema (Phase 2, 3 & 4)

Database: **MongoDB** (target: MongoDB Atlas M0 free tier).
ODM: **Mongoose 9**. Boundary validation: **Zod 4**.
Six collections: `categories` and `products` (catalogue, Phase 2) plus
`admins`, `admin_sessions`, `admin_login_attempts` and
`admin_audit_logs` (administration, Phase 3). Phase 4 adds no collections or
indexes: the guest cart is browser-local, quote requests are read-only, and
checkout details are not transmitted or persisted. There are no customer,
order, payment or inventory-reservation records.

All indexes below are created by the seed script or an operator command
(`autoIndex` is **off** on the application connection, so the app never
mutates index state at runtime or build time). The Phase 3 bootstrap and
password-reset scripts also call `createIndexes()` for the admin
collections while they are connected.

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
| `previousSlugs` | string[] | default `[]`, ≤ 5 entries, slug pattern | **Phase 3:** former slugs kept when the owner edits the address, so old links keep working via 308 redirect (`src/proxy.ts`) |
| `shortDescription` | string \| null | default `null`, ≤ 180 | Card/search text |
| `description` | string | required, ≤ 4 000 | Detail body |
| `categoryId` | ObjectId | required, ref `Category` | Reference (not an embedded copy) so later admin renames never orphan products |
| `images` | ProductImage[] | ≤ 10, embedded subdocuments, `_id: false` | **Cloudinary references only** — binaries never live in MongoDB |
| `currency` | `"CAD"` | enum, default `"CAD"` | |
| `priceCents` | number \| null | default `null`; if set: **integer, ≥ 1** | Integer CAD cents. **No floats, no `$0` placeholder** — unconfigured means `null` and renders as "Price to be confirmed" |
| `variants` | ProductVariant[] | ≤ 20, `_id: false` | Optional sizes/portions (scaffolding; Phase 2 fixtures use none) |
| `status` | `"draft" \| "published" \| "archived"` | default `"draft"` | Drafts are never publicly readable. **Phase 3:** `archived` retires a product from sale without deleting it (reversible); public reads filter `status: "published"` exclusively |
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

## Administration collections (Phase 3)

Security model: `docs/ADMIN_AUTH.md`. Writes happen only through the
guarded Server Actions and the two operator CLIs.

### `admins`

| Field | Type | Rules | Notes |
| --- | --- | --- | --- |
| `email` | string | required, **unique**, lowercase, ≤ 160, simple format check | Format is additionally validated by Zod at every boundary |
| `passwordHash` | string | required, ≤ 512 | **Encoded Argon2id hash** (never plaintext); server-only |
| `role` | `"owner" \| "staff"` | default `"owner"` | Only `owner` is authorized today; `staff` reserves the enum for later |
| `status` | `"active" \| "disabled"` | default `"active"` | Disabling revokes every live session immediately |
| `lastLoginAt` | date \| null | default `null` | |
| `createdAt` / `updatedAt` | date | timestamps | |

### `admin_sessions`

| Field | Type | Rules | Notes |
| --- | --- | --- | --- |
| `tokenHash` | string | required, **unique**, ≤ 128 | **SHA-256 of the cookie token** — the raw token is never stored |
| `adminId` | ObjectId | ref `Admin`, required | |
| `ipHash` | string \| null | default `null`, ≤ 128 | One-way hash of the client address for audit context only |
| `expiresAt` | date | required | **TTL index** (`expireAfterSeconds: 0`); application checks are authoritative even before the ~60 s sweep |

Indexes: `tokenHash` (unique, from the schema); `{ adminId: 1, createdAt: -1 }`.
Revocation deletes rows (logout: one row; password reset or disabled
account: every row for that admin).

### `admin_login_attempts`

| Field | Type | Rules | Notes |
| --- | --- | --- | --- |
| `key` | string | required, **unique**, ≤ 200 | `sha256(address \| email \| 15-min bucket)` — raw values never stored |
| `count` | number | required, ≥ 0 | Moved with an atomic upsert `$inc` (concurrency-safe) |
| `expiresAt` | date | required | **TTL index**; one document per key per window |

Limits: 5 failures per address and per email per 15-minute window; a
successful sign-in clears the bucket; **fail-closed** when the database
is unreachable. This is the no-Redis rate limiter (`docs/ADMIN_AUTH.md` §4).

### `admin_audit_logs`

| Field | Type | Rules | Notes |
| --- | --- | --- | --- |
| `event` | enum | closed list (`AUDIT_EVENTS`) | Login success/failed/rate-limited, logout, password reset, product/category mutations, image attach/update/remove |
| `outcome` | enum | `"success" \| "failure"` | |
| `adminId` / `email` | string \| null | bounded | Acting admin when known |
| `ipHash` | string \| null | one-way hash | Never a raw address |
| `target` | `{ type, id, label }` | `_id: false`, bounded | Product/category/admin reference, string ids only |
| `detail` | string | short, operator-authored | Never passwords, tokens or secrets |
| `createdAt` | date | **TTL index** | Retention: **180 days** (`AUDIT_RETENTION_DAYS`) |

---

## Phase 4 commerce foundation (no database writes)

The guest cart is stored in browser `localStorage` under `pearl-cart-v1`,
version 1. A line contains `{ slug, variantName, quantity,
unitPriceCents }`; the last field is a non-authoritative “price last seen”
hint. Quote requests deliberately omit it and contain only the product slug,
option name and quantity. The request is Zod-validated and bounded to 30 lines,
25 units per line and 99 units total before the read-only quote action looks up
currently published products and active categories.

The quote derives display name, current availability, option eligibility and
integer-cent price from the catalogue. Draft, archived, disabled-category and
unknown slugs share the same `not_found` result. The action makes no writes;
there is no cart collection, order collection, customer record, stock
reservation, payment intent or audit event for browsing/quoting.

Checkout form values remain in component state for the current tab. Local
validation does not submit or save the values. Delivery/tax amounts and
fulfilment details stay unconfirmed until the business supplies them and a
future approved phase adds order submission.

---

## Validation layers (three, complementary)

1. **Mongoose schema** — write-time safety for anything that reaches the
   database (seed, future admin): types, required fields, enums, limits,
   integer-cents price validators, slug setters.
2. **Zod (`src/lib/validations/catalogue.ts`, `src/lib/validations/admin.ts`)**
   — read-time safety at the server boundary: every database record is
   parsed before it becomes a DTO; an invalid record is dropped and logged,
   never rendered and never allowed to crash a page. Also validates URL
   pagination/search input with hard bounds (page ≥ 1, 1–48 per page,
   search ≤ 100 chars, escaped regex). The admin schemas parse raw form
   data with **unknown keys stripped** (no mass assignment) and encode the
   business rules (integer-cent prices, slug edits, category references,
   optimistic-concurrency timestamps).
3. **Result types (`ReadResult<T>`)** — no repository ever throws past its
   caller; failures surface as `{ ok: false }` for a friendly retry state.

## Visibility rules (enforced in the repository, unit-tested)

- Public reads filter `status: "published"` **and** an active category.
- Drafts and **archived** products never appear in listings, search
  results, counts, related products, homepage showcase, metadata or
  JSON-LD. Archiving is reversible and never deletes the record.
- A published product with `priceCents: null` is still browsable; the UI
  shows "Price to be confirmed" and never an invented amount.
- Slug lookups go through `getPublishedProductBySlug`, which the page layer
  **and** `src/proxy.ts` (real 404 status codes) share, so there is exactly
  one implementation of every rule.

## ID serialisation

DTOs expose `_id` as a string (`string`) only. `ObjectId` instances and raw
Mongo documents never cross the repository boundary.
