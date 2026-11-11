# CLIVS: Phase 7B Progress

Authoritative requirements live in `docs/PHASE7B_SPEC.md`. This file tracks
architecture decisions, milestone progress, database changes, tests, problems,
external blockers and remaining tasks.

## Milestones

- [x] **7B-A** Specification and audit (`9c1af5f`)
- [x] **7B-B** OTP system and server-side checkout enforcement (`0e6822a`)
- [x] **7B-C** Persistent guest sessions and their indexes (`0080c2d`)
- [x] **7B-D** My Orders, email-only recovery and navigation (`a0dce68`)
- [x] **7B-E** Integration, regression and the guest-journey browser matrix (`c034b84`)
- [x] **7B-F** Final verification, documentation, report and stop

## Architecture decisions

### Authority and scope

- Phase 7B only. No deployment, no live Stripe, no Phase 8.
- All Phase 1 to 7 behaviour and tests are preserved. The challenge/grant/
  capability model is extended, never replaced.
- Guest access stays account-free. A code proves control of an email; it is never
  a password, and no reusable secret is returned to client JavaScript.

### One identity model

- `guest_sessions` is the single remembered-access record: hashed opaque token,
  one verified email, verification timestamp, expiry, revocation.
- `tracking_challenges` was generalised rather than duplicated. It is now the
  single challenge collection for every purpose, keeping its name so existing
  TTL-indexed rows are not migrated. The model is also exported as
  `EmailVerificationChallengeModel`.
- New fields: `challengeId`, `purpose`, `digestVersion`, and a nullable
  `reference` (only `tracking` rows carry one).
- A successful verification creates a guest session (first time) or rotates the
  existing one (shared device, re-verification).
- The Phase 5 confirmation capability and the Phase 7 scoped grant continue to
  authorise their own order only. They never grant email-wide history.

### OTP protection

- Six digits from `randomInt(0, 1_000_000)`, zero-padded.
- Digest: HMAC-SHA-256 over `challengeId:email:purpose:code` keyed by
  `GUEST_OTP_SECRET` (minimum 32 characters). An absent or short secret makes the
  feature unavailable and checkout fails closed; there is no fallback to an
  unsalted hash.
- Constant-time comparison with `timingSafeEqual` over equal-length hex buffers.
- TTL index plus an explicit `expiresAt` check in application logic.
- Atomic consume via `findOneAndUpdate` guarded by `consumedAt: null`,
  `expiresAt > now` and `attempts < 5`.
- Resend supersedes: every unconsumed challenge for the same
  `(email, purpose, reference)` is consumed before the new one is written.
- Provider refusal deletes the challenge, so a code nobody received cannot stay
  valid.

### Rate limits

- Reuse the durable `order_attempts` buckets. New scopes: `otp.request`
  (10 per 15 min per address), `otp.email` (5 per 15 min per address and
  purpose), `otp.verify` (15 per 15 min per address).
- Per-email budgets are keyed by a hash, so no raw address is stored and a
  victim cannot be locked out permanently: the window rolls.
- A 60-second resend cooldown is enforced on the challenge row itself
  (`lastSentAt`), configurable through `GUEST_OTP_RESEND_COOLDOWN_SECONDS`.

### Sessions

- 32 random bytes (`randomBytes(32)`) base64url, 256 bits.
- Only `sha256(token)` is stored. The raw token lives only in the `pearl_guest`
  cookie: `HttpOnly`, `SameSite=Lax`, `Path=/`, host-only, `Secure` in
  production, explicit `Max-Age` of 30 days.
- Cookie writes only in Server Actions. Reads may happen in Server Components
  because reading cannot mint a session.
- Rotation on every successful verification; the previous row is revoked first.
- Revocation sets `revokedAt`; lookups require `revokedAt: null` and
  `expiresAt > now`.
- Guest and admin cookies have different names and grant different things.

### Server-side enforcement

- `placeOrderAction` resolves the guest session, requires a verified email equal
  to the submitted checkout email, and requires `verifiedAt` within
  `GUEST_CHECKOUT_VERIFICATION_MINUTES` (default 30).
- The check runs inside `createOrder` through an explicit `verifiedGuest`
  argument, before idempotency and before payment readiness, so no caller can
  create an order without it and an unverified replay cannot return a cached
  success.
- Both payment methods share the same path. Stripe webhooks never depend on the
  session.
- Readiness adds `guestVerification.ready` (provider configured plus a strong OTP
  secret) to the order-intake gate.

### My Orders and recovery

- `/my-orders` is the primary destination. It is server-rendered per request
  (`await connection()`, `instant = false`) and hands the initial session to the
  client, so a returning customer does not see a flash of the recovery form.
- The list itself comes from a Server Action that derives the query from the
  session identity. The browser sends only a page number.
- `/track?ref=` remains for direct order links and legacy capabilities, and
  `loadOrderTrackingAction` falls back to the remembered device when no
  capability or grant is present.
- Recovery requests are generic before verification. The visible list is always
  derived server-side from the verified email.
- Pagination: 10 orders per page, grouped active/completed/cancelled within the
  page, newest first.

### Confirmation and navigation

- One primary label: **My Orders** in navigation; **Track Order** on a specific
  order and **Track My Order** in email.
- `orderConfirmationRequestSchema.accessKey` is optional. When the tab's
  capability is gone, the server falls back to the remembered device so the
  confirmation survives a browser restart. A viewer with neither gets the
  "not open on this device" notice and the recovery route.
- Order emails link to `${siteUrl}/my-orders`, the public entry point, never to a
  URL carrying a credential.

### Legacy migration

- Phase 5/7 `sessionStorage` capabilities keep working for their own order.
- A legacy capability can never create an email-wide session.
- Legacy Phase 7 tracking challenges (no `purpose`, no `challengeId`, unsalted
  sha256 digest) remain verifiable through the tracking path only, and a legacy
  row without an email is refused.

## Database changes

| Collection | Purpose | Key indexes |
| --- | --- | --- |
| `guest_sessions` (new) | Hashed opaque session, verified email, expiry, revocation | `tokenHash` unique; `expiresAt` TTL; `email` + `revokedAt` + `createdAt` |
| `tracking_challenges` (extended) | Purpose-scoped code challenge for every flow | existing TTL and lookup indexes; `purpose`/`challengeId` fields added |
| `orders` (extended) | `guest.verifiedEmail` and `guest.verifiedAt` snapshot | `{ "customer.email": 1, createdAt: -1 }` |

`scripts/seed.ts` and both E2E harnesses create the new indexes explicitly
(`autoIndex` is off).

## Affected routes and modules

- `/checkout`: mandatory verification panel (`src/components/checkout/email-verification.tsx`).
- `/my-orders`: new page and client (`src/app/my-orders`, `src/components/tracking/my-orders.tsx`).
- `/track`: email-only recovery entry, remembered-session awareness.
- `/order-confirmation`: Track Order and View My Orders, session fallback.
- Server Actions: `src/lib/actions/guest-verification.ts`, `orders.ts`,
  `tracking.ts`.
- Guest core: `src/lib/guest/{otp,policy,readiness,session,challenges,state}.ts`.
- Models: `src/models/guest-session.ts`, `src/models/tracking-challenge.ts`.
- Notifications: `send-guest-code.ts`, guest code template, order email link.
- Navigation: `src/data/navigation.ts`, header, mobile menu, footer.

## Problems and decisions during implementation

| Problem | Decision |
| --- | --- |
| A new challenge collection would orphan live TTL rows | Generalise `tracking_challenges` with a `purpose` discriminator and keep the name |
| Unsalted sha256 is reversible for a 6-digit space | Keyed HMAC with a separate server secret, bound to the challenge context |
| The tracking page short-circuited when the browser held no capability | Always ask the server once; the server alone knows whether the remembered device matches |
| A "not found" answer on a deep link would imply the order does not exist | Answer `no_access` when the browser holds no proof, `not_found` only when a wrong capability was presented |
| E2E per-email budgets are small | Each order uses a distinct synthetic address and each journey scenario a distinct synthetic address |
| The orders screenshot flow placed an order without verification | The script now reads the code from the file sink and verifies before placing |
| Sticky header painted mid-page in full-page captures | Scroll to the top before each full-page capture |

## Risks

- Cache Components: cookies cannot be set during render; every write is in an
  action.
- Next.js 16 proxy/middleware and route-handler constraints.
- E2E harnesses run `next start`; new collections need explicit index creation.
- Existing tests assert current copy; changes stay additive.
- Resend remains unverified; no real delivery may be claimed.
- Git push succeeded on the final attempt (`origin/main` is now `cf73319`);
  earlier non-interactive credential failures are historical, not current.

## Verification log

All commands were run from the repository root on the final tree.

| Gate | Result |
| --- | --- |
| `npx next typegen` | Pass |
| `npm run typecheck` | Pass, no errors |
| `npm run lint` | Pass, zero errors and zero warnings |
| `npm run test` | **878 passed / 878** (63 files) |
| `npm run build` | Pass (25 pages, `/my-orders` dynamic, `/track` static shell) |
| `npm run test:e2e` | **106 passed / 106** across all five projects |
| `npm run screenshots` | Pass, zero horizontal overflow at every width |

Targeted suites added in 7B-B to 7B-E:

| Suite | Tests |
| --- | --- |
| `src/lib/guest/otp.test.ts` | 21 |
| `src/lib/guest/session.test.ts` | 15 |
| `src/lib/guest/challenges.test.ts` | 19 |
| `src/lib/actions/guest-verification.test.ts` | 23 |
| `src/lib/orders/create.test.ts` (5 of 39 cover the new verification gate) | 39 |

## External blockers

| Blocker | Impact |
| --- | --- |
| No `RESEND_API_KEY`, verified sending domain, `EMAIL_FROM`, `OWNER_NOTIFICATION_EMAIL` or `GUEST_OTP_SECRET` in the real environment | Checkout correctly reports verification unavailable; no real email has ever been sent |
| Genuine Stripe test-mode payment still unverified (Phase 6 carry-over) | Online payment stays disabled until a real test-mode key is provided |
| `CLOUDINARY_CLOUD_NAME` does not match `pearl-signature-preview` | Preview images fall back to the honest placeholder |
| A GitHub PAT was exposed earlier | The owner must rotate it |
