# PEARL Signature: Phase 7B Progress

Authoritative requirements live in `docs/PHASE7B_SPEC.md`. This file tracks
architecture decisions, milestone progress, database changes, tests, problems,
external blockers and remaining tasks.

## Milestones

- [ ] **7B-A** Specification and audit
- [ ] **7B-B** OTP system and server-side checkout enforcement
- [ ] **7B-C** Persistent guest sessions
- [ ] **7B-D** My Orders, email-only recovery and navigation
- [ ] **7B-E** Integration and regression
- [ ] **7B-F** Final verification, docs, report and stop

## Architecture decisions

### Authority and scope

- Phase 7B only. No deployment, no live Stripe, no Phase 8.
- Preserve all Phase 1 to 7 behaviour and tests. Extend, never replace, the
  existing challenge/grant/capability model.
- Guest access stays account-free. OTP proves control of an email; it is never a
  password and no reusable secret is returned to client JavaScript.

### One identity model

- `guest_sessions` is the single remembered-access record: hashed opaque token,
  one verified email, verification timestamp, expiry, revocation.
- `email_verification_challenges` replaces the narrow tracking challenge for new
  work while keeping the existing tracking challenge readable for old codes.
  Purpose distinguishes `checkout`, `recovery` and `order_email_change`.
- A successful verification either creates a guest session (first time) or
  rotates the token of the existing one (shared device / re-verification).
- The Phase 5 order confirmation capability and Phase 7 scoped grant continue to
  authorise their own order only. They never grant email-wide history.

### OTP protection

- Six digits from `randomInt(0, 1_000_000)` padded to six characters.
- Digest: HMAC-SHA-256 over `challengeId + ":" + code` with
  `GUEST_OTP_SECRET`. If the secret is absent the feature is unavailable and
  checkout verification fails closed (no fallback to an unsalted hash).
- Constant-time comparison with `timingSafeEqual`.
- TTL index plus explicit `expiresAt` check in application logic.
- Atomic consume via `findOneAndUpdate` with `consumedAt: null` and
  `attempts: { $lt: MAX }`.
- Resend supersedes: previous unconsumed challenge for the same purpose and
  identity is consumed/invalidated in the same request.

### Rate limits

- Reuse `order_attempts` buckets: new scopes for `otp.request` (per IP and per
  email digest), `otp.verify` (per challenge/IP) and recovery requests.
- Per-email request budget is keyed by an HMAC of the email, so a hostile actor
  cannot trivially lock a victim's email permanently; the cooldown is short and
  the window rolls.
- Resend cooldown of 60 seconds is enforced on the challenge record itself
  (`lastSentAt`) in addition to the bucket.

### Sessions

- 32 random bytes (`randomBytes(32)`) base64url = 256 bits.
- Stored as sha256 of the raw token; raw token only in cookie
  `pearl_guest` (`HttpOnly`, `SameSite=Lax`, `Path=/`, host-only, `Secure` in
  production, `Max-Age` 30 days).
- Cookie writes only in Server Actions. Reads use `cookies()` inside Server
  Actions and Route Handlers only.
- Session rotation on every successful verification.
- Revocation sets `revokedAt`; lookups require `revokedAt: null` and
  `expiresAt > now`.
- Guest session and admin session cookies have different names and are never
  interchangeable.

### Server-side enforcement

- `placeOrderAction` resolves the guest session, requires a verified email equal
  to the submitted checkout email, and requires
  `verifiedAt >= now - CHECKOUT_VERIFICATION_TTL_MS` (30 minutes,
  configurable).
- The check runs inside `createOrder` via an explicit `verifiedEmail` argument so
  no caller can create an order without passing it.
- Both payment methods pass through the same check. Stripe webhooks never depend
  on the session.
- Readiness adds `guestVerification.ready` (Resend configured + OTP secret +
  sender) to the order-intake gate.

### My Orders and recovery

- `/my-orders` is the primary destination. Server shell renders; the client
  calls a private Server Action that derives orders from the session identity.
- `/track?ref=` remains for direct order links and legacy capabilities.
- Recovery requests are generic before verification. The visible list is always
  derived server-side from the verified session email.
- Pagination: 10 orders per page, grouped active/completed/cancelled within the
  page, recent first.

### Confirmation and navigation

- One primary label: **My Orders** in navigation; **Track Order** on a specific
  order and in emails.
- Confirmation adds View My Orders and keeps accurate payment copy.
- Emails link to `${siteUrl}/track?ref=...` only, never a credential.

### Legacy migration

- Legacy sessionStorage capabilities keep working for their own order.
- A valid legacy capability may create a scoped grant but never an email-wide
  session.
- Existing tracking challenges stay valid until expiry; new codes use the new
  collection.

## Database changes

| Collection | Purpose | Key indexes |
| --- | --- | --- |
| `guest_sessions` | Hashed opaque session, verified email, expiry, revocation | `tokenHash` unique; `expiresAt` TTL; `email` + `verifiedAt` |
| `email_verification_challenges` | Purpose-scoped OTP challenge | `challengeId` unique; `expiresAt` TTL; `email` + `purpose` + `createdAt` |

Existing `orders`, `tracking_challenges`, `order_access_grants`, `order_attempts`
and `notification_outbox` are extended only where necessary.

## Affected routes and modules

- `/checkout` and checkout client: verification step.
- `/my-orders`: new page.
- `/track`: recovery entry, remembered-session awareness.
- `/order/[reference]` confirmation: tracking actions.
- Server Actions: `orders.ts`, `tracking.ts`, new `guest-session.ts` /
  `verification.ts`.
- Models: `guest-session.ts`, `email-verification-challenge.ts`.
- Notifications: OTP template and sender, tracking link copy.
- Navigation: `data/navigation.ts`, header, mobile nav, footer.
- Readiness: `notifications/config.ts`, business configuration docs.

## Risks

- Cache Components: cookies cannot be set during render; all writes in actions.
- Next.js 16 proxy/middleware and route handler constraints.
- E2E harnesses run `next start`; new collections need explicit indexes in seed
  and harness setup.
- Existing tests assert current copy; changes must stay additive.
- Resend remains unverified; no real delivery may be claimed.
- Git push authentication remains blocked; commits stay local.

## Verification log

(updated in 7B-F)
