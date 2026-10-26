# PEARL Signature - Cash on Arrival

Phase 5, Milestone C. Cash on Arrival is the only payment method in this
phase. Nothing is charged online, no card data exists anywhere in the
project, and no Stripe code is present.

## 1. What the customer sees

During checkout the customer chooses how they will pay before they can place
the order. In Phase 5 there is exactly one option:

- The payment panel states plainly that nothing is paid online.
- The order is submitted with `payment.method = "cash_on_arrival"` and
  `payment.status = "unpaid"`.
- The confirmation page repeats the amount due (`amount due on arrival`) so
  the customer knows what to hand over.

The customer never sends a payment result. There is no field, no payload and
no action through which a browser could claim an order was paid.

## 2. What the owner does

Money is received physically, at handover, and the operator records it:

1. Open `/admin/orders/<reference>`.
2. Under the payment section, press **Record payment received**.
3. Press **Confirm payment received** (the control is two-step, like every
   significant admin action).
4. The page reports `Payment recorded for this order.`

That single action is the only path to `payment.status = "paid"` in Phase 5.

## 3. Why the form carries no amount

The recording form submits only `{ reference, expectedVersion }`. It cannot
carry a price, because there is nothing to disagree with: the order already
stores its own total. The audit entry records the stored total in cents, so
what was logged always equals what the order says.

## 4. Rules enforced server-side

`recordPaymentAction` runs the standard contract: session guard, Zod
allowlist, fresh read, then the versioned update.

| Situation | Result |
| --- | --- |
| Signed out / session expired | `Your session has expired. Please sign in again.` |
| Unknown reference | `That order could not be found. Reload the page and try again.` |
| Stale `expectedVersion` | `This order changed while you were viewing it. Reload the page to see the current state.` |
| Already paid | `Payment has already been recorded for this order.` |
| Success | `payment.status = "paid"`, `paidAt`, `paidByAdminId`, `paidByLabel`, `version + 1` |

The update filter itself carries `"payment.status": "unpaid"`, so a second
concurrent request cannot pay the same order twice even if it guessed a
current version. Playwright scenario C proves this with a second browser
window whose version token is deliberately refreshed to the current value:
the second record is still refused.

Payment recording never changes `status`, and completing or cancelling an
order never changes `payment.status`.

## 5. Dashboard accounting rules

The dashboard reads real order records only. Under `docs/BUSINESS_CONFIGURATION.md`
these are the exact definitions:

| Metric | Definition |
| --- | --- |
| Orders | Every order, all time, including cancelled ones |
| In progress | Orders whose status is not `completed` and not `cancelled` |
| Awaiting payment | Unpaid AND not cancelled |
| Outstanding | Sum of totals of unpaid AND not cancelled orders |
| Collected | Sum of totals of orders whose `payment.status` is `paid` |

Two consequences that are deliberate:

- An unpaid Cash on Arrival order is money owed, not money collected.
- A cancelled unpaid order drops out of outstanding money while still
  counting as an order.

Collected counts a paid order even if it was later cancelled, because the
cash really did change hands.

## 6. What is deliberately absent

- No card entry, no card tokens, no payment intent, no webhook.
- No partial payment, no deposit, no tip, no currency conversion.
- No refund recording: Phase 5 never takes money online, so there is
  nothing to refund through the system.
- No invented fee, tax or amount. Tax and delivery fees come from the
  owner's own configuration, or the checkout stays blocked.
