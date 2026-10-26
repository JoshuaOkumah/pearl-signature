# PEARL Signature - Payment Lifecycle

Phase 6. The states a payment can occupy, the only events allowed to move it,
and the invariants that keep a recorded settlement honest.

Companion documents: `docs/STRIPE_INTEGRATION.md` (provider configuration),
`docs/PAYMENT_RECONCILIATION.md` (repairing uncertain outcomes),
`docs/ORDER_LIFECYCLE.md` (fulfilment states, unchanged by Phase 6).

## 1. Two lifecycles, kept separate

| Lifecycle | Field | Values |
| --- | --- | --- |
| Fulfilment | `order.status` | `placed`, `confirmed`, `preparing`, `ready_for_pickup`, `out_for_delivery`, `completed`, `cancelled` |
| Payment | `order.payment.status` | `unpaid`, `awaiting_payment`, `processing`, `paid`, `failed`, `expired`, `partially_refunded`, `refunded`, `review_required` |

They are independent on purpose. An order can be paid before it is confirmed,
and it can be completed with cash still outstanding. No payment event writes
`order.status`, and no fulfilment action writes `order.payment.status`.

Payment method (`order.payment.method`: `cash_on_arrival` or `stripe`) and
provider (`order.payment.provider`: `none` or `stripe`) are separate from both.

## 2. What each state means

| Payment status | Meaning | Counted as collected? |
| --- | --- | --- |
| `unpaid` | no online attempt, or a cash order not yet paid | no |
| `awaiting_payment` | a hosted session exists and the customer was sent to it | no |
| `processing` | the session completed but settlement is not confirmed | no |
| `paid` | a verified provider event confirmed the full amount | yes |
| `failed` | the provider reported the payment failed | no |
| `expired` | the provider confirmed the session expired | no |
| `partially_refunded` | verified refunds total less than the received amount | yes, net of refunds |
| `refunded` | verified refunds total the received amount | yes, net of refunds |
| `review_required` | provider and local facts disagree, or a settlement needs a human decision | no |

`review_required` is a decision state, not a money state. It never claims money
was or was not received; the admin detail page shows the provider identifiers
so an operator can check Stripe directly.

## 3. Allowed transitions

```
unpaid ──▶ awaiting_payment ──▶ processing ──▶ paid ──▶ partially_refunded ──▶ refunded
   │              │                  │           │
   │              ├──▶ failed        └──▶ failed │
   │              └──▶ expired                  │
   └──────────────▶ review_required ◀───────────┘  (any disagreement)
```

Rules enforced in code, not by convention:

1. **Paid is monotonic.** `paymentStatusAfterFailure` and
   `paymentStatusAfterExpiry` return the current value unchanged when it is
   `paid`, `partially_refunded` or `refunded`. A late or replayed failure event
   can never un-pay an order.
2. **Only verified provider data sets `paid`.** The sole writers are the
   signature-verified webhook path and the audited reconciliation path, both of
   which re-check amount, currency, order reference and attempt id first.
3. **The admin Cash on Arrival action refuses Stripe orders.** It returns
   "Online payments are recorded from verified Stripe events, not by hand."
4. **A refund cannot exceed what was received.** `refundStatus` returns
   `review_required` when the refunded total is greater than the received total,
   and `updateRefundTotals` refuses the write and flags review instead.
5. **Order amounts are immutable after acceptance.** No payment code path writes
   `order.money.*`.

## 4. Event mapping

Every event is written to `stripe_events` before any financial state changes.
The event row is unique on the Stripe event id, so a replay is detected before
it can double count.

| Stripe event | Condition | Result |
| --- | --- | --- |
| `checkout.session.completed` | `payment_status === "paid"` | attempt `succeeded`, order `paid` |
| `checkout.session.completed` | `payment_status !== "paid"` | order `processing` (not paid) |
| `checkout.session.async_payment_succeeded` | `payment_status === "paid"` | order `paid`; otherwise quarantined |
| `checkout.session.async_payment_failed` | current attempt, not already paid | order `failed` |
| `checkout.session.expired` | current attempt, not already paid | order `expired` |
| `refund.updated` | refund belongs to a known attempt | refund row upserted, totals recomputed |
| `charge.refunded` | charge matches the attempt amount | refunds from the charge are recorded, totals recomputed |
| any other type | - | acknowledged, no financial effect |

Preconditions checked before any of the above is applied:

- the event is not `livemode`;
- the session currency is `cad` and `amount_total` equals the attempt amount;
- the attempt amount equals the order snapshot total, and the order currency is
  `CAD`;
- `client_reference_id` and both metadata keys match the persisted order and
  attempt;
- the session id resolves to a persisted attempt.

Any mismatch marks the attempt `uncertain`, sets the order to
`review_required` with `requiresReview: true`, quarantines the event, and
notifies the owner. Nothing is applied.

## 5. Duplicate and out-of-order events

| Situation | Behaviour |
| --- | --- |
| Same event delivered twice | second delivery finds a `processed` or `quarantined` row and returns without writing |
| Success event arrives twice | `applySuccessfulPayment` is idempotent: `paidAt` and `amountReceivedCents` keep their first values |
| Failure event arrives after success | ignored for a settled order; the attempt row is not downgraded |
| Expiry event arrives after success | ignored for a settled order |
| Failure or expiry for a superseded attempt | ignored; only the current attempt may change the order |
| Success for a superseded attempt | recorded, but the order is flagged for review (`laterActiveAttempt`) |
| Unknown or unsupported event | stored, marked processed, no financial effect |
| Processing error | event marked `retry`, the endpoint returns 5xx, and Stripe retries |

"Current attempt" means the attempt whose session id is stored on the order, or
the single active attempt when the order has no session id yet.

## 6. Retry semantics for the customer

| Starting state | Retry allowed | What happens |
| --- | --- | --- |
| `unpaid` | yes | new attempt, new idempotency key |
| `awaiting_payment` | yes | reuses the open hosted session when provider state matches |
| `processing` | yes | reuses or reports pending; never creates a parallel charge |
| `failed` | yes | previous attempt retired, new attempt created |
| `expired` | yes | previous attempt retired, new attempt created |
| `paid`, `partially_refunded`, `refunded` | no | `already_paid` |
| `review_required` | no | review first; the confirmation page asks the customer to wait |

Only a provider-confirmed `expired` or a recorded `failed` retires an attempt.
An ambiguous outcome keeps the attempt active as `uncertain` and the retry goes
back to Stripe with the same idempotency key, so at most one session can ever be
chargeable for that attempt.

## 7. Late payment after cancellation

Cancelling an order does not cancel a hosted session and does not issue a
refund. If a customer completes a payment for an order the owner already
cancelled:

1. The verified payment is **retained** on the order
   (`amountReceivedCents`, `paidAt`, session and intent ids).
2. `payment.requiresReview` is set, so the admin detail page shows the review
   warning.
3. The owner is notified with the `payment.refund_review` event, whose text
   states that no refund was initiated automatically.
4. `order.status` stays `cancelled`. The payment record does not resurrect it.
5. The dashboard counts the money under **Paid online** and **Gross collected**,
   because it was really received, and lists the order under review.

Deciding whether to refund is an operator action performed in Stripe. Phase 6
does not automate it and has no refund button.

## 8. Refund foundations

Refunds are **modelled**, not initiated.

- `payment_refunds` stores one row per provider refund, unique on
  `stripeRefundId`, with amount, currency, status, provider creation time and
  the attempt it belongs to.
- Rows are written only from verified `refund.updated` and `charge.refunded`
  events, or from the audited reconciliation path after re-reading the charge.
- `order.payment.refundedAmountCents` is the sum of `succeeded` refund rows for
  that attempt. It is never derived from a browser value or an operator guess.
- Partial refunds move the order to `partially_refunded`; a total refund moves it
  to `refunded`. Both are terminal for payment purposes.
- If Stripe reports more refunded than the local rows can account for
  (`charge.amount_refunded > knownCents`), the order is flagged for review
  instead of guessing the missing amount.

Out of scope in this phase: customer refund requests, one-click refunds,
automatic refunds on cancellation, dispute or chargeback UI, and any refund
API call from this application.

## 9. Notification events

Payment events reuse the Phase 5 outbox. Each entry upserts on a unique
`(event, order reference, recipient role)` key, so a replayed webhook cannot
duplicate a message.

| Event | Recipient | Meaning |
| --- | --- | --- |
| `payment.confirmed` | customer | payment verified for the order |
| `payment.failed` | customer | payment was not completed; a retry is possible |
| `payment.requires_attention` | owner | provider and local facts need a human check |
| `payment.refund_review` | owner | a cancelled order received a verified payment |

The webhook path uses `notifyOrderEventDurably`: the idempotent outbox row is
committed **before** the event is acknowledged, so a queue failure makes Stripe
retry the event instead of silently losing the intent. Delivery itself remains
background work and can never reverse or block the financial write that already
happened.

No notification provider is configured in this phase, so entries stay `pending`
with a readable "not configured" reason and no delivery is claimed. Nothing in
the application reports a message as sent until a provider confirms it.

## 10. Money rules

- All amounts are integer Canadian cents; no floating point arithmetic.
- `amountReceivedCents` is written once, from the verified attempt amount.
- Gross collected per order = `amountReceivedCents` (falling back to the order
  total for legacy paid cash orders), counted once per order.
- Net collected = gross collected minus `refundedAmountCents`.
- Cash on Arrival counts only after an admin records it; an unpaid cash order is
  outstanding, not collected.
- Pending, failed, expired and review-required online orders are counted as
  zero collected and reported in their own counters.
