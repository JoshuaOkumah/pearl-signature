# PEARL Signature — Phase 3 Report

**Phase:** 3 — secure admin authentication, product/category management,
Cloudinary signed uploads.
**Date:** 2026-10-22. **Status:** implemented and verified locally;
**awaiting review before Phase 4**.

Companion documents: `docs/ADMIN_AUTH.md` (security model),
`docs/ADMIN_OPERATIONS.md` (owner guide), `docs/CLOUDINARY_UPLOADS.md`
(upload contract), `docs/DATABASE_SCHEMA.md` (schema additions).

---

## A. Summary & scope

Phase 3 added the owner-operated half of the store: a private dashboard
that can create, edit and archive products and categories and attach
photos, while keeping every phase boundary from the brief (no
cart/checkout/Stripe/orders/analytics/deployment, no paid services,
MongoDB Atlas M0 + Cloudinary free tier compatible).

**Shipped:** Argon2id password hashing; database-backed sessions with
hashed opaque tokens; login rate limiting in MongoDB (no Redis); audit
logging; guarded owner bootstrap and password-reset CLIs; per-action
authorization with mass-assignment, concurrency, ObjectId and
open-redirect protections; six admin routes with real-data screens;
integer-cent product pricing with optional variants; archive-not-delete
products and disable-not-delete categories with stable slugs; server-signed
Cloudinary uploads with server-side asset verification and orphan cleanup;
storefront invalidation on every mutation; two-project Playwright suite
against a disposable in-memory stack; 34 admin screenshots; docs.

**Deliberately not touched:** cart, checkout, Stripe, orders, customer
accounts, analytics, deployment. Storefront behaviour (including Phase 2B
search) is regression-tested and unchanged except where admin mutations
now flow through to it.

**Cloud verification: PENDING.** No `MONGODB_URI` and no Cloudinary
credentials were supplied; nothing was created, upgraded or queried on any
cloud by this phase. Every claim below marked *verified* was executed
locally against a disposable in-memory MongoDB with a real seeded
database (see section K).

## B. Authentication

- **Hashing:** Argon2id via `@node-rs/argon2` (Rust native binding, no WASM,
  OWASP-recommended parameters: 19 MiB, 2 iterations, parallelism 1).
  Split into `src/lib/auth/password-core.ts` (pure, unit-tested) and
  `src/lib/auth/password.ts` (server-only re-export, keeps the native
  module out of client bundles). Policy: minimum 10 characters, maximum
  200, no composition rules.
- **Sessions:** 256-bit opaque token (`randomBytes(32)` → base64url) in the
  `pearl_admin_session` cookie; MongoDB stores only its SHA-256 hash, so a
  database dump cannot be replayed. Absolute 7-day TTL (no sliding
  renewal), TTL index, expiry re-checked per request. Cookie flags:
  HttpOnly, Secure in production, SameSite=Lax, `Path=/admin` (never sent
  to storefront routes). Client addresses are stored hashed for audit
  correlation only.
- **Resolution:** `getSessionAdminFromCookies()` is the single path from
  cookie to acting admin; it re-reads account status every request, so a
  disabled account loses access immediately even with a valid cookie.
  Signing out deletes the session row before clearing the cookie.
- **Generic errors:** unknown email, wrong password and disabled account
  return one identical message. Login never reveals account existence.

## C. Rate limiting & audit trail

- **Rate limiting (no Redis):** MongoDB bucket documents keyed by
  `sha256(address | email | 15-minute bucket)`; counts move with an atomic
  `$inc` on upsert (concurrency-safe across instances); unique index;
  TTL expiry. Limits: 5 failures per address and per email per window; a
  successful sign-in clears the bucket. **Fail-closed**: if the database
  is unreachable, sign-in is refused (the credential check would fail
  anyway). Documented limitations: NAT-shared addresses share a bucket;
  TTL sweep lags ~60 s; only hashes are stored.
- **Audit log:** every security and catalogue event is appended
  (`admin.login.success|failure|rate_limited`, `admin.logout`,
  `admin.password_reset`, product/category create/update/archive/restore,
  `image.attached|updated|removed`) with acting admin, hashed client
  address and a short detail string. Password material, tokens and API
  secrets never appear. 180-day TTL index.

## D. Guarded operator tooling

- `npm run admin:bootstrap -- --yes` creates the first owner. It never
  runs on startup, build or through a web request; requires explicit
  `--yes`; prints host and database name (never credentials) before
  connecting; hidden, twice-confirmed password prompt (≥10 chars);
  refuses a second owner; `NODE_ENV=production` additionally requires
  `--force-production`; creates the auth indexes while connected.
  Automation (`--non-interactive`) reads the password from the
  environment, never argv, and is documented as test-environments-only.
- `npm run admin:reset -- --email … --yes` rotates a password and
  **revokes every live session** for that account, so stolen cookies die
  immediately. Same safety rails. Writes an audit entry (event only).
  Public "forgot password" email flows are explicitly a later phase.

## E. Authorization model

Every mutation is a Server Action following one pattern
(`src/lib/actions/*.ts`):

1. `requireActionAdmin()` re-validates the session against MongoDB.
   Page-level guards are navigation UX only and are never trusted.
2. Zod parses raw form data with schemas that **strip unknown keys** —
   client-supplied role, status, id, password-hash or version fields are
   never read (no mass assignment).
3. Server-side invariants: integer-cent prices, slug rules, category
   references, `^[0-9a-f]{24}$` ObjectId checks (malformed ids resolve as
   "not found", never as query errors).
4. **Optimistic concurrency:** product and category updates carry the
   version they were loaded from; a stale save is rejected with a clear
   "changed elsewhere" state instead of silently overwriting.
5. Writes use explicit projections — never `findByIdAndUpdate(body)`.
6. Audit entry, then `revalidatePath` so the storefront reflects the
   change on the next request.

`safeAdminRedirect` (character-code loop, no regex backtracking) only
accepts same-origin paths after login, blocking open redirects.

## F. Admin routes & experience

- `/admin/login` — the only unauthenticated admin route; already-signed-in
  owners are redirected to the dashboard.
- `/admin` — real-data dashboard: product counts by status, **unavailable
  count** (published but missing price or category — the operational
  to-do list), category counts, recently updated products with dates.
- `/admin/products` — search, status/category/unavailable filters, sort,
  pagination; honest states ("Not set" price, "No photos yet").
- `/admin/products/new` / `/admin/products/[id]/edit` — full form:
  integer-cent pricing (dollars entered, cents stored), optional variants,
  draft/published radios, tags, display order, image manager.
- `/admin/categories` — create/edit forms with product counts, Active /
  Disabled badges, fixed web addresses ("Fixed after creation so existing
  links keep working"), disable-with-confirmation when products reference
  the category.

Design compliance: gold focus rings on every interactive element, no
invented data anywhere (all counts and rows come from the database),
em-dash-free copy, responsive from 320 px with an accessible mobile
drawer (focus trap, Escape, backdrop, 44 px targets). All admin routes
are `noindex` and render without storefront chrome.

## G. Product & category semantics

- **Money:** prices are entered in dollars and stored as **integer cents**
  (`priceCents`, validated `Number.isInteger`, ≥ 1); no floats, no `$0`
  placeholders; a discounted price must be lower than the base price.
- **Variants:** optional; each variant has its own integer-cent price and
  stock scaffolding; a product without variants uses its base price.
- **Archive, never delete:** archiving hides a product from the storefront
  but keeps the record, photos and history; reversible via Restore.
- **Category slugs are fixed at creation**, so renames never break public
  filter links; categories are disabled, never deleted, so product
  references always remain valid.
- **Editable product slugs with redirect memory:** changing a slug pushes
  the old one into `previousSlugs` (max five); `src/proxy.ts` issues the
  308 redirect before any response streams (a page-level
  `permanentRedirect` remains only as a dev/bypass fallback, because a
  postponed static shell commits a 200 before page code can redirect).
  `resolvePublicProductSlug` requires the product's category to be active,
  matching the published-product rule.

## H. Cloudinary signed uploads

Full contract in `docs/CLOUDINARY_UPLOADS.md`. The trust model:

1. `requestUploadSignatureAction` (session-guarded) returns a signature
   whose parameters the **server fixes**: folder
   `pearl-signature/products`, `overwrite=false`, `unique_filename=true`,
   fresh timestamp. The API secret is used for signing and never leaves
   the server.
2. The browser posts the file **directly to Cloudinary** (XHR), so file
   bytes never transit the Next.js server.
3. `attachImageAction` re-fetches the asset from Cloudinary's Admin API
   and validates folder, type, format (JPEG/PNG/WebP), size (≤ 5 MB) and
   dimensions; the stored image record is built **exclusively** from that
   authoritative response, so a forged client reply cannot attach an
   arbitrary URL or a foreign asset. Alt text is required.
4. Limits and cleanup: an atomic `< 10 images` guard on the `$push`;
   assets that fail verification or exceed the limit are destroyed
   (unless another product references them); removal detaches first and
   destroys only when orphaned (reference-counted).
5. Without credentials, `isUploadConfigured()` gates everything: the edit
   page shows the honest "Photo uploads are not configured on this
   deployment yet" notice (screenshot captured) and every action returns
   the generic not-configured result. Nothing fails silently.

## I. Storefront integration

- Every mutation calls `revalidatePath` (scoped via
  `src/lib/server/invalidate.ts`), so the public site reflects changes on
  the next request — verified end-to-end in e2e (create draft → invisible;
  publish → visible; search finds it; archive → gone; restore → back).
- **Phase 2B search behaviour is preserved:** the admin e2e suite
  explicitly re-tests title-first relevance and typo tolerance after
  mutations.
- Storefront pages themselves are unchanged; the only public-surface
  addition is the previous-slug 308 in `src/proxy.ts`.

## J. Next 16 Cache Components correctness (the phase's one deep bug)

**Symptom:** after any admin mutation, revisiting `/admin` or
`/admin/products/new` returned a raw `500` ("Internal Server Error",
`text/plain`, 21 bytes) — even for anonymous requests — while the other
admin routes kept working.

**Root cause (empirically isolated):** every admin document
request/prefetch runs a runtime *shell attempt* (prerender pass). Pages
whose first `await` is a dynamic access bailed early and were benign, but
the dashboard and `/admin/products/new` ran their **data reads**
(mongoose driver internals calling `new Date()`) during the attempt,
tripping Next's blocking current-time guard
(`blocking-prerender-current-time`). Pre-mutation this failure was
benign; after `revalidatePath("/", "layout")` purged the stored shells,
the next shell regeneration hit the same guard failure as an **uncaught**
`NEXT_STATIC_GEN_BAILOUT` cascade → fatal 500.

**Fix (documented Next pattern):** `await connection()` as the first
statement in all six admin data surfaces (dashboard layout, login page,
dashboard, products list, products/new, edit, categories), so no
prerender/prefetch/shell pass ever executes admin code; everything renders
at request time, which is what auth-gated pages must do anyway. After the
fix: zero 500s, zero bailout cascades, and **zero prerender reports** in
server logs (previously one noisy report block per admin page view).

**Test defect found en route:** with the 500 gone, e2e reached a
previously unexercised step where the test re-checked a category's
visibility checkbox while its armed "Confirm disable" state was showing.
The component deliberately disarms a stale confirmation when the form
changes (safety property: a confirmation must never apply to edited
state), so the test was updated to click the disarmed "Save changes"
button — matching the designed flow rather than weakening the guard.

## K. Verification (all executed)

| Command | Result |
| --- | --- |
| `npx next typegen && npm run typecheck` | ✅ PASS — 0 errors |
| `npm run lint` | ✅ PASS — 0 errors / 0 warnings |
| `npm run test` | ✅ PASS — **328/328** (30 files: password, session, rate-limit, guard, actions, validations, repositories, components) |
| `npm run build` | ✅ PASS — all `/admin/**` routes dynamic (`ƒ`); storefront routes unchanged; no DB needed at build |
| `npm run test:e2e` | ✅ PASS — **50/50** (39 storefront `chromium` + **11 admin**), clean server logs (zero prerender noise) |
| `npm run screenshots` | ✅ PASS — **129 captures** (95 public + **34 admin**: login, dashboard, products, new/edit forms, categories, mobile drawer at 360/390/768/1024/1440, upload-not-configured), **0 horizontal overflow** |
| Visual review | ✅ PASS — admin captures inspected: gold focus rings, real seeded counts (12/11/1/0, 3 categories), honest "Not set"/"No photos yet" states, stable-slug notices, mobile drawer with backdrop, amber not-configured notice |

**E2E admin coverage (11 tests):** anonymous redirect without storefront
chrome; wrong credentials produce one generic error; valid credentials
open the dashboard with real seeded counts; sign-out revokes the session
server-side; draft creation stays off the storefront; publishing makes it
visible and Phase 2B search still works; slug change keeps the old address
redirecting; unavailability is visible and archiving removes without
deleting; list search/filter/pagination; category create/rename/disable
with confirm-and-back-out; mobile drawer, list and forms at 360×740.

**Defects found during verification and fixed:** (1) the shell-attempt 500
described in §J; (2) the e2e disarm-flow expectation described in §J;
(3) earlier in the phase: seed `updatedAt` under `$setOnInsert`, an
illegal non-async re-export in a `"use server"` file, previous-slug
redirects moved into `src/proxy.ts`, and `resolvePublicProductSlug`
requiring an active category.

## L. Not verifiable in this phase (documented, not faked)

- **Hosted Atlas admin flows** — no `MONGODB_URI` was supplied; all admin
  e2e ran against `mongodb-memory-server` with the real seed and bootstrap
  scripts. `docs/MONGODB_SETUP.md` + `docs/ADMIN_AUTH.md` cover the
  production steps.
- **Real Cloudinary uploads** — no credentials were supplied; the signed
  flow is unit-tested and the not-configured state is what ships and is
  screenshotted. `docs/CLOUDINARY_UPLOADS.md` §6 is the runbook for the
  first real upload.
- **Deployment / production domain / HTTPS** — out of scope (Phase 4).

## M. Security notes for review

- Session cookie: HttpOnly + Secure (prod) + SameSite=Lax + Path=/admin.
- Argon2id; no bcrypt/PBKDF2 fallback path exists.
- No secret, hash or connection string appears in source, logs, argv or
  client bundles; the bootstrap scripts redact credentials defensively.
- Every action re-authorizes; page guards are UX only; no mass assignment;
  optimistic concurrency; safe ObjectIds; open-redirect protection.
- Rate limiting fails closed; login errors are generic; audit entries are
  TTL-bounded and free of secrets.
- Upload signatures are server-fixed and short-lived; assets are verified
  server-side before attach; orphan cleanup prevents storage abuse.
