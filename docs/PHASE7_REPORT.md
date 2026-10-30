# PEARL Signature — Phase 7 Final Report

Transactional email and secure guest order tracking.

| Item | Value |
| --- | --- |
| Phase | 7 (7A–7F) |
| Branch | `main` |
| Base commit | `e5fbc49` (Phase 7A specification) |
| Status | Implemented; awaiting owner review |
| Real email sent | **No** |
| Deployment | Not performed (prohibited in this phase) |
| Live payments | Not enabled (prohibited) |

---

## A. Implementation summary

Phase 7 turns the Phase 5 notification outbox into a working, observable,
privacy-conscious email pipeline and adds a private guest tracking page with
cross-device email recovery.

What changed in practice:

1. **Email exists now.** A provider contract, a Resend adapter and eleven
   branded templates produce real messages with plain-text alternatives. Nothing
   is sent until an operator configures a provider, and no surface claims a
   message was delivered when it was only accepted.
2. **Delivery became reliable.** Entries are claimed atomically under leases,
   retried with bounded backoff, parked as `uncertain` when the provider's
   answer is unknowable, and drained by a guarded endpoint or a CLI.
3. **Operators can see the queue.** `/admin/notifications` reports readiness
   without secrets, counts every state, lists recent acceptances and offers a
   safe retry for failed or uncertain entries.
4. **Guests can track an order.** `/track` opens on the device that placed the
   order, or on another device after verifying the order's email address with a
   single-use code. A reference alone still opens nothing.
5. **Nothing regressed.** All Phase 1–6 behaviour, tests and routes are intact.

Scope discipline: no accounts, SMS, WhatsApp, marketing, loyalty, discounts, new
payment gateways, live Stripe, automatic refunds, GPS tracking, new databases,
paid queues, deployment or storefront redesign.

---

## B. Architecture

```
                         ┌───────────────────────────────┐
order / payment / admin ─┤ business write (commits first)│
                         └───────────────┬───────────────┘
                                         │
                          notifyOrderEvent(event, ref)
                                         │
                    ┌────────────────────┴────────────────────┐
                    │ upsert outbox entry (idempotent key)    │  ← awaited
                    │ kickProcessing()                        │  ← detached
                    └────────────────────┬────────────────────┘
                                         ▼
                            attemptDueNotifications()
                     recover leases → claim → render → send → settle
                                         │
             ┌───────────────────────────┼───────────────────────────┐
             ▼                           ▼                           ▼
   POST /api/notifications/process   npm run notifications:process   admin retry
        (bearer secret)                     (CLI)                  (entry id only)
```

| Layer | Module |
| --- | --- |
| Configuration | `src/lib/notifications/config.ts` |
| Contract | `src/lib/notifications/contract.ts` |
| Registry | `src/lib/notifications/provider.ts` |
| Adapters | `providers/resend.ts`, `providers/file-sink.ts` |
| Rendering | `email/{theme,layout,components,order-email,verification-email}.ts` |
| Events / keys | `events.ts`, `facts.ts`, `templates.ts` |
| Processing | `dispatch.ts` |
| Observability | `observability.ts` |
| Auth | `auth.ts` (constant-time bearer comparison) |
| Tracking | `src/lib/actions/tracking.ts`, `src/lib/orders/tracking.ts`, `src/lib/orders/view.ts` |

Design rules held throughout:

- Business code never imports a transport.
- The outbox stores no personal data; recipients resolve at dispatch time.
- A queue problem can never fail or roll back a business write.

---

## C. Email provider

**Resend**, free tier (3,000/month, 100/day), called with plain `fetch`. No SDK,
no webhook dependency, no second provider, no SMS.

| State | Behaviour |
| --- | --- |
| `NOTIFICATION_PROVIDER` blank | Not configured: entries stay `pending`, zero attempts consumed, admin warning |
| `resend` + key + valid sender | Configured: sends can be attempted |
| `resend` without key or sender | Named but incomplete: readiness explains which value is missing |
| Any other name | Unsupported: surfaces as a permanent failure instead of silently doing nothing |

`EMAIL_FROM` is parsed strictly (`orders@domain` or
`Name <orders@domain>`). A blank or malformed sender is reported, never
replaced with a fallback address. `OWNER_NOTIFICATION_EMAIL` is optional; when
blank, store alerts resolve the active owner admin.

The adapter maps provider outcomes to explicit failure kinds
(`transient | permanent | rate_limited | ambiguous`) and reduces error bodies to
a fixed sentence before anything is stored, because a third-party error can echo
the recipient address.

A **file-sink** adapter exists for development and tests. It writes JSONL to
`NOTIFICATION_SINK_FILE` and refuses to run in production unless
`NOTIFICATION_SINK_ALLOW_PRODUCTION=1` is set by the test harness. It is what
makes the Playwright recovery test possible without a real inbox.

---

## D. Outbox processing

The Phase 5 collection was extended, not replaced.

New fields: `transition`, `providerId`, `providerStatus`, `providerStatusAt`,
`leaseToken`, `leaseExpiresAt`, `lastAttemptAt`, `ambiguousAttempts`.
New statuses: `processing`, `uncertain`. TTL moved from `createdAt` to `sentAt`
(30 days), and `scripts/seed.ts` drops the legacy `createdAt_1` index explicitly
so unresolved failures are never silently deleted.

| Behaviour | Value |
| --- | --- |
| Claim | Atomic `pending → processing` with a random lease token |
| Lease | 2 minutes; an expired lease returns the entry to `pending` and consumes one attempt |
| Batch | 10 entries per scan |
| Failure budget | 5 attempts, exponential backoff 60 s → 1 h |
| Ambiguous budget | 2 attempts with the **same** idempotency key, then `uncertain` |
| Rate limited | Deferred without consuming an attempt, honouring `retryAfterMs` |
| Quota | Deferred with `QUOTA_REASON` when the daily or monthly ceiling is reached |
| Provider 200 | `sent` + `providerStatus: accepted` — never `delivered` |
| Infrastructure fault | Claim released, `deferred += 1`, scan stops |

Idempotency is layered: the outbox key is unique, the provider key is derived
from it, and every settlement write includes the lease token so a slow processor
cannot overwrite a newer result.

The processor is reachable only through:

- `POST /api/notifications/process` — 503 with no secret, 401 with a wrong one,
  200 with counters only.
- `npm run notifications:process` — one bounded scan, pool closed on exit.
- Admin retry — entry id only, `failed`/`uncertain` only, key preserved.

There is **no scheduler in this repository**. That is stated in the admin panel
and in `docs/NOTIFICATION_PROCESSING.md` §9 rather than implied.

---

## E. Templates

Eleven templates, one layout, one plain-text builder:

| Template | Recipient |
| --- | --- |
| Order received | Customer |
| New order | Store |
| Order confirmed | Customer |
| Order preparing | Customer |
| Ready for pickup | Customer |
| Out for delivery | Customer |
| Order complete | Customer |
| Order cancelled | Customer |
| Payment received / cash collected | Customer + store |
| Payment not completed / needs review | Customer + store |
| Tracking verification code | Customer |

Brand: cream `#FDFBF7`, navy `#1A2530`, gold `#D4AF37`, centralised in
`email/theme.ts`. This is the documented exception to the no-raw-hex rule,
because email clients cannot consume CSS custom properties.

Every message:

- has a plain-text alternative built from the same facts,
- HTML-escapes dynamic values,
- uses `formatCad` for money,
- contains no em dash,
- contains no invented fee, window, phone number, address or review,
- contains no capability, grant token or processor secret.

---

## F. Customer tracking

`/track?ref=…` renders an inert shell; the order is fetched by the client only
after access is proven. The page is `noindex, nofollow` and never caches order
data.

| Element | Behaviour |
| --- | --- |
| Timeline | Delivery: received → confirmed → preparing → out for delivery → completed. Pickup: ready for pickup replaces out for delivery |
| Completed order | Every step complete, no "Now" badge |
| Cancelled order | Never a completed step, never a current step |
| Payment | Cash on Arrival is due until the owner records it; refunds only after provider confirmation |
| Fulfilment | Method, service area or pickup instructions from the stored snapshot |
| Private access | Explains why the page opened (capability or verified email) |
| Refresh | Manual button plus 30 s polling, paused when hidden, stopped at terminal states, stale responses discarded |
| No access | Honest notice plus the recovery form |

There is no order editing, no cancellation by the customer and no map.

---

## G. Tracking security

| Control | Implementation |
| --- | --- |
| Capability storage | `sessionStorage`, sha256 compared server-side |
| Reference-only access | Impossible: no lookup path exists without a capability or grant |
| Grant scope | One order reference, 24 h, TTL index, hashed token |
| Code | 6 digits, 10 min, 5 attempts, single use, hash-only storage |
| Newest challenge only | An older code is refused |
| Enumeration | Request always answers `{ ok: true }`, even for malformed input or a missing order |
| Rate limits | `tracking.request` 5/15 min, `tracking.verify` 10/15 min, `order.lookup` 30/15 min |
| Email not configured | Both actions return `unavailable`; nothing pretends to send |
| URLs | Never carry a capability or a grant |
| Caching | `no-store`, `noindex`, `nofollow` |

Failure responses are indistinguishable between "wrong capability" and "unknown
order", so probing reveals nothing.

---

## H. Admin notification management

`/admin/notifications` (owner session required):

- **Delivery readiness**: configured or not, provider name, sender, owner
  recipient, processor secret, delivery callbacks, tracking recovery, limits.
  Values are never echoed.
- **Queue state**: `pending`, `processing`, accepted, `failed`, `uncertain`.
- **Timing**: last processing attempt, last provider acceptance.
- **Send limits**: today, this month, remaining — labelled as the store's own
  ceilings, not the provider's plan.
- **Needs attention**: failed and uncertain entries with sanitised reasons and
  an entry-id-only retry.
- **Recently accepted**: provider status shown as `accepted`, with an explicit
  note that acceptance is not delivery.
- **Processing schedule**: states plainly that automatic delivery depends on a
  scheduler that is not configured.

`/admin/settings` gained the single muteable message switch
(`notifications.preparingUpdateEnabled`). Confirmations, handover, completion,
cancellation and payment messages are not muteable.

Audit: `notification.retried` with target type `notification`.

---

## I. Payment integration

Payment events were rewired onto the new pipeline without touching the payment
logic itself:

| Event | Trigger |
| --- | --- |
| `payment.confirmed` | Verified Stripe settlement |
| `payment.collected` | Owner records Cash on Arrival (new in Phase 7) |
| `payment.failed` | Verified failure or expiry |
| `payment.requires_attention` | Review required |
| `payment.refund_review` | Refund needs an operator |

Rules preserved: webhooks enqueue **durably before acknowledgement**, replaying
an event upserts the same key, and no message is ever sent for a payment that
was not verified. Phase 6's unverified Stripe test-mode status is unchanged and
still visible in `docs/PHASE6_REPORT.md` §N/§S.

---

## J. Mobile UX

- `/track` is mobile-first: single column to `lg`, then a two-column layout with
  the summary beside the timeline.
- Every control has a visible `focus-gold` ring and respects reduced motion.
- Screenshots captured at 320, 360, 375, 390, 430, 667 landscape, 768, 1024 and
  1440 with zero horizontal overflow.
- One defect found and fixed: at 320 px the order reference wrapped after its
  hyphen, so the heading is now `text-2xl` on phones and `text-3xl` from `sm`.
- The admin notification page was captured at 360, 390, 768, 1024 and 1440 and
  reflows cleanly (queue counters wrap into two columns).

---

## K. Security review

| Risk | Mitigation |
| --- | --- |
| Order enumeration | Generic responses, no reference-only lookup, rate limits |
| Code brute force | 6 digits, 5 attempts, 10-minute expiry, single use |
| Token leakage | Hash-only storage, sessionStorage, never in a URL or an email |
| Secret leakage to the browser | `server-only` on every notification module; readiness returns booleans and names, never values |
| Secret leakage in logs | Provider errors replaced with fixed sentences |
| Duplicate email | Unique outbox key, provider idempotency key, lease tokens |
| Duplicate payment email | Durable enqueue on webhook, idempotent keys |
| Processor abuse | Bearer secret, 503 when unset, counters-only body, `no-store` |
| Stored PII | Outbox and tracking collections store no email, name or address |
| Retry misuse | Entry id only; recipients and content cannot be supplied by an operator |
| Emailed capability | Tracking emails carry the reference only |

No secret, API key or PAT was added to the repository, and `.env.local` remains
git-ignored.

---

## L. Database impact

No new database and no paid tier. Three collections changed:

| Collection | Change | Index |
| --- | --- | --- |
| `notification_outbox` | New fields + `processing`/`uncertain` statuses | unique `key`; TTL on `sentAt`; legacy `createdAt_1` TTL dropped by the seed script |
| `tracking_challenges` | New | `reference` + `createdAt` lookup; TTL on `expiresAt` |
| `order_access_grants` | New | unique `tokenHash`; TTL on `expiresAt` |

`scripts/seed.ts` and `scripts/e2e-orders-server.ts` both call `createIndexes()`
explicitly (`autoIndex` is off), so a deployment cannot run without its TTL and
uniqueness guarantees.

Storage impact is small: the outbox holds only keys and counters, challenges
expire in 10 minutes, grants in 24 hours, and accepted outbox entries in 30
days. Unresolved failures deliberately never expire.

---

## M. Test results

All commands executed on this tree.

| Command | Result |
| --- | --- |
| `npx next typegen` | PASS |
| `npm run typecheck` | PASS — 0 errors |
| `npm run lint` | PASS — 0 errors, 0 warnings |
| `npm run test` | PASS — **794/794** tests across **59** files |
| `npm run build` | PASS — `/track` and `/api/notifications/process` present, all earlier routes intact |
| `npm run test:e2e` | PASS — **96/96** across five projects |
| `npm run screenshots` | PASS — zero horizontal overflow on every capture |

### Vitest matrix (spec §19 A–G)

| Matrix | Where | Notes |
| --- | --- | --- |
| A Events | `admin-orders.test.ts`, `create`/`webhooks` suites | Correct event per transition; replays and failed transitions enqueue nothing |
| B Delivery | `dispatch.test.ts`, `auth.test.ts`, `process/route.test.ts` | Claims, concurrency, provider id, retry, permanent failure, rate limit, lease recovery, missing config, ambiguous → uncertain, no duplicate sends, unauthorized rejection |
| C Templates | `email/*.test.ts` | Facts, CAD, payment accuracy, delivery vs pickup, missing data, escaping, text alternative, no promises, no em dashes, no secrets |
| D Tracking authorization | `actions/tracking.test.ts` | Valid/invalid/foreign/expired capability and grant, reference-only refusal, no enumeration, safe missing order |
| E Recovery | `actions/tracking.test.ts` | Neutral responses, expiry, wrong code, attempt cap, reuse, rate limits, scoped grant |
| F Lifecycle | `orders/tracking.test.ts` | Delivery/pickup/cancelled display, no false completion, history, payment/fulfilment separation, COA and Stripe states |
| G Regression | Whole suite | All Phase 1–6 tests still pass; none weakened |

The notification and tracking suites alone are **104 tests across 7 files**.

### Playwright matrix (spec §19 A–H)

`e2e/tracking/tracking.spec.ts`, project `tracking` on port 3004:

| Test | Proves |
| --- | --- |
| A | Same-device capability opens the order, pickup timeline, honest COA copy, `noindex` |
| B | The reference alone opens nothing and offers recovery |
| C | A wrong capability is indistinguishable from an unknown order |
| D | Cross-device recovery: request → read code from the file sink → verify → survives reload |
| E | Wrong code refused; the attempt cap stops even the correct code afterwards |
| F | A non-matching pair answers generically and emails nothing |
| G | Admin readiness leaks no secret; processor returns 401 unauthenticated and drains a due entry with the bearer secret |
| H | Manual refresh shows the current status after an admin change, never a stale one |

Polling (30 s, visibility-aware, terminal stop) is covered by the Vitest matrix
and the manual checklist. A 30-second Playwright wait would add flakiness
without proving anything the manual-refresh test does not already prove.

The tracking project runs its own disposable database and one seeded order, so
Phase 5 order counts and the shared `order.create` rate-limit budget are
untouched.

---

## N. Real provider verification

**Not executed.** No Resend account, API key, verified sending domain,
`EMAIL_FROM` or `OWNER_NOTIFICATION_EMAIL` exists for this project, and no real
email may be sent.

What is proven instead:

- The Resend adapter's request shape, headers, error mapping and acceptance
  parsing are covered by unit tests with a mocked `fetch`.
- The complete pipeline — enqueue, claim, render, send, settle, observe — is
  proven end to end against the file-sink provider, including the guarded
  processor call over real HTTP.
- No delivery webhook has ever been received, so `providerStatus` has never
  moved past `accepted` outside tests.

What remains unproven: that Resend accepts our requests, that the sender
domain passes their verification, that messages arrive, and that a real
delivery callback moves an entry to `delivered`. The report does not claim any
of these.

Phase 6's genuine Stripe test-mode verification also remains outstanding.

---

## O. Screenshots

`npm run screenshots` with the storefront on 3000, the admin harness on 3001 and
the tracking harness on 3004:

| Surface | Viewports |
| --- | --- |
| `/track` (with access) | 320, 360, 375, 390, 430, 667 landscape, 768, 1024, 1440 |
| `/track` (no access, recovery form) | 390, 1440 |
| `/admin/notifications` | 360, 390, 768, 1024, 1440 |
| All Phase 1–6 surfaces | unchanged reference set |

Result: **zero horizontal overflow**. Visual inspection confirmed:

- the timeline reads top to bottom on a phone and sits beside the summary on
  desktop,
- the "Now" badge and step connectors align at every width,
- payment and fulfilment panels use the honest copy,
- the recovery form is usable at 320 px,
- the admin readiness and queue panels reflow without clipping.

One note for operators: pointing `ADMIN_BASE_URL` at the *tracking* harness makes
the admin products table overflow by 13 px, because that harness seeds the wider
`E2E` fixture rows (price + availability badges). It is a fixture-content
artefact, not a Phase 7 regression; the documented configuration captures admin
surfaces against the admin harness.

---

## P. Operational requirements

Before email can leave the building, an operator must supply:

1. A Resend account and a verified sending domain.
2. `NOTIFICATION_PROVIDER=resend`, `RESEND_API_KEY`, `EMAIL_FROM` on the server.
3. `OWNER_NOTIFICATION_EMAIL` (optional) for store alerts.
4. `NOTIFICATION_PROCESSOR_SECRET` generated and stored outside the repository.
5. A scheduler calling `POST /api/notifications/process` or
   `npm run notifications:process` on a short interval.
6. Optionally `RESEND_WEBHOOK_SECRET` and a registered webhook URL, so
   `providerStatus` can move past `accepted`.
7. `NEXT_PUBLIC_SITE_URL`, so any link in a message is canonical.

Until all of that exists, the system behaves exactly as documented: events are
recorded, nothing is sent, and the admin says so.

Database: `npm run seed` must be run once against the target database to create
the new indexes and drop the legacy TTL index.

---

## Q. Remaining limitations

1. **No email has actually been sent.** See §N.
2. **No scheduler.** Delivery depends on an order event, an operator retry, a
   CLI run or an external scheduler.
3. **No delivery callbacks received in practice.** Acceptance is the strongest
   evidence the system can produce on its own.
4. **Polling, not push.** Tracking refreshes every 30 seconds; there is no
   websocket or paid realtime service.
5. **Phase 6 Stripe remains unverified in test mode.**
6. **`CLOUDINARY_CLOUD_NAME` still does not match the preview cloud name**
   (owner decision, unrelated to Phase 7).
7. **Push to origin is blocked**: no Git credentials are configured, so the
   Phase 7 commits stay local.
8. Tracking recovery is unavailable whenever email is not configured, by design.

---

## R. Git status

| Item | State |
| --- | --- |
| Base | `e5fbc49` Phase 7A |
| Phase 7 work | Committed in meaningful milestones on `main` |
| Push | **Blocked** — no credentials; commits remain local |
| Secrets committed | None. `.env.local`, `.next/`, `screenshots/`, `test-results/` stay ignored |
| PAT | The previously exposed token must be rotated by the owner; it is not in this tree |

The owner must still resolve the `CLOUDINARY_CLOUD_NAME` mismatch and rotate the
previously exposed token before any push.

---

## S. Next-phase readiness

Phase 7 is complete and stops here. Not started, and not implied:

- deployment, hosting or a domain purchase,
- live Stripe activation, refunds or disputes,
- customer accounts or saved addresses,
- SMS, WhatsApp or marketing email,
- inventory management or delivery integrations,
- any storefront redesign.

Recommended owner decisions before the next phase:

1. Supply the Resend account, verified domain and sender identity (§P).
2. Decide the scheduler (platform cron or equivalent) and where the processor
   secret lives.
3. Complete the genuine Stripe test-mode pass carried over from Phase 6.
4. Rotate the exposed Git token and restore push access.
5. Review `docs/PHASE7_REPORT.md` §Q and accept the documented limitations.

No further phase may begin without explicit owner approval.

---

## Manual testing guide

A business-readable walkthrough lives in `docs/MANUAL_TESTING.md` §8 and §9.
In short:

1. Place a Cash on Arrival order and open **Track this order**.
2. Confirm the timeline matches the status and the payment copy never claims
   payment before it is recorded.
3. Open the same link in a private window: the order must not appear, and the
   recovery form must be offered.
4. Request a code, verify it, reload: the order must stay open on that device.
5. Enter a wrong code five times: the correct code must then be refused.
6. Change the status in the admin, press **Refresh**: the new status must appear
   and never revert.
7. Cancel an order and confirm the tracking page never shows it as completed.
8. Open `/admin/notifications`: readiness must never show a secret, and the
   queue must be honest about pending, accepted, failed and uncertain entries.
