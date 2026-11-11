# CLIVS: Phase 7B Report

Verified guest checkout, persistent guest sessions, email-only order recovery,
My Orders and complete tracking navigation.

Date: 3 November 2026
Scope: Phase 7B only. No deployment, no live payment, no Phase 8.

---

## A. Implementation summary

Phase 7B closes the largest gap in the guest journey. Before it, a customer who
closed the tab lost their order unless they had saved the reference and the tab
still held its capability. After it, an order is tied to a proven email address,
and that address is enough to find every order on any device.

What was built:

1. **Mandatory email verification at checkout.** A six-digit code proves the
   address before an order can exist. Both payment methods require it.
2. **A persistent remembered device.** A 256-bit opaque token in an HttpOnly
   cookie, stored server-side only as a sha256, valid for 30 days.
3. **Email-only recovery.** "Find my orders" asks for an address and nothing
   else, and answers generically until the code is verified.
4. **`/my-orders`.** Every order for the verified address, grouped, paginated and
   linking to the existing tracking view.
5. **Tracking navigation everywhere.** Header, mobile menu, footer, confirmation
   page and order email, with one primary label.
6. **A confirmation page that survives a restart**, because the server can fall
   back to the remembered device when the tab's capability is gone.

What did not change: the Phase 5 capability model, the Phase 6 payment model, the
Phase 7 tracking page, the notification outbox, and every existing test.

---

## B. Architecture review

### Identity

One collection answers "who is this browser": `guest_sessions`. It holds one
verified email, when it was proved, when it expires, and whether it was revoked.
Orders are never copied into it; they are found by `customer.email`.

One collection answers "did they prove it": `tracking_challenges`, generalised
into the single code store for checkout, recovery, order email change and
tracking. It keeps its Phase 7 name so live TTL rows were not migrated.

### Three kinds of proof, three scopes

| Proof | Where it lives | Scope |
| --- | --- | --- |
| Confirmation capability | `sessionStorage` (Phase 5) | One order, this tab |
| Scoped grant | `sessionStorage` (Phase 7) | One order, 24 hours |
| Remembered device | HttpOnly cookie (Phase 7B) | Every order for one email, 30 days |

The scopes never widen: a capability cannot list orders, and a session cannot
grant admin access.

### Why the gate lives in `createOrder`

`placeOrderAction` resolves the session, but `createOrder` is what enforces it,
through an explicit `verifiedGuest` argument. That means a future caller cannot
quietly bypass the check, and a unit test can prove the refusal without a
browser. The check runs before idempotency, so an unverified replay of a real
submission returns `verification_required` rather than a cached success.

### Why the tracking page now always asks the server

The Phase 7 client short-circuited when the browser held no capability or grant:
it rendered the private-access notice without a request. That was correct when
local storage was the only proof. With a remembered device, the browser cannot
know whether it has access, because the proof is an HttpOnly cookie. The page now
performs one read and lets the server decide. A browser with no proof is answered
`no_access`, which keeps the old copy; `not_found` is reserved for a capability
that was actually presented and was wrong.

---

## C. Email OTP

| Property | Implementation |
| --- | --- |
| Generation | `crypto.randomInt(0, 1_000_000)`, zero-padded to six digits |
| Entropy source | Platform CSPRNG; `Math.random()` is absent from the path |
| Digest | HMAC-SHA-256 over `challengeId:email:purpose:code`, keyed by `GUEST_OTP_SECRET` |
| Secret minimum | 32 characters; shorter is treated as unconfigured |
| Comparison | `timingSafeEqual` over equal-length hex buffers |
| Lifetime | 10 minutes, TTL index plus an application check |
| Attempts | 5 per challenge, then the challenge is dead |
| Reuse | Blocked by an atomic `findOneAndUpdate` that requires `consumedAt: null` |
| Resend | Supersedes every active challenge for the same context |
| Cooldown | 60 seconds, configurable, enforced on `lastSentAt` |
| Delivery failure | The challenge is deleted, so an unreceived code cannot stay valid |
| Legacy | Phase 7 unsalted-sha256 tracking rows remain verifiable, tracking path only |

A code is bound to one address, one purpose and one challenge. Copying a digest
from another row cannot satisfy a verification.

---

## D. Checkout enforcement

The customer journey:

1. Fill in details, including a mandatory email address.
2. The verification panel sends a code to that exact address.
3. The code is verified; the server rotates the remembered device to it.
4. Place the order. The server re-checks the session, the address and the
   freshness window.

Enforcement rules:

| Rule | Failure result |
| --- | --- |
| A verified identity must be present | `verification_required` |
| Its email must equal the submitted customer email | `verification_required` |
| `verifiedAt` must be within 30 minutes (configurable) | `verification_required` |
| Readiness must be true | `verification_unavailable` |

Both payment methods share the path. Editing the address after verification
revokes the local proof, so the new address needs its own code; editing back to
the old address still needs a new code.

When verification is unavailable, checkout says so and refuses to place the
order. It never falls back to an unverified order.

---

## E. Persistent sessions

| Property | Value |
| --- | --- |
| Token | 32 random bytes, base64url, 43 characters, 256 bits |
| Stored | `sha256(token)` only |
| Cookie | `pearl_guest`, `HttpOnly`, `SameSite=Lax`, `Path=/`, host-only, `Secure` in production |
| Lifetime | 30 days, absolute, never extended by a read |
| Rotation | On every successful verification, previous row revoked first |
| Revocation | Forget This Device, rotation, expiry, owner action |
| Writes | Server Actions only; a render can read but never mint |

The token never appears in `localStorage`, `sessionStorage`, a URL, an RSC
payload, a log line or the database.

---

## F. Session security and revocation

Every read walks the same rejecting path: token shape, digest lookup,
`revokedAt: null`, `expiresAt > now`, non-empty email. Any failure returns
`null`, and the caller behaves exactly as it would for a first-time visitor.

Forget This Device revokes the row **before** clearing the cookie, so a copied
token dies even if the cookie lingers. Back and Forward cannot resurrect the
previous identity's history because the server no longer recognises the token.

Guest and admin cookies are separate names with separate meanings. Neither grants
the other's access; this is asserted in the browser suite (J8).

---

## G. Email-only recovery

`/my-orders` and `/track` both offer "Find my orders": one field, no reference,
no account.

| Step | Behaviour |
| --- | --- |
| Request | Always the same generic answer, whether or not the address has orders |
| Rate limited | Still the same generic answer |
| Provider refused | Still the same generic answer |
| Verify | The server rotates the remembered device to the proved address |
| Result | The list is derived from that address, never from a client field |

Before verification the response cannot be used to learn whether an address has
orders. After verification, the history is the server's own query.

Lost email access is handled by a documented owner-assisted process, stated
under the form. A phone number or reference alone never opens an order.

---

## H. My Orders

`/my-orders` is rendered per request (`await connection()`, `instant = false`) and
passes the initial session to the client, so a returning customer does not see a
flash of the recovery form.

| Element | Detail |
| --- | --- |
| Verified email card | Masked address, 30-day reminder, Forget this device |
| Groups | In progress, Completed, Cancelled, with counts |
| Card | Reference, date, item summary, fulfilment, payment method and status, total, View Order |
| Paging | 10 per page, server-side |
| Empty | Honest empty state with Browse the menu |
| Signed out | Find my orders, or an honest unavailable notice |

Individual orders reuse the Phase 7 tracking page. Nothing is duplicated, so a
status change is visible in one implementation.

---

## I. Navigation and confirmation

| Surface | Label | Destination |
| --- | --- | --- |
| Desktop header | My Orders | `/my-orders` |
| Mobile menu | My Orders | `/my-orders` |
| Footer | My Orders | `/my-orders` |
| Footer | Track an order | `/track` |
| Confirmation | Track Order | this order |
| Confirmation | View My Orders | history |
| Order email | Track My Order | `/my-orders` |
| Order card | View Order | this order |

The confirmation page shows the reference prominently, states the payment truth
(cash is not paid), offers both actions, and explains how updates arrive.
`accessKey` is optional: when the tab's capability is gone, the server falls back
to the remembered device, so the confirmation survives closing and reopening the
browser.

Emails link to the public entry point only. No email contains a credential.

---

## J. Legacy migration

| Legacy artefact | Treatment |
| --- | --- |
| Phase 5 confirmation capability | Still opens its own order and its own confirmation |
| Phase 7 scoped grant | Still opens its own order for 24 hours |
| Phase 7 tracking challenge (unsalted sha256) | Still verifiable, tracking path only |
| Legacy challenge with no email | Refused: a capability alone is not an identity |
| A capability alone | Never grants email-wide history |

No migration was needed: the new fields are additive, and old rows are read
through a narrower path than new ones.

---

## K. Shared-device security

A session has exactly one verified email. Verifying a different address on the
same browser revokes the previous token, writes a new one and replaces the
identity. The previous person's orders disappear from view and from Back and
Forward, because the server no longer accepts the old token.

Orders are never merged across addresses. The browser suite proves this with two
customers and one shared device (J5), including the case where the second
customer already has real order history elsewhere.

---

## L. Resend integration

Codes are sent through the existing notification abstraction.

| Property | Value |
| --- | --- |
| Delivery | Awaited inline, bounded, not queued |
| Success | Only when the provider accepted the message |
| Failure | Challenge deleted, checkout fails closed |
| Template | Branded, six-digit code, 10-minute expiry, reason for the code, no links, no tokens |
| Tests | `file-sink` provider writes to a git-ignored JSONL file |
| Real inboxes | Never touched in any test |

Readiness requires a configured provider **and** a strong `GUEST_OTP_SECRET`.
`RESEND_API_KEY` alone is not proof of deliverability.

---

## M. Stripe and Cash on Arrival regression

| Behaviour | Status |
| --- | --- |
| Cash on Arrival places an order after verification | Verified in E2E |
| Cash stays "Unpaid" until collection is recorded | Verified in E2E (J7) and unit tests |
| Online payment stays unavailable without Stripe test configuration | Verified in E2E |
| The verification gate runs before payment readiness | Unit-tested |
| Stripe webhooks remain session-independent | Unchanged from Phase 6 |
| Phase 6 payment tests | All still green |

Genuine Stripe test-mode payment remains unverified, exactly as reported at the
end of Phase 6. No live payment was attempted.

---

## N. Database changes

| Collection | Change | Indexes |
| --- | --- | --- |
| `guest_sessions` | New | `tokenHash` unique, `expiresAt` TTL, `email` + `revokedAt` + `createdAt` |
| `tracking_challenges` | Added `challengeId`, `purpose`, `digestVersion`; `reference` now nullable | Existing TTL and lookup indexes retained |
| `orders` | Added `guest.verifiedEmail`, `guest.verifiedAt` | `{ "customer.email": 1, createdAt: -1 }` |

`scripts/seed.ts` and both E2E harnesses create the indexes explicitly, because
`autoIndex` is off. No existing document was migrated or dropped.

---

## O. Responsive verification

`npm run screenshots` captured 245 images across the reference widths and
reported **zero horizontal overflow**.

New surfaces reviewed at 320, 360, 375, 390, 430, 667 (landscape), 768, 1024 and
1440 px:

| Surface | Result |
| --- | --- |
| My Orders, signed in with an order | Cards stack cleanly; actions wrap at 320 px |
| My Orders, signed out | Recovery form fits; unavailable notice reads honestly |
| Track your order | Timeline and payment panels fit; no clipped totals |
| Confirmation | Reference, payment copy and both actions fit at 320 px |
| Checkout verification panel | Fits at 390 px and 1440 px; code field is thumb-sized |

Two visual defects were found by inspection and fixed:

1. The checkout verification panel said "Check your inbox" before any code had
   been sent. The copy now describes what will happen.
2. Full-page captures painted the sticky header mid-page because the page was
   still scrolled to the payment panel. Captures now reset scroll first.

---

## P. Automated test results

Run from the repository root on the final tree.

| Command | Result |
| --- | --- |
| `npx next typegen` | Pass |
| `npm run typecheck` | Pass, no errors |
| `npm run lint` | Pass, zero errors and zero warnings |
| `npm run test` | **878 passed / 878**, 63 files |
| `npm run build` | Pass, 25 routes |
| `npm run test:e2e` | **106 passed / 106**, five projects |
| `npm run screenshots` | Pass, 245 images, zero horizontal overflow |

Vitest growth: 795 tests after 7B-D, 878 after 7B-E (83 new).

New suites:

| Suite | Tests | Focus |
| --- | --- | --- |
| `src/lib/guest/otp.test.ts` | 21 | Generation, keyed digest, legacy digest, constant-time compare, policy bounds |
| `src/lib/guest/session.test.ts` | 15 | sha256-only storage, cookie attributes, expiry, revocation, rotation |
| `src/lib/guest/challenges.test.ts` | 19 | Issue/verify, cooldown, supersede, provider failure, attempt cap, legacy rows |
| `src/lib/actions/guest-verification.test.ts` | 23 | Generic recovery, rate limits, session-derived history, pagination, Forget This Device |
| `src/lib/orders/create.test.ts` | 39 (5 new) | The verification gate: no identity, mismatch, stale proof, canonical address |

Browser coverage added in the orders project (10 scenarios):

| Scenario | Proves |
| --- | --- |
| J1 | Confirmation survives a browser restart; cookie is HttpOnly and never in web storage or a URL |
| J2 | Another device sees nothing until the email is verified, then opens the order |
| J3 | Every order for one verified address appears in My Orders |
| J4 | Changing the address needs a new code and hides the previous identity |
| J5 | Shared device switches identity without merging histories, including Back/Forward |
| J6 | Admin status changes reach My Orders and tracking |
| J7 | Cash on Arrival is unpaid everywhere |
| J8 | Guest cookie grants no admin access, admin cookie grants no history, and a captured submission replayed without a device is refused |
| J9 | The whole journey works at 390 px with no horizontal overflow |
| J10 | Recovery for an address with no orders reaches an honest empty state |

Existing suites were updated, never weakened:

- Every order placement now completes a real code read from the file sink.
- The tracking suite's enumeration test now starts from the email-only entry
  point and then exercises the reference form.
- Confirmation-notice copy assertions were updated to the Phase 7B wording.

---

## Q. Real provider verification

**No real email has been sent.** The environment has no `RESEND_API_KEY`, no
verified sending domain, no `EMAIL_FROM`, no `OWNER_NOTIFICATION_EMAIL` and no
`GUEST_OTP_SECRET`.

That is not hidden by the implementation: without them, checkout reports
verification unavailable and refuses to place an order. This is the correct
behaviour, and it is why the intake gate stays closed until the owner configures
real delivery and approves a test message.

What remains to be done by the owner:

1. Create a Resend account and verify the sending domain.
2. Set `RESEND_API_KEY`, `EMAIL_FROM` and `OWNER_NOTIFICATION_EMAIL`.
3. Generate `GUEST_OTP_SECRET` with at least 32 random characters.
4. Send one real test code to an address the owner controls.
5. Confirm the branded template renders, the code arrives, and the ten-minute
   expiry is stated.

---

## R. Remaining limitations

| Limitation | Impact | Owner action |
| --- | --- | --- |
| No real Resend configuration | Checkout cannot accept orders | Configure provider and secret |
| Genuine Stripe test-mode payment unverified | Online payment stays disabled | Provide a test-mode key |
| Exposed GitHub PAT | Credential must be considered burned | Rotate it |
| `CLOUDINARY_CLOUD_NAME` mismatch | Preview images use the honest placeholder | Confirm the cloud name |
| No scheduler | Queued notifications need the guarded processor | Run it on a schedule |
| Owner-assisted email change is documented, not automated | Corrections are manual | Accept for Phase 1 |
| No customer-initiated cancellation | Support load falls on the owner | Out of scope |

None of these is a Phase 7B regression.

---

## S. Manual testing instructions

Prerequisites: a MongoDB URI, a working email provider, and a
`GUEST_OTP_SECRET` of at least 32 characters. Without them, checkout correctly
refuses to place an order.

1. **Happy path.** Add an item, go to checkout, fill in details, send a code,
   enter it, place a Cash on Arrival order. Confirm the reference is prominent
   and the payment line says unpaid.
2. **Browser restart.** Close the browser entirely, reopen it, and visit the
   confirmation URL. The order should still open.
3. **Another device.** Open the confirmation URL on a phone. It should say the
   order is not open on this device. Use Find my orders with the same email,
   enter the code, and confirm every order appears.
4. **Multiple orders.** Place two orders with the same address and confirm both
   appear, grouped correctly.
5. **Email change.** Start a new checkout, change the address, and confirm a new
   code is required and the previous history disappears after verifying.
6. **Shared device.** Use Forget this device, then verify a second address.
   Confirm the first address's orders are gone, including via Back.
7. **Progress.** In admin, advance the order. Refresh My Orders and tracking and
   confirm the status matches.
8. **Payment honesty.** Confirm cash orders read unpaid in confirmation, My
   Orders and tracking.
9. **Security.** Sign in to admin, then open My Orders in the same browser: the
   admin session must not list guest orders, and a guest cookie must not open
   admin.
10. **Unavailable verification.** Remove `GUEST_OTP_SECRET` and confirm checkout
    says verification is unavailable and refuses to place an order.

The full checklist with expected copy lives in `docs/MANUAL_TESTING.md`.

---

## T. Git status

Commits created for Phase 7B:

| Milestone | Commit | Summary |
| --- | --- | --- |
| 7B-A | `9c1af5f` | Persist the verification and persistent-access specification |
| 7B-B | `0e6822a` | Require a verified email before any guest order |
| 7B-C | `0080c2d` | Create the remembered-device indexes |
| 7B-D | `a0dce68` | Add email-only recovery, My Orders and tracking navigation |
| 7B-E | `c034b84` | Prove the guest journey end to end |
| 7B-F | `cf73319` | Document Phase 7B and record the verification results |

**The push succeeded.** All six Phase 7B commits were pushed to
`origin/main` (`25dfedc..cf73319`), so the work is no longer local-only. Nothing
was force-pushed, rewritten or discarded. A small follow-up commit records this
outcome; the milestone commits above are unchanged.

No secret is committed. The E2E OTP secret is synthetic and confined to the
repository's test fixtures, and it protects nothing outside disposable in-memory
databases.

---

## U. Phase 8 readiness

Phase 7B is complete and verified to the limits of this environment.

Ready now:

- Guest checkout with a proven email identity.
- A remembered device that survives a restart, with honest revocation.
- Email-only recovery with no enumeration.
- My Orders, tracking and confirmation wired together with consistent labels.
- A security posture that fails closed when configuration is missing.

Required before real customers can order:

1. Real Resend credentials, a verified sending domain, and one successful test
   message.
2. A strong `GUEST_OTP_SECRET` in the deployment environment.
3. Owner approval of the intake gate.
4. Genuine Stripe test-mode verification if online payment is to be offered.
5. A scheduler for queued notifications.

Deliberately not started: customer accounts, passwords, social login, SMS
verification, loyalty, discounts, marketing, GPS tracking, deployment, live
payments and unrelated admin features.

**Phase 7B stops here.** No Phase 8 work has begun.
