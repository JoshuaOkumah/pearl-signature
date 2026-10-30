# PEARL Signature — Database Schema (Phase 2, 3, 4, 5, 6 & 7)

Database: **MongoDB** (target: MongoDB Atlas M0 free tier).
ODM: **Mongoose 9**. Boundary validation: **Zod 4**.
Six catalogue and administration collections: `categories` and `products`
(Phase 2) plus `admins`, `admin_sessions`, `admin_login_attempts` and
`admin_audit_logs` (Phase 3). Phase 4 adds no collections: the guest cart is
browser-local and quote requests are read-only. Phase 5 adds `orders`,
`store_configs`, `order_attempts` and `notification_outbox`. Phase 6 adds
`payment_attempts`, `stripe_events` and `payment_refunds` and extends the
`orders.payment` subdocument; it introduces no customer, card or
payment-method records. Phase 7 extends `notification_outbox` and adds
`tracking_challenges` and `order_access_grants`; neither stores a plaintext code
or token, and neither stores an email address.

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

## Phase 5 order collections

Four new collections. Full field-level prose lives in
`src/models/order.ts`; the behavioural documents are
`docs/ORDER_ARCHITECTURE.md`, `docs/ORDER_LIFECYCLE.md`,
`docs/CASH_ON_ARRIVAL.md`, `docs/ORDER_NOTIFICATIONS.md` and
`docs/BUSINESS_CONFIGURATION.md`.

### `orders`

| Field | Type | Rules | Notes |
| --- | --- | --- | --- |
| `reference` | string | required, **unique**, uppercase, `^PS-[0-9A-F]{10}$` | Public, unpredictable, URL-safe |
| `idempotencyKey` | string | required, **unique**, `^[0-9a-f]{32,64}$` | Client checkout-attempt id: a retry can never insert twice |
| `idempotencyHash` | string | required, ≤ 64 | sha256 of the order intent (excludes the expected total) |
| `confirmationKeyHash` | string | required, ≤ 64 | sha256 of the guest capability; the raw key is never stored |
| `customer` | `{ fullName, email, phone }` | embedded, required | Exactly three fields; no other PII is collected |
| `fulfillment` | `{ method, address, instructions, notes, serviceAreaLabel, pickupInstructions }` | embedded | `address` is null for pickup; area label and pickup instructions are snapshots |
| `items` | OrderItem[] | 1–30, `_id: false` | name, variant, quantity (1–99), `unitPriceCents`, `lineTotalCents`, image reference: **all frozen at purchase** |
| `money` | `{ currency, subtotalCents, deliveryFeeCents, taxCents, totalCents, taxLabel, taxRateBps }` | embedded, integer cents | Schema validator enforces `subtotal + fee + tax === total` |
| `payment` | `{ method, status, provider, paidAt, paidByAdminId, paidByLabel, amountReceivedCents, refundedAmountCents, stripeSessionId, paymentIntentId, requiresReview, reconciliationStatus, lastReconciledAt }` | embedded | See the payment subdocument table below |
| `status` | enum | default `placed` | The seven lifecycle states |
| `statusHistory` | StatusEvent[] | ≤ 40 | `{ from, to, at, adminId, note }`; placement row has `from: null` |
| `cancellationReason` | string \| null | ≤ 300 | Required by the action, not the schema |
| `notes` | OrderNote[] | ≤ 20, each ≤ 500 | Operator-only; does not bump `version` |
| `version` | number | default 1, ≥ 1 | Optimistic-concurrency token for admin updates |
| `createdAt` / `updatedAt` | date | timestamps | |

Indexes: unique `reference`, unique `idempotencyKey`, `createdAt` desc,
`{ status, createdAt }`, `{ payment.status, createdAt }`. Created
deliberately by `scripts/seed.ts` and the test harness (`autoIndex` is off).

#### `orders.payment` (Phase 6)

| Field | Type | Default | Notes |
| --- | --- | --- | --- |
| `method` | enum | `cash_on_arrival` | `cash_on_arrival` \| `stripe` |
| `status` | enum | `unpaid` | `unpaid`, `awaiting_payment`, `processing`, `paid`, `failed`, `expired`, `partially_refunded`, `refunded`, `review_required` |
| `provider` | enum | `none` | `none` \| `stripe` |
| `amountReceivedCents` | integer | `0` | Written once from the verified attempt amount; 0 means nothing verified |
| `refundedAmountCents` | integer | `0` | Sum of `succeeded` refund rows; never exceeds the received amount |
| `stripeSessionId` | string \| null | `null` | Checkout Session for the current attempt |
| `paymentIntentId` | string \| null | `null` | PaymentIntent recorded from the session or event |
| `requiresReview` | boolean | `false` | Set by a mismatch, a duplicate settlement or a late payment after cancellation |
| `reconciliationStatus` | enum | `not_checked` | `not_checked` \| `matched` \| `mismatch` \| `error` |
| `lastReconciledAt` | date \| null | `null` | |
| `paidAt`, `paidByAdminId`, `paidByLabel` | mixed | `null` | `paidBy*` remain Cash on Arrival attribution only |

Documents created before Phase 6 lack the newer keys and read back with these
defaults; no migration is required, and an old `paid` cash order still reports
its full total as collected.

### `store_configs`

Single singleton document, `_id: "checkout"`.

| Field | Type | Notes |
| --- | --- | --- |
| `orderIntakeEnabled` | boolean | Master switch; false blocks submission |
| `delivery` | `{ enabled, serviceAreas[] }` | Each area: label, 1–13 province codes, FSA prefixes, `feeCents` (integer, 0–999 999) |
| `pickup` | `{ enabled, instructions }` | Enabling pickup requires instructions |
| `tax` | `{ mode, rateBps, base, label }` | `unconfigured` \| `zero` \| `rate`; a rate without rate and base reads back as `unconfigured` |
| `payments` | `{ onlineEnabled }` | Default **false**; the owner switch for Stripe online payment. Independent of order intake and never inferred from environment variables |
| `createdAt` / `updatedAt` | date | timestamps |

A malformed service area or tax block is dropped or downgraded on read,
never rendered with a wrong value.

### `order_attempts`

| Field | Type | Notes |
| --- | --- | --- |
| `key` | string, unique | `sha256(scope, address, window)` — raw addresses never stored |
| `count` | number | Atomic upsert `$inc`; counted per attempt, not per success |
| `expiresAt` | date | **TTL index**; 15-minute windows (`ORDER_RATE_WINDOW_MS`) |

Limits: 10 attempts per window for `order.create`, 30 for `order.lookup`, and
10 for `payment.create` (Checkout initialization). Separate from
`admin_login_attempts` so neither budget can consume the other. Fail-closed
when unreadable. Verified webhooks are never rate limited.

### `notification_outbox`

Extended in Phase 7.

| Field | Type | Notes |
| --- | --- | --- |
| `key` | string, unique | `${event}:${reference}:${recipientRole}` |
| `event` | enum | `order.placed`, `order.status_changed`, `order.confirmed`, `order.preparing`, `order.ready_for_pickup`, `order.out_for_delivery`, `order.completed`, `order.cancelled`, `payment.confirmed`, `payment.collected`, `payment.failed`, `payment.requires_attention`, `payment.refund_review` |
| `reference` | string | Order reference only |
| `transition` | order status \| null | Target status for status events |
| `recipientRole` | enum | `customer`, `admin` |
| `status` | enum | `pending`, `processing`, `sent`, `failed`, `uncertain` |
| `attempts` | number | Counts failures only; cap 5 |
| `ambiguousAttempts` | number | Timeout/5xx outcomes; cap 2, then `uncertain` |
| `lastReason` | string ≤ 300 \| null | Sanitised; no address, no token |
| `nextAttemptAt` | date | Backoff schedule, scanned with `{ status, nextAttemptAt }` |
| `lastAttemptAt` | date \| null | Set when an entry is claimed |
| `sentAt` | date \| null | **TTL index**: accepted entries expire 30 days after acceptance |
| `leaseToken` | string ≤ 64 \| null | Random token held by one processor |
| `leaseExpiresAt` | date \| null | 2 minutes; expired leases are recovered |
| `providerId` | string \| null | Provider message id |
| `providerStatus` | enum \| null | `accepted`, `delivered`, `bounced`, `complained`, `failed`, `unknown` |
| `providerStatusAt` | date \| null | |
| `createdAt` | date | Audit only; the legacy `createdAt_1` TTL index is dropped by the seed script |

`sent` means the provider **accepted** the message. Only a verified provider
callback may move `providerStatus` to `delivered`, `bounced` or `complained`.
Unresolved failures never expire, so a problem cannot silently disappear.

No email, name, address or message body is ever stored: recipients resolve
at dispatch time.

---

## Phase 7 tracking collections

Two collections, written only by the tracking Server Actions. Prose:
`docs/ORDER_TRACKING.md`. Both store hashes only.

### `tracking_challenges`

| Field | Type | Notes |
| --- | --- | --- |
| `reference` | string | Public order reference |
| `codeHash` | string, 64 hex | sha256 of the six-digit code; the code itself is never stored |
| `attempts` | number | Wrong-code count; cap 5 |
| `consumedAt` | date \| null | Set atomically on successful verification (single use) |
| `expiresAt` | date | **TTL index**; 10 minutes |
| `createdAt` | date | Used to select the newest challenge |

### `order_access_grants`

| Field | Type | Notes |
| --- | --- | --- |
| `reference` | string | The one order this grant opens |
| `orderId` | string | Order id at issue time |
| `tokenHash` | string, 64 hex, **unique** | sha256 of the 43-character base64url token |
| `expiresAt` | date | **TTL index**; 24 hours |
| `revokedAt` | date \| null | Reserved for explicit revocation |
| `createdAt` | date | |

The browser keeps the plaintext capability in `sessionStorage`
(`pearl-confirmations-v1`) and the plaintext grant in
`pearl-tracking-grants-v1`. Neither is ever placed in a URL.

---

## Phase 6 payment collections

Three collections, all written only by server-side payment code. Prose:
`docs/PAYMENT_LIFECYCLE.md`, `docs/STRIPE_INTEGRATION.md`,
`docs/PAYMENT_RECONCILIATION.md`. No card data, payment-method token or full
provider payload is stored anywhere.

### `payment_attempts`

One row per provider attempt. Created **before** the Stripe call, so an
ambiguous timeout is always recoverable.

| Field | Type | Rules | Notes |
| --- | --- | --- | --- |
| `orderId` | string | required, ≤ 64 | Order `_id` as a string |
| `orderReference` | string | required, ≤ 20 | Denormalized for lookups |
| `sequence` | integer | required, ≥ 1 | Unique per order |
| `amountCents` | integer | required, 1–99 999 999 | Must equal the order snapshot total |
| `currency` | enum | `CAD` | Only Canadian dollars |
| `provider` | enum | `stripe` | |
| `status` | enum | `creating`, `open`, `processing`, `succeeded`, `failed`, `expired`, `uncertain` | |
| `active` | boolean | required | At most one active row per order |
| `providerIdempotencyKey` | string | required, **unique**, ≤ 255 | `pearl_<48 hex>`; persisted before the provider call |
| `checkoutSessionId` | string \| null | ≤ 255 | Unique when present |
| `paymentIntentId` | string \| null | ≤ 255 | Unique when present |
| `expiresAt`, `providerCreatedAt`, `succeededAt`, `lastReconciledAt` | date \| null | | |
| `failureCode` | string \| null | ≤ 80 | Normalized code, never provider text |
| `reconciliationStatus` | enum | `not_checked`, `matched`, `mismatch`, `error` | |
| `createdAt` / `updatedAt` | date | timestamps | |

Indexes: unique `providerIdempotencyKey`; unique `{ orderId, sequence }`;
**partial unique** `{ orderId }` where `active: true`; **partial unique**
`checkoutSessionId` and `paymentIntentId` where the field is a string;
`{ orderReference, createdAt desc }`.

### `stripe_events`

Durable webhook ledger. The row is written before any financial state change,
and the unique event id is what makes replay safe. There is deliberately no TTL:
financial event ids are reconciliation evidence.

| Field | Type | Rules | Notes |
| --- | --- | --- | --- |
| `eventId` | string | required, **unique**, ≤ 255 | Stripe event id |
| `type` | string | required, ≤ 100 | Event type |
| `objectId` | string | required, ≤ 255 | Provider object id, or `unsupported` |
| `livemode` | boolean | required, default false | Live events are quarantined |
| `eventCreatedAt` | date | required | Provider timestamp |
| `status` | enum | `received`, `processed`, `retry`, `quarantined` | |
| `orderReference` | string \| null | ≤ 20 | Set once associated |
| `attempts` | integer | ≥ 0 | Delivery/processing attempts |
| `processedAt` | date \| null | | |
| `lastErrorCode` | string \| null | ≤ 80 | Normalized, PII-free |

Indexes: unique `eventId`; `{ status, createdAt }`;
`{ orderReference, eventCreatedAt desc }`.

### `payment_refunds`

Verified provider refund records. Written from trusted events or audited
reconciliation only; this application never creates a refund.

| Field | Type | Rules | Notes |
| --- | --- | --- | --- |
| `orderId`, `orderReference`, `attemptId` | string | required | Which order and attempt |
| `stripeRefundId` | string | required, **unique**, ≤ 255 | Provider refund id |
| `stripePaymentIntentId` | string | required, ≤ 255 | |
| `amountCents` | integer | required, 1–99 999 999 | Whole cents |
| `currency` | enum | `CAD` | |
| `status` | enum | `pending`, `succeeded`, `failed`, `canceled` | Only `succeeded` rows count toward totals |
| `providerCreatedAt` | date | required | |
| `reconciledAt` | date \| null | | |
| `createdAt` / `updatedAt` | date | timestamps | |

Indexes: unique `stripeRefundId`; `{ orderId, createdAt desc }`;
`{ attemptId, createdAt desc }`.

---

## Phase 4 commerce foundation (browser storage only)

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
there is no cart collection, customer record, stock reservation, payment
intent or audit event for browsing/quoting. Order storage itself lives in the
Phase 5 `orders` collection above.

Checkout form values remain in component state for the current tab. Local
validation does not submit or save the values. Delivery, tax and fulfilment
amounts are read from the owner's `store_configs` singleton; when that
configuration is absent or incomplete the checkout reports the specific
blocker and refuses submission rather than assuming a fee or a tax rate.

---

## Validation layers (three, complementary)

1. **Mongoose schema** — write-time safety for anything that reaches the
   database (seed, future admin): types, required fields, enums, limits,
   integer-cents price validators, slug setters.
2. **Zod (`src/lib/validations/catalogue.ts`, `src/lib/validations/admin.ts`,
   `src/lib/validations/order.ts`, `src/lib/validations/checkout.ts`,
   `src/lib/validations/store-config.ts`)**
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
- Payment collections are never read by a public page. They are reachable only
  from the webhook handler, the authorized admin order detail and the audited
  reconciliation action.

## ID serialisation

DTOs expose `_id` as a string (`string`) only. `ObjectId` instances and raw
Mongo documents never cross the repository boundary.
