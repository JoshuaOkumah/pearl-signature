# PEARL Signature: Phase 7B Specification

This file preserves the approved Phase 7B brief in an implementation-ready form
so a later session can continue without the original chat message. The user's
full prompt is the governing source; where this copy is silent, the prompt and
the earlier phase reports decide.

## 1. Objective and authority

Make the guest ordering and tracking experience secure, intuitive, persistent
and reliable **without customer accounts**. A customer must be able to place an
order, close the browser, return later, and find and track their orders without
registering or remembering an order number.

This is an enhancement of Phases 1 to 7, not a replacement. Implement Phase 7B
only. Do not deploy, do not activate live payments, and do not begin Phase 8
without explicit owner approval. Preserve the Phase 6 and Phase 7 limitations:
no genuine Stripe test-mode payment has been verified, and no real Resend email
has been delivered.

## 2. Repository context

Next.js 16 App Router with Cache Components, React 19, strict TypeScript,
Tailwind v4, Motion, Lucide, Fraunces/Manrope, MongoDB Atlas M0/Mongoose, Zod,
Cloudinary, Stripe Checkout, Resend, Vitest and Playwright.

Existing relevant systems:

- Guest checkout with a server-authoritative order pipeline (`createOrder`).
- A single `status` lifecycle plus separate `payment.method` / `payment.status`.
- A guest confirmation capability: 32 random bytes, sha256 stored on the order,
  raw value in the tab's sessionStorage.
- Phase 7 tracking challenges (sha256 of a six-digit code, TTL, single use,
  five attempts) and scoped 24-hour order access grants.
- A durable notification outbox with idempotency, leases, retries and branded
  templates; one documented inline send for tracking codes.
- MongoDB-backed rate-limit buckets in `order_attempts`.
- Admin session authentication wholly separate from guest access.

The existing capability, challenge and grant models must be extended or
generalised, never duplicated into competing authorization models. Existing
orders, references, Stripe returns, admin access and sessionStorage access must
keep working.

## 3. New customer journey

Five stages, all mobile-first and premium in tone:

1. **Browse and add to cart.** Unchanged Phase 2 to 5 cart; no account.
2. **Checkout details.** Name, mandatory email, phone, delivery or pickup
   details, instructions. Email is normalised (trim, lower case) without
   stripping plus-addressing or altering meaningful characters.
3. **Verify email.** A six-digit OTP proves control of the address and the
   server establishes a verified guest identity.
4. **Place the order.** After verification the customer chooses Stripe online
   payment or Cash on Arrival; the existing server-authoritative pipeline still
   creates the order.
5. **Return and track.** My Orders shows history; an individual order shows
   fulfilment and payment state; email updates continue; the same browser needs
   no new code; another device recovers access with an email OTP.

No customer registration, passwords, social login or SMS.

## 4. Mandatory checkout email verification

- Email is required and validated; the customer may edit it before verifying.
- **Send Verification Code** validates, rate limits, generates a secure code,
  persists a protected challenge, sends through the existing Resend
  abstraction with a bounded awaited call, then shows the code-entry interface.
- OTP: exactly six numeric digits from `randomInt`/`randomBytes` (never
  `Math.random()`), ten-minute expiry, single use, at most five wrong attempts,
  60-second resend cooldown, bounded issuance per email, per session/device and
  per IP.
- Storage: only a keyed digest, HMAC-SHA-256 with a server secret and
  challenge-specific context. Never plaintext, never an unsalted sha256.
  Constant-time comparison. TTL index plus application-level expiry checks.
- A resend supersedes the previous challenge; old codes stop working. Repeated
  clicks must not generate excessive email.
- Success atomically consumes the challenge, records the verified email and
  timestamp, establishes or rotates the guest session, and keeps the cart.
  No reusable authentication secret is returned to client JavaScript.
- Errors: "That code is incorrect. Please try again." and "Your verification
  code has expired. Request a new code to continue." No implementation detail.
- Changing the email invalidates the prior verification and requires a new OTP;
  the previous verified email can never be substituted into order creation.

## 5. Server-side enforcement

Before accepting any guest order the server verifies:

1. A valid verified guest identity exists.
2. The submitted checkout email equals the server-verified email.
3. The verification is recent enough (initial maximum age 30 minutes,
   configurable).
4. The session is unexpired and unrevoked.
5. The caller is authorised for that verification context.
6. Business configuration is ready (including working verified-email setup).
7. The existing cart and pricing rules pass.

The same requirement applies to Cash on Arrival and Stripe orders. There must
be no alternative unprotected order-creation endpoint. Direct Server Action
calls cannot bypass verification.

Stripe integrity is untouched: signed webhooks, idempotency, price integrity,
guest capability protection, reconciliation and feature gates all remain.
Webhooks must remain independently processable after the browser session ends.

## 6. Persistent guest sessions

- Database-backed opaque tokens with at least 256 bits of entropy.
- Only a hash stored in MongoDB; the raw token lives only in an HttpOnly,
  Secure (production), SameSite cookie with explicit Max-Age/Expires, host-only
  scope and an appropriate Path.
- 30-day remembered-device lifetime, enforced server-side; expiry is not
  extended indefinitely.
- Cookies are created, replaced or deleted only in Server Actions or Route
  Handlers. Never during Server Component render. `runtime = "nodejs"` is
  forbidden under Cache Components.
- Raw tokens never appear in localStorage, sessionStorage, URLs, query
  parameters, logs, analytics or database documents.
- Guest sessions are wholly separate from admin sessions; neither grants the
  other.
- A valid remembered session shows the verified email's orders without a new
  code. A fresh checkout may still require a fresh verification (30 minutes).
- **Forget This Device** revokes the session server-side, clears the cookie,
  removes remembered access and returns the customer to verification or
  tracking. Explain that remembered access is for trusted personal devices.

## 7. Shared-device and multi-email safety

- One active verified email per guest session.
- Switching identity requires a successful OTP for the new email, rotates the
  session, removes the previous identity's orders from view and from Back
  navigation or stale caches, and never merges unrelated emails' orders.
- Multiple orders for one verified email are all visible within retention;
  individual capabilities need not be stored in JavaScript.
- Private/no-store caching for order data; no cross-user caching.
- State-changing endpoints are CSRF protected and reject cross-origin misuse.
- Client-supplied email or customer identifiers never authorise reads.

## 8. Email-only order recovery ("Find My Orders")

- Entry points on `/track` and `/my-orders`; email only. No reference, account,
  password or customer id.
- Request: validate and normalise, rate limit, return a generic response that
  does not confirm whether orders exist, issue a short-lived challenge when
  appropriate, send the OTP, allow verification.
- Success establishes or rotates the remembered session, associates the
  verified identity and shows My Orders.
- The server derives the visible collection from the verified identity. An order
  reference alone grants nothing.
- After verification an empty result may say "No orders found for this email
  address." with a Browse Menu link. Before verification, no order existence is
  disclosed.
- The process works on any device without prior capability.
- Lost email access is an owner-assisted process; no unverified phone recovery,
  no security questions, no reference-only recovery.

## 9. My Orders experience

Route `/my-orders`, integrated with `/track` and reusing tracking components.

States: authorised device; unrecognised device (email recovery); expired session
(verify again); email service unavailable (honest, no internal detail).

Content: heading, masked verified-email indicator, active/completed/cancelled
groups, reference, creation date, item summary, fulfilment status, payment
method, payment status, total and View Order. Recent first within groups.
Bounded server-side pagination. Empty state: "You haven't placed any orders
yet." with a working Browse Menu action.

Individual order: products, quantities, accepted prices, payment status, order
date, delivery or pickup, current stage, status history and relevant
instructions. No unrelated private data.

## 10. Tracking navigation and confirmation

Visible tracking navigation in the desktop header, mobile hamburger menu,
footer, confirmation page and customer emails. One primary label chosen and
applied consistently ("My Orders" with "Track Order" as the action label on a
specific order). The destination shows history or verification intelligently.

Mobile navigation must preserve Phase 1B: visible close control, no overlap,
strong contrast, focus management, scroll locking and comfortable touch targets.

Confirmation page: prominent reference, accurate payment state (never imply
Stripe success before trusted confirmation; Cash on Arrival stays unpaid until
recorded), fulfilment method, working Track Order and View My Orders actions,
and an explanation that updates arrive by email when configured. The order must
remain visible after closing and reopening a genuinely separate browser
lifecycle.

## 11. Legacy guest capability migration

- Preserve Phase 5/7 sessionStorage capability access and confirmation flows.
- A still-valid legacy capability continues to authorise its own order only.
- A single-order capability never proves control of an email identity and never
  grants email-wide order history.
- Full history requires real email verification.
- Existing orders, references, Stripe returns, admin access and historical data
  are not invalidated. Coexistence is temporary and documented.

## 12. Email notifications

- Branded OTP email: PEARL Signature, six-digit code, ten-minute expiry, why it
  was sent, no private order data, no tokens or links, no promotional copy.
- Recovery uses the same secure template with a distinct purpose label.
- Order emails include a **Track My Order** action linking to the public entry
  point only, never a guest-session credential or raw capability.
- Existing lifecycle events remain: received, confirmed, preparing, ready for
  pickup, out for delivery, completed, cancelled, verified payment.
- Outbox idempotency is preserved; repeated webhooks or admin actions do not
  duplicate email. A provider outage does not block legitimate payment webhook
  handling. New checkout verification fails closed when OTP cannot be issued.

## 13. OTP delivery and operational readiness

If the provider is not configured:

- New guest checkout cannot complete verification and cannot bypass it.
- The storefront does not pretend ordering is available; cart contents remain.
- The customer sees an honest temporary-unavailability explanation.
- Existing authorised customers can still view orders.
- Admin management and Stripe webhooks keep working.

Readiness must require a working verified-email configuration; the mere presence
of `RESEND_API_KEY` is not proof of deliverability. Production intake stays
disabled until real-provider verification and owner approval. Resend free tier
only; no paid SMS/OTP service; respect quotas and idempotency; never spam.

## 14. Customer email correction

- Before verification: free editing; any change invalidates the old checkout
  verification.
- After verification, before placement: a new OTP is required.
- After placement: an authorised customer may request a correction; the new
  address must be verified, an audit record is kept, and reassignment cannot
  happen through an unprotected form. Private order information is never sent to
  a new address before verification.
- Admin corrections require server-side authorisation and record who and when,
  preserving history. No broad order-editing privileges.
- Complicated cases use the owner-assisted process.

## 15. Database architecture

MongoDB Atlas/Mongoose only. Reuse the Phase 7 challenge/grant concepts.

Likely additions:

- Email verification challenges: purpose, canonical email identity, protected
  digest, expiry, attempts, issuance metadata, consumed state.
- Guest sessions: hashed token, verified email identity, verification timestamp,
  expiry, revocation state, bounded device metadata.

Indexes: challenge lookup and expiry, session validation and expiry, order
lookup by verified email, revocation/cleanup. Avoid unnecessary collections and
excess indexes on M0. Minimise PII; no plaintext OTPs or raw session tokens.
Historical orders follow the existing retention policy.

## 16. Security requirements

OTP is authentication. Mandatory: secure generation, short lifetime, single use,
protected storage, atomic consumption, attempt limits, resend cooldown, issuance
limits, generic pre-verification responses, server-side authorisation, session
rotation, expiry, revocation, CSRF protection, private caching, no credentials
in URLs, no secrets in logs.

Isolation: one identity cannot read another's orders; form-supplied email never
authorises reads; public browsing stays anonymous; guest cookies never grant
admin and admin cookies are never customer credentials.

Rate limiting is durable in MongoDB, balances brute-force defence with shared
IPs, and cannot trivially lock an email permanently. Rotate session identifiers
after authentication changes. Use private/no-store for My Orders, tracking,
verification and session endpoints; never place guest history in public Next.js
caches or expose private data in pre-rendered HTML.

## 17. Visual and mobile design

Preserve the identity: cream `#FDFBF7`, navy `#1A2530`, gold `#D4AF37`, leaf
`#5C7A58`, terracotta `#B86A4F`; Fraunces headings, Manrope UI. New interfaces
must feel like the premium storefront, not generic admin forms.

OTP interface: clear heading, visible destination email, accessible six-digit
input (single input or correctly implemented six cells) with paste support and
mobile numeric keyboard, clear errors, resend countdown, Change Email, loading
and success feedback. Accessibility is not sacrificed for appearance.

My Orders: elegant scannable cards prioritising status, food summary, date,
payment and View Order. Natural empty-state copy. No em dashes in
customer-facing copy.

Test at 320, 360, 375, 390, 430, 768, 1024 and 1440 px plus landscape. Inspect:
checkout email entry, send OTP, OTP verification, incorrect OTP, expired OTP,
verification success, payment selection, confirmation, My Orders, individual
tracking, email recovery, Forget This Device, empty orders, mobile tracking
navigation. No overlap, clipping, unreadable text, hidden actions, horizontal
overflow, tiny targets, broken focus, navigation regressions or excessive layout
shift. Respect reduced motion.

## 18. Automated testing

Extend Vitest and Playwright without weakening or removing existing tests.

**A. Checkout OTP:** valid request; invalid email rejected; secure randomness;
ten-minute expiry; incorrect rejected; correct accepted once; replay fails;
expired fails; excessive attempts blocked; resend invalidates the old code;
cooldown works; email change invalidates; verification survives checkout
navigation; unverified order creation fails; direct calls fail; Cash on Arrival
and Stripe both require verification; stale verification is rejected.

**B. Persistent sessions:** cookie creation; HttpOnly/SameSite; Secure in
production; hashing; expiry; revocation; Forget This Device; rotation after
verification; invalid and revoked cookies rejected; no raw secret exposure;
multiple orders per email; no cross-email access.

**C. Recovery:** email-only; no reference; correct code restores; incorrect and
expired fail; unknown email neutral; only matching orders; multiple orders; empty
history; other emails private; rate limiting; missing Resend handled safely.

**D. Shared device:** A verifies and sees orders; B verifies a different email
on the same browser; B sees only B's orders; A's data is inaccessible through B's
session and Back navigation; Forget This Device removes access.

**E. Regression:** cart, price-change acknowledgment, Cash on Arrival, order
idempotency, Stripe initialisation rules, Stripe webhooks, admin updates,
notification outbox, search, product management, admin authentication.

**Playwright scenarios:** A first-time checkout with a controlled test email
adapter; B browser closed and reopened using a persisted cookie store (not a
component remount); C different device; D multiple orders; E email change;
F shared device; G order progress through admin transitions; H payment
regression with controlled fixtures (never claimed as genuine Stripe); I
security (unverified, forged/replayed/expired OTP, invalid/revoked session,
cross-email, rate limit, unauthorised tracking, public cache exposure, CSRF);
J mobile usability with screenshots and interaction.

## 19. External service verification

If real Resend credentials and an authorised recipient exist, send a genuine
OTP, confirm arrival, verify it, confirm session creation and test order access.
Never email real customers. If unavailable, use the deterministic email test
adapter and distinguish mocked tests, provider API tests, actual delivery,
browser session tests and MongoDB integration tests. Do not claim delivery
without evidence. Keep live intake gated until mandatory verification works with
a configured provider.

## 20. Milestones

- **7B-A**: inspect architecture; write this specification and the progress log;
  identify routes, data model decisions and legacy migration risks.
- **7B-B**: OTP challenges, branded template, send/resend/verify actions, rate
  limits, server-side enforcement, security tests.
- **7B-C**: guest session model and HttpOnly cookie, rotation, expiry, revocation,
  Forget This Device, identity switching, legacy coexistence.
- **7B-D**: My Orders, email-only recovery, authorised list, navigation,
  confirmation and email link updates.
- **7B-E**: integration and regression for Cash on Arrival, Stripe, lifecycle,
  notifications, multiple orders, shared devices; mobile fixes.
- **7B-F**: all gates, screenshot inspection, documentation, blockers, commits,
  final report, stop.

Maintain `docs/PHASE7B_PROGRESS.md` throughout.

## 21. Required verification

Run and report exact results:

```
npx next typegen
npm run typecheck
npm run lint
npm run test
npm run build
npm run test:e2e
npm run screenshots
```

Do not hide errors, remove old tests, or substitute component tests for real
browser verification. Verify browser-close-and-reopen and the real OTP entry flow
through a controlled test provider. Inspect representative screenshots.

## 22. Documentation

Create `docs/PHASE7B_SPEC.md`, `docs/PHASE7B_PROGRESS.md`,
`docs/GUEST_EMAIL_VERIFICATION.md`, `docs/GUEST_SESSION_SECURITY.md`,
`docs/MY_ORDERS_EXPERIENCE.md`, `docs/PHASE7B_REPORT.md`.

Update `docs/PROJECT_SPEC.md`, `docs/PHASE_PROGRESS.md`,
`docs/ORDER_TRACKING.md`, `docs/EMAIL_NOTIFICATIONS.md`,
`docs/MANUAL_TESTING.md`, `docs/DATABASE_SCHEMA.md`,
`docs/BUSINESS_CONFIGURATION.md`, `README.md`, `.env.example`.

Document Resend OTP configuration and testing, session expiry, revocation,
shared-device behaviour and tracking recovery. No real credentials.

## 23. Strict exclusions

No customer registration, password accounts, social login, SMS verification,
paid auth services, new payment gateways, new databases, loyalty, discounts,
marketing newsletters, driver GPS, deployment, live Stripe, automatic refunds,
unrelated admin features, storefront redesign or unnecessary premium
dependencies.

## 24. Acceptance criteria

1. Checkout email mandatory.
2. Real server-side OTP system.
3. Cryptographically generated OTPs.
4. OTPs expire.
5. OTPs are single use.
6. Attempts and resends limited.
7. Changing email requires new verification.
8. Unverified customers cannot create orders.
9. Direct API calls cannot bypass verification.
10. Both payment methods require verification.
11. Guest sessions persist after browser closure.
12. Session tokens protected.
13. Remembered access expires and can be revoked.
14. Forget This Device works.
15. My Orders shows authorised history.
16. No order reference needed for recovery.
17. Email-only recovery works.
18. Email identities isolated.
19. Shared-device behaviour secure.
20. Tracking navigation discoverable.
21. Confirmation links to tracking.
22. Emails link to tracking without leaking secrets.
23. Status timelines accurate.
24. Stripe payment-state integrity intact.
25. Cash on Arrival functional.
26. Notification outbox intact.
27. Mobile checkout and tracking polished.
28. Phases 1 to 7 tests still pass.
29. New security and browser tests pass.
30. Real email delivery reported honestly.
31. Documentation complete.
32. Production ordering gated until email delivery and launch requirements are
    verified.

No completion claim without evidence.

## 25. Final report and Git

`docs/PHASE7B_REPORT.md` sections A to U: implementation summary; architecture
review; email OTP; checkout enforcement; persistent sessions; session security
and revocation; email-only recovery; My Orders; navigation and confirmation;
legacy migration; shared-device security; Resend integration; Stripe and Cash on
Arrival regression; database changes; responsive verification; automated test
results; real provider verification; remaining limitations; manual testing
instructions; Git status; Phase 8 readiness. Include exact commands and results.

Preserve all existing commits; commit milestones meaningfully; no secrets; no
reuse of exposed credentials; no unsafe auth workarounds. If Git authentication
is unavailable, leave commits local and report the blocker. **Stop after Phase
7B.**
