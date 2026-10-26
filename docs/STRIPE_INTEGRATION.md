# PEARL Signature - Stripe Integration

Phase 6. How the hosted Stripe Checkout integration is configured, what the
server trusts, and how to run it against Stripe test mode.

Companion documents: `docs/PAYMENT_LIFECYCLE.md` (states and transitions),
`docs/PAYMENT_RECONCILIATION.md` (provider reads and audited repair),
`docs/ORDER_ARCHITECTURE.md` (the Phase 5 order pipeline this builds on),
`docs/BUSINESS_CONFIGURATION.md` (the owner-facing switches).

## 1. Scope and boundaries

Phase 6 adds **online payment for an order that already exists**. The customer
never types card details on this site: the browser is redirected to Stripe's
hosted Checkout page, and the order is settled only from a signature-verified
Stripe event.

Implemented:

- Stripe Checkout Session initialization for an accepted Phase 5 order.
- Hosted payment page, one line item for the order's accepted total.
- Signature-verified webhook endpoint with durable event deduplication.
- Payment states, verified refund records, and admin reconciliation.
- Test-mode configuration only.

Not implemented, deliberately:

- Live payments. A `sk_live_*` key is rejected at readiness and live-mode
  events are quarantined.
- Card forms, card data storage, or Stripe.js on this site.
- Subscriptions, invoices, Payment Links, Stripe Tax, discounts, gift cards,
  saved payment methods, customer accounts.
- Automated refunds, one-click refunds, dispute or chargeback handling.
- Any delivery or fulfilment integration driven by payment.

## 2. File map

| Concern | File |
| --- | --- |
| Readiness gate and SDK client | `src/lib/payments/stripe.ts` |
| Session creation, attempt reservation, retry | `src/lib/payments/service.ts` |
| Verified event processing, refund records | `src/lib/payments/webhooks.ts` |
| Webhook route handler | `src/app/api/stripe/webhook/route.ts` |
| Monotonic state helpers | `src/lib/payments/state.ts` |
| Reconciliation service | `src/lib/payments/reconcile.ts` |
| Public Server Actions | `src/lib/actions/orders.ts` |
| Admin reconciliation action | `src/lib/actions/payments.ts` |
| Attempt, event and refund documents | `src/models/payment-attempt.ts`, `src/models/stripe-event.ts`, `src/models/payment-refund.ts` |
| Payment enums, labels, request schemas | `src/lib/validations/order.ts` |

## 3. Readiness gates

Online payment is offered only when **every** condition holds. Environment
presence alone is never enough.

| Gate | Requirement | Failure reason |
| --- | --- | --- |
| Server switch | `STRIPE_PAYMENTS_ENABLED` is exactly `true` | `disabled` |
| Secret key | starts with `sk_test_` | `missing_configuration`, or `live_key_rejected` for `sk_live_*` |
| Webhook secret | starts with `whsec_` | `missing_configuration` |
| Canonical origin | `NEXT_PUBLIC_SITE_URL` is a valid `https:` origin (or `http://localhost`, `http://127.0.0.1` for local work) | `invalid_site_url` |
| Business switch | `store_configs.payments.onlineEnabled` is on at `/admin/settings` | checkout offers Cash on Arrival only |

The business switch defaults to **off** and is independent of order intake.
Turning on online payment does not turn on order intake, and turning on order
intake does not turn on online payment.

`stripeReadiness()` is evaluated per request. The SDK client is constructed
lazily and only after the gate passes, so an unconfigured deployment never
holds a provider client.

## 4. Configuration

All Stripe values are server-side. Never commit real values and never paste
them into a chat, ticket or screenshot.

```bash
# .env.local (git-ignored)
STRIPE_PAYMENTS_ENABLED=true
STRIPE_SECRET_KEY=sk_test_...        # test mode only
STRIPE_WEBHOOK_SECRET=whsec_...      # from the endpoint or `stripe listen`
NEXT_PUBLIC_SITE_URL=https://your-preview-host.example
```

Then, in the owner dashboard at `/admin/settings`, turn on **Offer Stripe
online payment**. The Stripe readiness panel on the same page reports the
current gate state and never echoes a key.

Webhook endpoint to register in the Stripe dashboard (test mode):

```
https://<your-host>/api/stripe/webhook
```

Subscribe to `checkout.session.completed`,
`checkout.session.async_payment_succeeded`,
`checkout.session.async_payment_failed`, `checkout.session.expired`,
`refund.updated` and `charge.refunded`. Other event types are acknowledged and
ignored.

Local development uses the Stripe CLI instead of a public URL:

```bash
stripe listen --forward-to localhost:3000/api/stripe/webhook
```

The CLI prints a `whsec_...` value for `STRIPE_WEBHOOK_SECRET`. That value is
different from a dashboard endpoint secret; use whichever matches the sender.

## 5. Checkout Session shape

The session is created from the immutable Phase 5 order snapshot, never from
browser input.

| Parameter | Value |
| --- | --- |
| `mode` | `payment` |
| `line_items` | exactly one item: quantity 1, `unit_amount` = `order.money.totalCents`, currency `cad` |
| `client_reference_id` | the order reference (`PS-...`) |
| `metadata.order_reference` | the order reference |
| `metadata.payment_attempt_id` | the persisted attempt id |
| `payment_intent_data.metadata` | the same two keys |
| `customer_email` | the email captured at checkout |
| `success_url` | `<site>/order-confirmation?ref=...&payment_return=success` |
| `cancel_url` | `<site>/order-confirmation?ref=...&payment_return=cancelled` |

Why one line item for the whole total: the order total is already the accepted
figure, including the owner's configured delivery fee and tax treatment. Sending
per-item lines would require re-deriving tax and fees at the provider, which
would risk charging a different amount from the one the customer reviewed. The
single line keeps the provider amount identical to the snapshot, and this
project does not use Stripe Tax.

The session uses whatever payment methods the Stripe account enables by
default. Asynchronous methods are handled: a completed session whose
`payment_status` is not `paid` becomes `processing`, not `paid`.

Return URLs are built from the canonical origin, must be absolute, and are
capability-free. The confirmation capability stays in the customer's
`sessionStorage`; it never appears in a URL, in Stripe metadata or in a
referrer.

## 6. Attempt reservation and idempotency

A provider request must never happen without a durable local record of it.

1. The order and its capability are re-authorized (reference alone is not
   authority).
2. The live store configuration is re-read and `priceCheckout` is recomputed.
   If the current total no longer equals the accepted snapshot the request is
   refused with `payment_unavailable` and the snapshot is left untouched.
3. An `payment_attempts` document is inserted with a random
   `providerIdempotencyKey` of the form `pearl_<48 hex chars>`, `sequence`
   incremented per order, and `active: true`.
4. The order is moved to `awaiting_payment` with a version-guarded update.
5. Only then is Stripe called, with that key as the request idempotency key.

A unique partial index allows at most one `active` attempt per order, and
`sequence` is unique per order, so two concurrent tabs cannot create two
chargeable sessions.

Recovery rules:

- A retry while an attempt is active **reuses** its hosted URL when Stripe still
  reports the session as `open` and its amount, currency and metadata match.
- A provider-confirmed expired session is retired and a new attempt may be
  created.
- An ambiguous failure (timeout, network error, unreadable response) keeps the
  reservation as `uncertain` and returns a "still pending" outcome. The next
  attempt calls Stripe again with the **same** idempotency key, so Stripe
  returns the original session rather than creating a second one.
- The key is only reused inside Stripe's 24-hour idempotency window; the
  service uses a 23-hour safe bound and flags the attempt for review beyond it.
- If the provider succeeded but the local write failed, the attempt row still
  exists with its key, so a later retry or reconciliation recovers the same
  session instead of charging again.

Attempts are capped at five per order (`attempt_limit`), and initiation is rate
limited per client address (`payment.create`, 10 per 15 minutes). Verified
webhooks are never rate limited.

## 7. Server-side amount authority

| Rule | Where |
| --- | --- |
| Amount comes from `order.money.totalCents` | `sessionRequest` in `src/lib/payments/service.ts` |
| Amount must be integer cents, `> 0`, `<= 99_999_999` | `startStripeCheckout` |
| Currency must be `CAD` | `startStripeCheckout` |
| Live configuration must still produce the same total | `priceCheckout` re-check |
| No price, tax, fee, currency or status accepted from the browser | `startPaymentRequestSchema` accepts only `reference` and `accessKey` |
| Hosted URL must be `https://checkout.stripe.com` | `createOrRecoverSession` |

If the owner changes a delivery fee or tax rate between order placement and
payment, the customer is asked to review the new total by placing a fresh
order; an existing snapshot is never silently rewritten.

## 8. Customer-visible outcomes

`startStripeCheckout` returns a small reason union. The checkout and
confirmation surfaces map it to plain language; no provider text is shown.

| Reason | Meaning | Customer sees |
| --- | --- | --- |
| `payment_pending` | an attempt is open or uncertain | "Your order is saved. We are checking the payment session before offering another attempt." |
| `payment_unavailable` | configuration or amount mismatch | "Online payment is not available right now. Your order is saved. You can retry here or choose Cash on Arrival." |
| `already_paid` | already settled or refunded | "This order has already been paid. Open your order confirmation to review it." |
| `attempt_limit` | five attempts used | "Online payment could not be retried for this order. Please contact the store using its verified contact details." |
| `rate_limited` | initiation budget exhausted | "Too many payment attempts were made. Please wait a little while before trying again." |
| anything else | `not_found`, `not_payable`, `conflict`, `unavailable` | "Your order is saved, but secure payment could not be started. Please try again." |

On the confirmation page a retry that is still pending says "We are checking
the payment status. Please check this order again shortly."; every other
refusal says "Secure payment could not be started. Your order details are
saved. Please try again later."

No error path prints a Stripe error message, a key, a session id or a stack
trace to the customer.

## 9. Logging and privacy

- No secret key, webhook secret, card data, full provider payload or customer
  PII is logged.
- Provider failures are stored as short normalized codes (`provider_unavailable`,
  `provider_mismatch`, `session_response_mismatch`, and so on), never raw
  provider text.
- `stripe_events` stores event id, type, object id, `livemode`, timestamps,
  status, an optional order reference and a normalized error code. It does not
  store the event body.
- Payment pages and the confirmation route are `noindex` and served
  `private, no-store`.

## 10. Test seams

Server-only modules expose deterministic seams used by Vitest. They are not
reachable from a browser and are not imported by any page:

| Seam | Module |
| --- | --- |
| `setStripeCheckoutGatewayForTests` | `src/lib/payments/service.ts` |
| `setStripeReconciliationGatewayForTests` | `src/lib/payments/reconcile.ts` |
| `resetStripeClientForTests` | `src/lib/payments/stripe.ts` |

The seams replace the network layer only. Reservation, state transitions,
indexes and audit writes still run against the real code paths.

## 11. Genuine Stripe test-mode verification

The automated suites run **without** Stripe credentials. They prove the local
logic, the state machine and the persistence rules; they do not prove that a
real Stripe account accepts the request. Before enabling payments for real
customers, an operator must complete this manual pass in test mode:

1. Set the four environment values above with test keys, restart the app, and
   confirm `/admin/settings` reports "Stripe test-mode configuration is ready".
2. Turn on **Offer Stripe online payment**, keep order intake on, and place a
   real order through `/checkout` choosing Online payment.
3. Confirm the redirect host is `checkout.stripe.com` and the amount shown
   equals the amount on the checkout review panel.
4. Pay with `4242 4242 4242 4242`, any future expiry date and any CVC.
5. Watch `stripe listen` (or the dashboard endpoint) show
   `checkout.session.completed`, and confirm the order becomes `paid` once, the
   confirmation page says "Payment received. Thank you for your order.", and
   the dashboard counts it under **Paid online**.
6. Replay the same event from the Stripe dashboard CLI and confirm the order
   stays `paid` and the dashboard does not double count.
7. Open the Checkout page, press back without paying, wait for expiry (or use a
   session created with a short expiry in test mode), and confirm the order
   becomes `expired` and can be retried.
8. Cancel an unpaid Stripe order, then complete a test payment for its session
   and confirm the order stays cancelled, the payment is retained, and the
   order is flagged for review.
9. Refund the test payment in the Stripe dashboard and confirm
   **Confirmed refunds** and **Net collected** change only after
   `refund.updated` or `charge.refunded` is received.

Record the date, Stripe account mode and observed outcomes in the release
notes. Until this pass is done, treat online payment as unverified against a
real provider.
