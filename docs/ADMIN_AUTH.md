# PEARL Signature — Admin Authentication & Security (Phase 3)

> This document describes the owner authentication system delivered in
> Phase 3: Argon2id password hashing, database-backed sessions, login rate
> limiting without a paid Redis, audit logging, and the guarded bootstrap /
> password-reset operator scripts. Customer accounts, checkout and Stripe
> are explicitly out of scope for Phase 3.

---

## 1. Threat model and design principles

The admin dashboard is the only privileged surface in Phase 3. Its
boundaries follow these rules:

- **Every Server Action re-authorizes itself.** Page-level redirects are
  navigation UX only; a mutation can never succeed because the caller
  reached an admin URL. Each action calls `requireActionAdmin()` (see
  `src/lib/auth/guard.ts`) as its first step.
- **Generic credential errors.** Sign-in failures never reveal whether the
  email exists, whether the password was wrong, or whether the account is
  disabled. The same generic message covers all three cases.
- **No mass assignment.** Action inputs are parsed with Zod schemas that
  strip unknown keys; role, status, password hash and id fields submitted
  from the browser are never read.
- **Optimistic concurrency on edits.** Product and category updates carry
  the record version they were loaded from; a stale edit is rejected with
  a clear "someone else changed this" state rather than overwriting.
- **Safe ObjectIds.** Any route or action that accepts an `id` validates it
  as a 24-character hex ObjectId before it reaches a query; malformed ids
  are treated as "not found", never as a query error.
- **Open-redirect protection.** Post-login redirects only accept same-origin
  paths (`safeAdminRedirect`); a crafted `?next=` cannot leave the site.
- **No secrets in the browser.** The session cookie is HttpOnly; the
  Cloudinary API secret exists only in server environment variables; rate
  limit keys and audit entries store hashes, not raw addresses or emails.

---

## 2. Password hashing — Argon2id

- Algorithm: **Argon2id** via the audited WASM-free Rust implementation
  `@node-rs/argon2` (native binding, compatible with Atlas M0 and every
  deployment target we support).
- Parameters follow the OWASP-recommended Argon2id profile (19 MiB memory,
  2 iterations, parallelism 1). See `src/lib/auth/password-core.ts` for the
  exact parameters and the low-level functions.
- Code split:
  - `src/lib/auth/password-core.ts` — pure functions (`hashPassword`,
    `verifyPassword`, `validatePasswordPolicy`); unit-tested directly.
  - `src/lib/auth/password.ts` — thin server-only re-export so client
    bundles can never pull the native binding.

### Password policy

- Minimum **10 characters**, maximum 200 (hashing cost is linear in input
  length, so an upper bound prevents a resource-exhaustion vector).
- No composition rules (no forced digit/symbol); length is the primary
  signal. The policy function returns a human-readable rejection reason or
  `null` when acceptable.

---

## 3. Sessions

- The browser holds a **256-bit opaque random token** in the
  `pearl_admin_session` cookie:
  - `HttpOnly: true` (never readable from JavaScript)
  - `Secure: true` in production (plain HTTP allowed in development)
  - `SameSite: Lax` (blocks cross-site POSTs while preserving
    same-origin navigations)
  - `Path: /admin` (the cookie is never sent to storefront routes)
  - `Max-Age` = 7 days
- MongoDB stores **only the SHA-256 hash** of the token. A database dump
  cannot be replayed as a session.
- Session lifetime is **absolute** (7 days from creation, no sliding
  renewal). The expiry is re-checked on every request; expired rows are
  removed opportunistically and by a TTL index.
- Client addresses are stored **hashed** (`hashClientValue`) for audit
  correlation; raw IPs are never persisted.
- Signing out deletes the session row first, then clears the cookie, so a
  stolen cookie dies server-side even before the browser notices.
- Disabling an admin account (`status: "disabled"`) revokes all of its
  sessions immediately; `getSessionAdmin()` re-reads the account status on
  every request.

### Resolution path

`getSessionAdminFromCookies()` → `cookies()` → `getSessionAdmin(token)` →
session lookup by token hash → account lookup → status/expiry checks. All
privileged code derives the acting admin through this path (pages via
`requirePageAdmin()`, actions via `requireActionAdmin()`); there is no
second, weaker path.

---

## 4. Login rate limiting (no paid Redis)

Implemented in `src/lib/auth/rate-limit.ts` with MongoDB document buckets:

- Key: `sha256(address | email | 15-minute-bucket)`. The bucket document
  holds an atomic `$inc` counter; a unique index makes the upsert
  concurrency-safe across instances.
- Limits: **5 failed attempts per address per 15 minutes** and
  **5 failed attempts per email per 15 minutes** (both must pass). A
  successful sign-in clears the bucket.
- **Fail-closed:** if MongoDB is unreachable, sign-in is refused with the
  generic error (the credential check needs the database anyway, so
  allowing sign-in would be impossible regardless).
- Buckets expire via a **TTL index** (60-second sweep lag past the window
  is documented and accepted).
- Known limitations (accepted for this scale): NAT-shared addresses share
  a bucket; only hashes of the address/email are stored.

---

## 5. Audit logging

Every security-relevant outcome is appended to the `auditlogs` collection
(`src/models/audit-log.ts`):

- Events: `admin.login.success`, `admin.login.failure`,
  `admin.login.rate_limited`, `admin.logout`, `admin.password_reset`,
  `admin.bootstrap`, product/category create/update/archive/restore,
  image upload/attach/remove.
- Entries record: event, outcome, admin id (when known), hashed address,
  and a short detail string. **Password material, session tokens and API
  secrets are never written.**
- The collection has a **180-day TTL index**; entries are operational
  history, not permanent records.

---

## 6. Owner bootstrap (guarded CLI)

The first owner account is created only by an explicit operator command —
never on startup, build or through a web request:

```bash
npm run admin:bootstrap -- --yes
```

- Interactive by default: email prompt plus a **hidden** password prompt
  (echo suppressed, minimum 10 characters, confirmed twice).
- Prints the target host and database name before connecting — never
  credentials, never the full connection string.
- Refuses to run without `MONGODB_URI`; refuses to create a **second**
  owner (rotate the existing password instead); under `NODE_ENV=production`
  it additionally requires `--force-production`.
- Automation variant for disposable test environments only:
  `ADMIN_EMAIL=… ADMIN_PASSWORD=… npm run admin:bootstrap -- --yes --non-interactive`
  (the password is read from the environment, never argv).
- While connected, the script creates the auth-related indexes (admins,
  sessions, login attempts, audit log) so a fresh database is immediately
  consistent.

---

## 7. Password reset (guarded CLI)

Public "forgot password" email flows belong to a later phase (they require
transactional email infrastructure). Until then, credential rotation is an
operator command:

```bash
npm run admin:reset -- --email owner@example.com --yes
```

- Hidden, confirmed password prompt (or `ADMIN_PASSWORD` with
  `--non-interactive` for automation).
- Hashes the new password with Argon2id, then **revokes every live session
  for that account**, so any stolen cookie becomes invalid immediately.
- Writes an `admin.password_reset` audit entry (event only, no password
  material).
- Same safety rails as bootstrap: explicit `--yes`, host/database printout,
  production guard.

---

## 8. Server Actions — authorization checklist

Every admin mutation follows this pattern (see `src/lib/actions/*.ts`):

1. `requireActionAdmin()` — re-validate the session cookie against
   MongoDB; unauthorized callers receive a generic failure, never a
   redirect chain.
2. Zod-parse the raw form data with a schema that strips unknown keys.
3. Validate invariants server-side (integer-cent prices, slug rules,
   category references, safe ObjectIds).
4. Check **optimistic concurrency** (version field) before writing.
5. Perform the write with an explicit field projection — never
   `findByIdAndUpdate(body)` with client-supplied keys.
6. Write an audit entry.
7. `revalidatePath` so the storefront reflects the mutation immediately.

The login action additionally layers the rate limiter (step 1.5) and uses
identical error text for "unknown email", "wrong password" and "disabled
account".

---

## 9. Environment variables (admin surface)

| Variable | Purpose | Exposed to browser |
| --- | --- | --- |
| `MONGODB_URI` | Atlas M0 connection string (sessions, audit, rate limits) | No |
| `SESSION_SECRET` | Reserved for future signed-token needs; unused in Phase 3 | No |
| `ADMIN_EMAIL` / `ADMIN_PASSWORD` | Automation-only inputs for the bootstrap/reset CLIs in disposable environments | No |

No new environment variables are required for the storefront itself: the
admin surface works with the same `MONGODB_URI` already used by the
catalogue.

---

## 10. Testing

- Unit tests (`src/lib/auth/*.test.ts`, `src/lib/actions/*.test.ts`) cover:
  password hashing/verification, token hashing, rate-limit bucket math,
  redirect sanitization, guard outcomes, and Zod schemas rejecting mass
  assignment.
- Playwright (`e2e/admin/admin.spec.ts`, project `admin`) exercises the
  full flow against a disposable in-memory MongoDB with a real seeded
  database: anonymous redirect, wrong credentials (generic error), valid
  credentials → dashboard with real counts, sign-out revoking the session
  server-side, and the mobile drawer.

The disposable e2e stack (`scripts/e2e-admin-server.ts`) bootstraps a
throwaway owner account with credentials that exist only for the test run.
