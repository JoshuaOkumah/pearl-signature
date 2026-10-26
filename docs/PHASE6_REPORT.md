# PEARL Signature — Phase 6 Report

Secure Stripe Checkout, payment reconciliation and financial integrity.

Status: **implemented in Stripe test mode only.** Online payment is gated off by
default, no live charge path exists, nothing is deployed, and no genuine Stripe
test-mode payment was executed in this environment (see §N). Requirements
snapshot: `docs/PHASE6_SPEC.md`. Milestones and gate log:
`docs/PHASE6_PROGRESS.md`. Behavioural documents:
`docs/STRIPE_INTEGRATION.md`, `docs/PAYMENT_LIFECYCLE.md`,
`docs/PAYMENT_RECONCILIATION.md`.

---

## A. Summary

Phase 6 adds online payment for an order that already exists. The customer is
sent to Stripe's hosted Checkout page; this site never renders a card field,
never receives card data and never stores a payment method. An order becomes
`paid` only from a signature-verified Stripe event or from an audited,
operator-triggered reconciliation of a verified provider record. A browser
redirect is never treated as proof of payment.

What shipped:

1. **Hosted Checkout initialization** for an accepted Phase 5 order, using the
   immutable order snapshot total in integer CAD cents as the single line item.
2. **Durable attempt reservation** before every provider call, with a stable
   idempotency key, one active attempt per order, and recovery rules for
   timeouts, provider success plus local write failure, expiry and retry.
3. **A signature-verified webhook endpoint** with a durable event ledger keyed
   by Stripe event id, so replays cannot double count.
4. **A monotonic payment lifecycle** where duplicate and out-of-order events
   cannot corrupt a settled order, and a late payment after cancellation is
   retained and flagged rather than resurrecting the order.
5. **Refund foundations only**: verified provider refund records, partial and
   full refund totals, and no refund initiation of any kind.
6. **Customer surfaces**: a two-option payment choice with an honest
   unavailable state, and confirmation states for pending, paid, failed,
   expired, refunded and review required.
7. **Owner surfaces**: per-order payment detail, attempt history, provider
   refunds, a dry-run-first reconciliation control, an online-payment switch
   with a readiness panel, and a dashboard that separates online settlement,
   cash collection, outstanding, pending, failed, refunds, gross and net.
8. **Notifications** reusing the Phase 5 outbox with idempotent payment event
   keys, honestly pending because no provider is configured.

What did not ship, deliberately: live payments, deployment, any refund or
dispute workflow, accounts, subscriptions, discounts, gift cards, Stripe Tax,
delivery integrations, paid queues or database upgrades. No price, fee, tax
rate, delivery area, contact detail or review was invented.

Regression posture: Phase 5 Cash on Arrival, order creation, lifecycle,
notifications and reporting all still pass, and the Cash on Arrival recording
action now refuses Stripe orders instead of silently double counting them.

---

## B. Architecture

### B1. Where the code lives

| Concern | File |
| --- | --- |
| Readiness gate, lazy SDK client, canonical origin | `src/lib/payments/stripe.ts` |
| Session creation, attempt reservation, retry, recovery | `src/lib/payments/service.ts` |
| Verified event processing, refunds, reconciliation adapters | `src/lib/payments/webhooks.ts` |
| Webhook route handler | `src/app/api/stripe/webhook/route.ts` |
| Monotonic state helpers | `src/lib/payments/state.ts` |
| Reconciliation comparison and apply | `src/lib/payments/reconcile.ts` |
| Public Server Actions (place order, start payment, load confirmation) | `src/lib/actions/orders.ts` |
| Admin reconciliation Server Action | `src/lib/actions/payments.ts` |
| Attempt, event, refund documents | `src/models/payment-attempt.ts`, `src/models/stripe-event.ts`, `src/models/payment-refund.ts` |
| Enums, labels, request schemas | `src/lib/validations/order.ts` |
| Checkout payment choice | `src/components/checkout/checkout-client.tsx` |
| Confirmation payment states and retry | `src/components/checkout/order-confirmation.tsx` |
| Admin payment detail, attempts, refunds | `src/app/admin/(dashboard)/orders/[id]/page.tsx` |
| Reconciliation control | `src/components/admin/payment-reconciliation.tsx` |
| Financial dashboard split | `src/lib/repositories/admin.ts`, `src/app/admin/(dashboard)/page.tsx` |
| Owner switch and readiness panel | `src/app/admin/(dashboard)/settings/page.tsx`, `src/components/admin/store-settings-form.tsx` |
| Payment notification events and durable enqueue | `src/lib/notifications/templates.ts`, `src/lib/notifications/dispatch.ts` |

### B2. Payment initiation flow

```
checkout (browser)
  └─ placeOrderAction            → Phase 5 createOrder (unchanged authority)
       └─ order stored with payment.method = "stripe", status "unpaid"
  └─ startStripeCheckoutAction   → rate limit "payment.create"
       ├─ Zod allowlist: { reference, accessKey } only
       ├─ loadOrderConfirmationAction-style capability check (sha256)
       ├─ stripeReadiness() + store_configs.payments.onlineEnabled
       ├─ priceCheckout() re-read; must equal the frozen total
       ├─ insert payment_attempts (key `pearl_<48 hex>`, sequence, active)
       ├─ order → awaiting_payment (version-guarded)
       └─ Stripe Checkout Session create (idempotency key)
            └─ redirect to https://checkout.stripe.com/...
```

### B3. Settlement flow

```
Stripe
  └─ POST /api/stripe/webhook (raw bytes + stripe-signature)
       ├─ readiness gate (503 if not configured)
       ├─ constructEvent(raw, signature, whsec)  → 400 on any failure
       ├─ stripe_events insert (unique eventId)   ← before financial state
       ├─ association/amount/currency/livemode checks
       ├─ payment_attempts transition + orders.payment transition (monotonic)
       ├─ refunds upsert (refund events only)
       └─ notifyOrderEventDurably(...)  (idempotent outbox row committed)
    200 acknowledged / 500 so Stripe retries
```

### B4. Design decisions worth recording

| Decision | Why |
| --- | --- |
| One Checkout line item for the whole accepted total | The order total already contains the owner's configured fee and tax. Sending per-item lines would make Stripe re-derive tax and risk a different charge. Stripe Tax is not used. |
| Attempt row persisted before the provider call | Without it, a timeout leaves no way to know whether a chargeable session exists. The row plus idempotency key makes an ambiguous outcome recoverable without a second charge. |
| Event row written before financial state | Makes replay detection independent of how far processing got, and gives a retryable record when a write fails mid-way. |
| Monotonic state helpers instead of ad-hoc updates | "Paid" must survive late failure/expiry events; encoding that as a pure function makes it testable and impossible to forget in one branch. |
| Business switch separate from the environment switch | An operator with working test keys still must decide to offer online payment. Default off. |
| Fulfilment and payment are separate axes | Phase 5 already separated them; Phase 6 adds payment states without touching `order.status`. |
| Reconciliation is admin-triggered and bounded | No cron, no polling, no per-request provider read. Repair happens for one order at a time with evidence. |

---

## C. Database

No migration is required: new fields default safely on existing documents.

### C1. Extended `orders.payment`

| Field | Type | Default | Notes |
| --- | --- | --- | --- |
| `method` | enum | `cash_on_arrival` | `cash_on_arrival` \| `stripe` |
| `status` | enum | `unpaid` | `unpaid`, `awaiting_payment`, `processing`, `paid`, `failed`, `expired`, `partially_refunded`, `refunded`, `review_required` |
| `provider` | enum | `none` | `none` \| `stripe` |
| `amountReceivedCents` | integer | `0` | Written once from the verified attempt amount |
| `refundedAmountCents` | integer | `0` | Sum of `succeeded` refund rows |
| `stripeSessionId` | string \| null | `null` | Current attempt's session |
| `paymentIntentId` | string \| null | `null` | |
| `requiresReview` | boolean | `false` | Mismatch, duplicate settlement, late payment after cancellation |
| `reconciliationStatus` | enum | `not_checked` | `not_checked` \| `matched` \| `mismatch` \| `error` |
| `lastReconciledAt` | date \| null | `null` | |

`paidAt`, `paidByAdminId` and `paidByLabel` keep their Phase 5 meaning; the
`paidBy*` pair remains Cash on Arrival attribution only and is never written by
a Stripe path.

### C2. New collections

`payment_attempts` — one row per provider attempt, unique
`providerIdempotencyKey`, unique `{ orderId, sequence }`, **partial unique**
`{ orderId }` where `active: true`, partial unique session and intent ids.
Amount is integer cents with a Mongoose integer validator; currency is `CAD`.

`stripe_events` — unique `eventId`, `type`, `objectId`, `livemode`,
`eventCreatedAt`, `status` (`received` \| `processed` \| `retry` \|
`quarantined`), optional `orderReference`, `attempts`, `processedAt`,
`lastErrorCode`. **No TTL**: financial event ids are reconciliation evidence.
No raw payload and no PII are stored.

`payment_refunds` — unique `stripeRefundId`, `orderId`, `orderReference`,
`attemptId`, `stripePaymentIntentId`, integer `amountCents`, `CAD`, `status`
(`pending` \| `succeeded` \| `failed` \| `canceled`), `providerCreatedAt`,
`reconciledAt`.

`store_configs.payments.onlineEnabled` — boolean, default **false**, resolved
defensively (a corrupt block reads back as `false`, so a damaged document can
never enable payment).

### C3. Indexes

Created by `scripts/seed.ts` and the e2e harnesses, never at runtime
(`autoIndex` is off). Added in Phase 6: the attempt indexes above,
`stripe_events` unique `eventId` + `{ status, createdAt }` +
`{ orderReference, eventCreatedAt }`, `payment_refunds` unique
`stripeRefundId` + `{ orderId, createdAt }` + `{ attemptId, createdAt }`, and
`orders { "payment.status": 1, createdAt: -1 }`.

### C4. Integrity rules expressed in the schema

- One active attempt per order, enforced by a partial unique index rather than
  by application hope.
- Attempt amount is integer cents in `1..99_999_999`; a fractional value is
  rejected by validation before any provider call.
- Received and refunded amounts are non-negative integers, and refunds are
  refused (and flagged for review) if they would exceed the received amount.
- `stripeRefundId` uniqueness makes a replayed refund event idempotent at the
  storage layer, not only in code.

---

## D. Initialization

### D1. Readiness gates

| Gate | Requirement | Failure reason |
| --- | --- | --- |
| Server switch | `STRIPE_PAYMENTS_ENABLED === "true"` | `disabled` |
| Secret key | starts with `sk_test_` | `missing_configuration`; `live_key_rejected` for `sk_live_*` |
| Webhook secret | starts with `whsec_` | `missing_configuration` |
| Canonical origin | valid `https:` origin (localhost allowed locally) | `invalid_site_url` |
| Business switch | `store_configs.payments.onlineEnabled` | checkout offers cash only |

Both the environment gate and the owner switch must pass. Presence of
environment values alone enables nothing, and the switch alone enables nothing.
The SDK client is constructed lazily after the gate passes, so an unconfigured
deployment never holds a provider client. `sk_live_*` is rejected outright
rather than treated as "future ready".

### D2. Amount authority

The session is built from `order.money.totalCents` — the Phase 5 frozen
snapshot — with `mode: "payment"`, currency `cad`, and exactly one line item of
quantity 1. The request schema accepts only `{ reference, accessKey }`, so no
price, fee, tax, currency, status or session id can arrive from the browser.
Before the provider call the service re-reads the live store configuration and
re-runs `priceCheckout`; if the current total differs from the snapshot the
request fails with `payment_unavailable` and **nothing is mutated**. The
snapshot is never silently rewritten.

The hosted URL is validated to begin with `https://checkout.stripe.com` before
it is returned, so a provider or proxy surprise cannot redirect a customer
somewhere else.

### D3. Attempt reservation and idempotency

1. Capability authorization (reference alone is insufficient).
2. Readiness and business switch.
3. Snapshot re-check.
4. Insert `payment_attempts` with `providerIdempotencyKey = pearl_<48 hex>`,
   `sequence` incremented per order, `active: true`, `status: "creating"`.
5. Version-guarded order update to `awaiting_payment` with the session id when
   known.
6. Only then call Stripe with that key as the idempotency key.

### D4. Retry and recovery matrix

| Situation | Behaviour |
| --- | --- |
| Second click / second tab | One active attempt wins the partial unique index; the loser reports `payment_pending` and reuses the winner's session |
| Open session, matching amount/currency/metadata | The stored hosted URL is reused (`reused: true`) |
| Provider-confirmed expired session | Attempt retired, a new attempt may be created |
| Recorded failed attempt | Retired, new attempt allowed |
| Timeout / network error / unreadable response | Attempt kept as `uncertain`; retry calls Stripe with the **same** key, so Stripe returns the original session |
| Provider succeeded, local session-id write failed | The attempt row and key still exist; a retry or reconciliation recovers the same session |
| Older than 23 hours (inside Stripe's 24 h idempotency window) | No key reuse; the attempt is flagged and the customer is told the payment is still being confirmed |
| Already paid, partially refunded, refunded | `already_paid`; no new session |
| Cancelled or completed order | `not_payable` |
| More than five attempts | `attempt_limit` |

### D5. Initiation limits

`payment.create` is rate limited per client address at 10 attempts per 15
minutes, in the same MongoDB bucket design as the Phase 5 order limits but a
separate scope. Verified webhooks are never rate limited.

---

## E. Webhooks

### E1. Route behaviour

`POST /api/stripe/webhook` is a public endpoint that authorizes itself with a
signature, not with a cookie.

| Condition | Response |
| --- | --- |
| Readiness gate not met | `503` (nothing is processed) |
| Declared or actual body > 1 MB | `413` |
| Missing/oversized `stripe-signature` | `400` |
| Signature verification fails (any reason) | `400`, no detail leaked |
| Processing succeeded, duplicate, or quarantined | `200` |
| Processing threw | `500`, so Stripe retries |

The handler reads `request.arrayBuffer()` exactly once and passes the raw bytes
to `stripeClient().webhooks.constructEvent`. No body parser touches it. Every
response is `Cache-Control: private, no-store` with `X-Content-Type-Options:
nosniff`. The route deliberately has no `export const runtime` because
`cacheComponents` forbids it; Node is the App Router default.

### E2. Deduplication

The event row is inserted before any financial state changes, unique on the
Stripe event id. A second delivery finds a `processed` or `quarantined` row and
returns `200` without writing. A processing error marks the row `retry`, so the
same event can be reprocessed after Stripe redelivers it.

### E3. Verified before applying

- event is not `livemode`;
- session currency is `cad`, `amount_total` equals the attempt amount;
- attempt amount equals the order snapshot total; order currency is `CAD`;
- `client_reference_id` equals the order reference;
- both metadata keys match the persisted order and attempt;
- the session id resolves to a persisted attempt.

Any mismatch marks the attempt `uncertain`, sets the order to
`review_required` with `requiresReview: true`, quarantines the event, and
notifies the owner. Nothing financial is applied.

### E4. Supported events

| Event | Effect |
| --- | --- |
| `checkout.session.completed` with `payment_status === "paid"` | attempt `succeeded`, order `paid` |
| `checkout.session.completed` with any other `payment_status` | order `processing`, not paid |
| `checkout.session.async_payment_succeeded` | `paid` when settled, otherwise quarantined |
| `checkout.session.async_payment_failed` | `failed` when it is the current attempt and not already paid |
| `checkout.session.expired` | `expired` when it is the current attempt and not already paid |
| `refund.updated`, `charge.refunded` | refund rows upserted, totals recomputed |
| anything else | stored, marked processed, no financial effect |

---

## F. Lifecycle

Two independent axes: `order.status` (fulfilment, unchanged from Phase 5) and
`order.payment.status`. No payment event writes fulfilment, and no fulfilment
action writes payment.

```
unpaid ─▶ awaiting_payment ─▶ processing ─▶ paid ─▶ partially_refunded ─▶ refunded
   │            │                  │          │
   │            ├─▶ failed         └─▶ failed │
   │            └─▶ expired                   │
   └──────────▶ review_required ◀─────────────┘
```

Guarantees enforced in code:

1. **Paid is monotonic.** `paymentStatusAfterFailure` and
   `paymentStatusAfterExpiry` return `paid`, `partially_refunded`, `refunded`
   and `review_required` unchanged.
2. **Only verified provider data sets `paid`.** The webhook path and the
   audited reconciliation path are the only writers, and both re-verify amount,
   currency, reference and attempt.
3. **The admin Cash on Arrival action refuses Stripe orders** with "Online
   payments are recorded from verified Stripe events, not by hand."
4. **A refund cannot exceed what was received**; an over-refund becomes
   `review_required` instead of a negative net.
5. **Order money is immutable** after acceptance; no payment path writes
   `order.money.*`.

Out-of-order handling: a failure or expiry for a superseded attempt is ignored;
a success for a superseded attempt is recorded but flags review; a failure
after success changes nothing; a duplicate success keeps the first `paidAt` and
`amountReceivedCents`.

Late payment after cancellation retains the payment (`amountReceivedCents`,
`paidAt`, session and intent ids), sets `requiresReview`, notifies the owner
with `payment.refund_review`, and leaves `order.status` as `cancelled`.
Cancelling is explicitly not a refund.

---

## G. Customer experience

### G1. Checkout

Under **Payment** the customer sees two choices. Cash on arrival is always
available and reads "You pay in full when your order is delivered or collected.
Your order is recorded when it is placed; payment is still due."

Online payment is a real radio option only when both gates pass. Otherwise it
is visibly disabled with "Online payment is not available yet. Cash on Arrival
remains available." It never silently falls back to cash, and it never looks
like a working control.

The amount label switches between "Amount due on arrival" and "Amount to pay
online", and the submit control between **Place order** and **Continue to
Secure Payment**.

### G2. Return states

The success and cancel URLs are
`/order-confirmation?ref=…&payment_return=success|cancelled`, built from the
canonical origin, absolute, and capability-free. The capability stays in
`sessionStorage` and never appears in a URL, in Stripe metadata or in a
referrer.

| Server state | What the page says |
| --- | --- |
| `paid` | "Payment received. Thank you for your order." |
| `awaiting_payment`, `processing` | "We're confirming your payment. Your order details are saved." plus **Check payment status** |
| `failed`, `expired` | "Your payment wasn't completed. You can try again." plus a bounded retry |
| `partially_refunded`, `refunded` | the refunded amount and what remains |
| `review_required` | a wait message; the customer is not told a payment failed or succeeded |

A `payment_return` query value never changes what the page claims: the state
comes from the server read, and the page polls only while the payment is
genuinely pending, with a stop condition. No success animation or success text
appears before server verification.

### G3. Copy and accessibility

- No em dashes in customer-facing text; all Phase 6 strings were written
  without them.
- Semantic tokens only, no raw hex.
- Every payment control is keyboard operable with a visible `focus-gold` ring.
- Reduced motion is respected through the existing `MotionProvider`.
- Payment and confirmation routes are `noindex` and served `private, no-store`.

---

## H. Admin

### H1. Order detail

For a Stripe order the payment block shows the status, method, collected amount
and time, confirmed refunds, the PaymentIntent reference, and a **Payment needs
review** warning when `requiresReview` is set. Two new panels follow:

- **Online payment attempts** — sequence, state, amount, session and intent
  ids, expiry, normalized failure code, confirmation time.
- **Provider refund records** — one row per verified refund with amount, state
  and provider timestamp.

No manual "mark paid" control is offered for a Stripe order, and the server
refuses one even if the request is crafted by hand.

### H2. Reconciliation control

Read-only check first, then a separately confirmed apply that requires a second
press. Every submission re-authorizes the admin session. The apply writes one
audit event, `payment.reconciled`, with the result and the number of attempts
checked. Details in §K.

### H3. Dashboard

Eleven cards, aggregated from real order records in one round trip:

| Card | Definition |
| --- | --- |
| Orders | All orders ever placed |
| In progress | Not completed and not cancelled |
| Awaiting cash | Unpaid Cash on Arrival orders |
| Cash outstanding | Money still owed on cash orders |
| Paid online | Count of online-paid orders, with the online amount as a hint |
| Cash collected | Admin-recorded cash receipts |
| Online pending | Online orders awaiting settlement, not collected |
| Online failed or expired | Attempts needing a customer retry |
| Gross collected | Online plus cash collected, before refunds, not profit |
| Confirmed refunds | Verified provider refunds |
| Net collected | Gross collected less confirmed refunds |

Rules: an unpaid cash order is outstanding and never collected; a cancelled
unpaid order drops out of outstanding while still counting as an order; a
pending, failed, expired or review-required online payment counts as zero
collected; refunds reduce net only after the provider confirms them; legacy
paid cash orders still report their full total as collected.

### H4. Settings

A **Stripe readiness** panel states in plain language whether the environment is
ready, disabled, missing configuration, using a rejected live key, or missing a
canonical URL. It never echoes a key or a secret. The **Offer Stripe online
payment** switch is independent of order intake in both directions.

---

## I. Cash on Arrival regression

Phase 5 Cash on Arrival is unchanged in behaviour and still fully functional:

- Cash orders are created, listed, transitioned and completed exactly as
  before.
- **Record payment received** still requires two presses, still refuses a
  second recording, and still never changes the lifecycle status.
- Cash collection still counts only after an admin records it, and unpaid cash
  still appears as outstanding rather than collected.
- The only change is a refusal for Stripe orders, which prevents an online
  settlement from being double counted by hand.
- Dashboard cash figures were preserved when the single "collected" figure was
  split; existing tests that asserted cash totals still pass.

---

## J. Security

### J1. Authorization

| Surface | Authority |
| --- | --- |
| Payment initiation | Guest capability (sha256 of a browser-generated key held in `sessionStorage`); the order reference alone is refused |
| Confirmation read | Same capability, small DTO, no PII beyond what the placing browser already has |
| Webhook | Stripe signature over the raw body; no cookie and no session |
| Admin pages | Session guard on every request |
| Admin reconciliation | `requireActionAdmin()` re-run inside the action, not just on render |
| Admin manual payment | Admin session plus the order's version token, and Stripe orders are refused |

### J2. Secrets and data

- Secret key and webhook secret are read server-side only; no `NEXT_PUBLIC_`
  variant exists for either.
- No card number, CVC, expiry, payment-method token or full provider payload is
  received, logged or stored.
- Provider failures are persisted as short normalized codes
  (`provider_unavailable`, `provider_mismatch`, `session_response_mismatch`,
  `refund_details_incomplete`, and so on), never raw provider text.
- `stripe_events` stores identifiers and timestamps only.
- The admin readiness panel reports gate state, never values.

### J3. Caching and indexing

Payment state is read in Server Actions, the POST handler and request-rendered
pages. Payment and confirmation routes are `noindex`, and payment responses are
`private, no-store`. No payment value is cached, prefetched or embedded in a
static shell.

### J4. Abuse and failure modes

- Initiation is rate limited; verified webhooks are not (Stripe's retries must
  never be throttled).
- Ambiguous provider outcomes are resolved toward "not paid yet", never toward
  "paid".
- A DB write failure after provider success is recoverable through the
  persisted key, not by asking the customer to pay again.
- Live-mode events are quarantined, not applied.
- A malformed or oversized webhook is rejected before any database work.

---

## K. Reconciliation

`reconcileStripeOrder(reference, apply)` compares up to the five most recent
attempts against the provider's server record.

| Check | Failure code |
| --- | --- |
| Session id matches the stored id | `provider_snapshot_mismatch` |
| Session not `livemode` | `provider_snapshot_mismatch` |
| Currency `cad`, `amount_total` equals the attempt amount | `provider_snapshot_mismatch` |
| Attempt amount equals the order snapshot total; both `CAD` | `provider_snapshot_mismatch` |
| `client_reference_id` and both metadata keys match | `provider_snapshot_mismatch` |
| PaymentIntent currency, amount, `succeeded` | `payment_intent_mismatch` |
| Charge currency and amount | `charge_amount_mismatch` |
| Local paid order is settled at the provider | `local_paid_provider_not_settled` |
| Local failed/expired order is not open at the provider | `local_failure_provider_open` |
| Refunded total is accountable by known refund rows | `refund_details_incomplete` |
| At least one attempt exists | reported, blocks apply |
| Provider reads succeed | `provider_read_unavailable` |

Results: `matched`, `mismatch`, `pending`, `not_applicable`, `unavailable`.
Only `matched` findings are ever applied, and applying re-reads provider facts
instead of trusting the dry run. Writes reuse the webhook functions, so the
monotonic and amount guards are identical. A mismatch applies nothing and flags
review.

Safety properties: read-only by default (`apply` must be the string `"true"`);
every submission re-authorizes; bounded to one order and five attempts; no
secret, raw payload or provider message reaches the browser or the audit log;
without readiness the run reports `unavailable` and changes nothing.

Known limits: no CLI command and no scheduled job (the admin panel is the only
path); a provider read failure leaves `pending`; a session deleted in Stripe
cannot be reconstructed.

---

## L. Refund foundations

Modelled, never initiated.

- `payment_refunds` holds one row per verified provider refund, unique on
  `stripeRefundId`.
- Rows come only from verified `refund.updated` / `charge.refunded` events or
  from audited reconciliation after re-reading the charge.
- `order.payment.refundedAmountCents` is the sum of `succeeded` rows and is
  never derived from a browser value or an operator guess.
- Partial refunds move the order to `partially_refunded`; a total refund moves
  it to `refunded`. Both are terminal for payment.
- If the provider reports more refunded than the local rows account for, the
  order is flagged `review_required` instead of guessing the difference.

Explicitly absent: customer refund requests, one-click refunds, automatic
refunds on cancellation, dispute or chargeback UI, and any refund API call from
this application. Refunds are performed in the Stripe dashboard.

---

## M. Tests

### M1. Unit and integration (Vitest)

`npm run test` → **713 passed / 52 files** (Phase 5 baseline was 686/48).
Payment suites run against a real in-memory MongoDB with the provider reached
through injected gateways, so reservation, indexes, state transitions, refund
maths, notifications and audit writes all execute for real.

New Phase 6 files:

| File | Tests | Covers |
| --- | --- | --- |
| `src/lib/payments/payments.test.ts` | 18 | readiness, session shape, capability, paid/cancelled refusal, reuse/concurrency, timeout recovery, provider-success/local-write-failure, expiry replacement, snapshot re-check, reconciliation dry-run/apply/mismatch, paid confirmation, completed-but-unpaid, async success, later failure/expiry, refunds, mismatch and late success, live-mode quarantine, signature verification |
| `src/lib/payments/state.test.ts` | 2 | monotonic failure/expiry helpers, refund status boundaries |
| `src/lib/actions/payments.test.ts` | 3 | admin authorization, dry run vs apply, audit event |
| `src/lib/orders/rate-limit.test.ts` | 2 | `payment.create` scope isolation and limit |

Extended Phase 5 suites: `src/lib/repositories/admin.test.ts` (17, financial
split and legacy cash), `src/lib/actions/admin-orders.test.ts` (32, including
the Stripe refusal), `src/lib/repositories/admin-orders.test.ts` (18, payment
detail and attempt/refund DTOs), plus the checkout, pricing and settings
suites updated for the new switch.

Coverage against the §8 matrix: initialization amount/currency/fees/tax once,
tampering, authorization, readiness, paid/cancelled rejection, idempotency,
races, timeouts, recovery, webhook signature valid/missing/bad/modified,
malformed and unsupported events, amount/currency/association/environment
mismatch, every supported event, duplicate and out-of-order delivery, async
results, late success after cancellation, outbox once, double-click/tabs,
provider success with database failure, failed/expired retries, paid rejection,
COA collection, order lifecycle, and reporting (pending/unpaid not revenue,
each paid order once, failures not revenue, gross vs net with refunds).

### M2. End-to-end (Playwright)

`npm run test:e2e` → **88 passed** across the storefront, cart/checkout, admin
and orders projects. The Phase 6 addition is the ninth orders test: online
payment stays visibly unavailable without explicit Stripe test configuration
while cash ordering keeps working.

Phase 5 scenarios A, B1, B2, C, D, E1, E2 and E3 continue to pass and cover
order creation, idempotent resubmission, tampered totals, cash payment
recording, both lifecycles, capability protection, admin re-authorization and
rate limiting. Scenario E already proves payment/fulfilment independence.

### M3. What is and is not proven

| Layer | Proven by | Status |
| --- | --- | --- |
| Local payment logic, state machine, persistence, indexes, refunds, reporting | Vitest against real MongoDB | Genuine |
| Webhook signature verification and raw-body handling | Vitest calling the real route with `Stripe.webhooks.generateTestHeaderString` and the SDK's `constructEvent` | Genuine SDK, synthetic sender |
| Hosted Checkout redirect, Stripe's own validation, a real test-mode charge | Not executed | **Not proven** (see §N) |
| Customer/admin UI states | Playwright + screenshots | Genuine, provider-unavailable branch |
| Live mode | Not implemented | Out of scope |

Honest limitation: the spec's Playwright scenarios for a successful hosted
redirect, abandonment, retry after a provider failure and webhook duplication
were not implemented as browser tests, because the provider can only be reached
over the network and the suite must not make real charges or require
credentials. Those paths are covered at the service and route level instead,
and the operator pass in §S is the remaining gap.

---

## N. Stripe test-mode verification

**No genuine Stripe test-mode request was made in this environment.**

Facts, stated plainly:

- `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PAYMENTS_ENABLED` and
  `NEXT_PUBLIC_SITE_URL` were all unset, and no Stripe CLI session was
  authenticated. No test account was available.
- No real charge, no hosted Checkout page load and no live webhook delivery
  occurred.
- Webhook signature verification is genuine: the tests call the real route with
  real SDK-generated signatures and the real `constructEvent` verifier, and
  assert that forged, missing and modified signatures are rejected.
- Provider calls in tests go through injected gateways. Those gateways replace
  only the network layer; every local rule, write, index and guard is the real
  implementation.
- The e2e suite asserts the honest unconfigured state rather than faking a
  provider.

Consequently, "works with Stripe" is **unverified**. The exact operator pass
required before online payment is offered to a customer is in §S.

---

## O. Visual QA

`npm run screenshots` → **200 captures**, **zero horizontal overflow** at every
viewport. Phase 6 surfaces:

| Capture | Viewports |
| --- | --- |
| `checkout-payment` | 390, 1440 |
| `admin-settings-payments` | 320, 360, 390, 667 landscape, 768, 1024, 1440 |
| `admin-dashboard-orders` | 320, 360, 390, 667 landscape, 768, 1024, 1440 |
| `admin-orders` | 320, 360, 390, 667, 768, 1024, 1440 |
| `admin-order-detail` | 320, 360, 390, 667, 768, 1024, 1440 |
| `order-confirmation` (with and without capability) | 320, 360, 390, 667, 768, 1024, 1440 |

Visual inspection was performed on the rendered images, not just the overflow
assertion. Defects found and fixed:

1. **Dashboard money values wrapped.** `$21.13 CAD` broke onto two lines with
   "CAD" rendered at heading size, which read as a layout defect. `StatCard`
   now splits the amount and renders a small uppercase currency label while
   preserving the literal `$21.13 CAD` text the orders test asserts.
2. **Literal backticks in settings copy.** The Stripe readiness panel rendered
   `` `.env.example` `` with visible backticks. Fixed to plain text.
3. **Payment panel clipped by the sticky header.** The `checkout-payment`
   capture scrolled the element just enough to hide the top card under the site
   header. The capture now centres the section before shooting.

Also checked: no gold text on cream, no raw hex, focus rings present on the
payment radios and admin controls, mobile landscape usable, and no success
styling on any unverified state.

---

## P. Business configuration

| Setting | Default | Effect |
| --- | --- | --- |
| `STRIPE_PAYMENTS_ENABLED` | absent | Online payment disabled |
| `STRIPE_SECRET_KEY` | absent | `missing_configuration`; `sk_live_*` → `live_key_rejected` |
| `STRIPE_WEBHOOK_SECRET` | absent | `missing_configuration` |
| `NEXT_PUBLIC_SITE_URL` | absent | `invalid_site_url`; return URLs cannot be built |
| `store_configs.payments.onlineEnabled` | **false** | Checkout offers cash only |

Both the environment gate and the owner switch are required, and each is
independently reversible. Turning online payment off does not affect cash
orders, order intake or fulfilment. The owner-facing checklist lives in
`docs/BUSINESS_CONFIGURATION.md`, and the integration guide in
`docs/STRIPE_INTEGRATION.md`.

No tax treatment was changed or invented. The Checkout amount equals the Phase
5 total, which already includes the owner-configured fee and tax. If the current
tax configuration is inadequate for the business's real Canadian tax position,
that remains a professional accounting decision and a reason to keep live
payments disabled.

---

## Q. Limitations

1. **No genuine Stripe verification** (§N). This is the single largest gap.
2. **No refund workflow.** Refunds are recorded from Stripe, never initiated.
3. **No scheduled reconciliation.** Repair is operator-triggered, one order at
   a time; there is no CLI.
4. **No hosted-checkout browser tests.** Provider-facing Playwright scenarios
   are covered at service and route level instead (§M3).
5. **Notifications remain pending.** No provider is configured, so nothing
   claims delivery, and payment does not depend on notification success.
6. **Attempt cap of five per order.** A customer who exhausts it must contact
   the store.
7. **Idempotency reuse window is 23 hours.** Beyond that, an uncertain attempt
   needs operator attention rather than automatic recovery.
8. **Asynchronous payment methods** are handled conservatively: a completed but
   unsettled session is `processing`, not `paid`.
9. **No deployment and nothing pushed.** No Git credentials are configured in
   this environment, so the work is local-only.
10. **Live mode is not implemented.** `sk_live_*` is rejected by design.

---

## R. Git status

- Branch: `main`.
- Base: `a9f6963` — Phase 6A, specification and architecture.
- Code commit: `06c9865` — payment implementation, models, route, actions, UI,
  tests, seed indexes, `.env.example`, screenshot script.
- Documentation commit: `5764b75` — this report and the updated document set.
- Follow-up copy fix: `95be571` — two customer-facing money fallbacks used an em
  dash placeholder; they now use a hyphen, matching the no-em-dash copy rule.
- Working tree after the final commit: clean.
- **Push: not performed.** No remote credentials or `gh` authentication exist
  in this environment. Nothing was reset, rebased or discarded.
- Gates below were run on this tree.

| Gate | Result |
| --- | --- |
| `npx next typegen` | Pass — types generated |
| `npm run typecheck` | Pass — no errors |
| `npm run lint` | Pass — zero errors, zero warnings |
| `npm run test` | Pass — 713 / 52 files |
| `npm run build` | Pass — `/api/stripe/webhook` dynamic; Phase 5 routes intact |
| `npm run test:e2e` | Pass — 88 tests |
| `npm run screenshots` | Pass — 200 captures, no horizontal overflow |

---

## S. Readiness for live orders

### S1. What is ready

Cash on Arrival ordering, order management, notifications (as a durable queue)
and the whole Phase 1–5 storefront are ready for review. Stripe integration is
implemented, gated off, and honest about being unverified.

### S2. What blocks online payment

1. No genuine Stripe test-mode payment has been completed.
2. No Stripe test keys or webhook secret are configured.
3. The owner has not decided whether to offer online payment at all.
4. Nothing is deployed, so no public webhook endpoint exists.

### S3. Exact manual verification steps

Run these in Stripe **test mode** only. Never enter a real card, and never
paste a key into chat, a ticket or a screenshot.

1. In the Stripe dashboard (test mode), confirm the account can create Checkout
   Sessions and note the publishable/test secret pair.
2. Put these in `.env.local` (git-ignored) and restart the app:
   - `STRIPE_PAYMENTS_ENABLED=true`
   - `STRIPE_SECRET_KEY=sk_test_...`
   - `STRIPE_WEBHOOK_SECRET=whsec_...`
   - `NEXT_PUBLIC_SITE_URL=http://localhost:3000` for local work
3. Sign in at `/admin/settings` and confirm the **Stripe readiness** panel says
   the test-mode configuration is ready, then turn on **Offer Stripe online
   payment**.
4. Forward events: `stripe listen --forward-to localhost:3000/api/stripe/webhook`
   and use the `whsec_...` that command prints.
5. Place a real order through `/checkout` with **Online payment**, using an
   orderable fixture product. Confirm:
   - the browser leaves for `checkout.stripe.com`;
   - the amount equals the review panel total, including fee and tax;
   - no card field ever appears on this site.
6. Pay with `4242 4242 4242 4242`, any future expiry, any CVC. Confirm the
   return page says "We're confirming your payment..." until the event arrives,
   then "Payment received. Thank you for your order."
7. Confirm the order shows **Paid** with the collected amount, appears once
   under **Paid online**, and **Gross collected** / **Net collected** moved by
   exactly that amount.
8. Replay the same event (`stripe events resend <id>`). Confirm the order stays
   `paid`, the attempt count does not change, and the dashboard does not double
   count.
9. Start another payment and press back without paying. Confirm the order stays
   payable and **Continue** reuses the same session instead of creating a second
   one.
10. Force a failure (Stripe test card `4000 0000 0000 0002`). Confirm the order
    becomes `failed`, is not counted as collected, and a retry creates a new
    attempt.
11. Cancel an unpaid Stripe order in the admin, then complete a test payment for
    it. Confirm the order stays `cancelled`, keeps the payment, and shows
    **Payment needs review**.
12. Refund the test payment in the Stripe dashboard. Confirm **Confirmed
    refunds** and **Net collected** change only after `refund.updated` or
    `charge.refunded` is received, and the order becomes `partially_refunded` or
    `refunded`.
13. Open a Stripe order, run **Run read-only check** (nothing changes), then
    apply with the second confirmation. Confirm the audit log records
    `payment.reconciled`.
14. Repeat steps 5–8 at 320 px width and in mobile landscape.
15. Record the date, account mode and observed outcomes in the release notes.

### S4. Before real money

Live activation is a separate, explicit decision that requires: a completed
test-mode pass above, a registered public webhook endpoint with a live-mode
secret, an accounting decision on tax treatment, a documented refund policy, an
owner decision on who reviews `review_required` payments, and a deployment.
None of that is authorised by Phase 6.

**Phase 6 stops here. No Phase 7 work, no live payments, no deployment.**
