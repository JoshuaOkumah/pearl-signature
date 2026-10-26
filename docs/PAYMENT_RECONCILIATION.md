# PEARL Signature - Payment Reconciliation

Phase 6. How an operator compares one Stripe order against the provider's
server record, and how a verified correction is applied and audited.

Companion documents: `docs/PAYMENT_LIFECYCLE.md` (states),
`docs/STRIPE_INTEGRATION.md` (configuration), `docs/ADMIN_ORDER_OPERATIONS.md`
(the operator surfaces).

## 1. What problem this solves

Webhooks are the only normal way a payment becomes `paid`, and they can be
missed: the endpoint may have been unreachable, a delivery may have been
dropped, or a provider call may have succeeded while the local write failed.
Reconciliation is the bounded, operator-triggered repair path for exactly those
cases.

It is deliberately **not**:

- a background poller, cron job or queue worker;
- a per-request provider check on customer page loads;
- a bulk sweep over every order;
- a way to mark an order paid from a screen or a URL.

There is no scheduled reconciliation service in Phase 6, and nothing in the
application reads Stripe on a timer.

## 2. Where it lives

| Concern | File |
| --- | --- |
| Comparison and apply logic | `src/lib/payments/reconcile.ts` |
| Authorized Server Action | `src/lib/actions/payments.ts` |
| Admin control | `src/components/admin/payment-reconciliation.tsx` |
| Shared write rules | `src/lib/payments/webhooks.ts` (`reconcileVerified*`, `markReconciliationMismatch`) |

The panel appears on `/admin/orders/[id]` only for orders whose payment method
is `stripe`. Cash orders have no provider record to compare.

## 3. Two steps, always

1. **Run read-only check** (`apply=false`). Reads the provider and reports what
   it found. It writes nothing: no order field, no attempt field, no audit row.
2. **Apply verified reconciliation** (`apply=true`). Requires the admin
   two-step confirmation control, re-authorizes the session, writes the
   correction and records one audit event.

The action itself re-checks the admin session on every submission. The panel
being visible is not authority.

Audit event: `payment.reconciled`, with outcome `success` for `matched` or
`pending` and `failure` for `mismatch`, target the order reference, and a detail
line containing the result and the number of attempts checked. `unavailable` and
`not_applicable` results are not audited because nothing was applied.

## 4. What is compared

For up to the five most recent attempts of the order:

| Check | Failure code |
| --- | --- |
| Session id matches the stored session id | `provider_snapshot_mismatch` |
| Session is not `livemode` | `provider_snapshot_mismatch` |
| Session currency is `cad` | `provider_snapshot_mismatch` |
| Session `amount_total` equals the attempt amount | `provider_snapshot_mismatch` |
| Attempt amount equals the order snapshot total | `provider_snapshot_mismatch` |
| Attempt and order currency are `CAD` | `provider_snapshot_mismatch` |
| `client_reference_id` equals the order reference | `provider_snapshot_mismatch` |
| Both metadata keys match the order and attempt | `provider_snapshot_mismatch` |
| PaymentIntent currency, amount and `succeeded` status | `payment_intent_mismatch` |
| Charge currency and amount | `charge_amount_mismatch` |
| A locally paid order is settled at the provider | `local_paid_provider_not_settled` |
| A locally failed or expired order is not open at the provider | `local_failure_provider_open` |
| Refunded total can be accounted for by known refund rows | `refund_details_incomplete` |
| An attempt exists at all | `No persisted provider attempt exists...` |
| Provider reads succeed | `provider_read_unavailable` |

An attempt with no session id is reported as `unknown`
(`session_reference_missing`) and blocks applying, because the provider record
cannot be identified.

## 5. Results

| Result | Meaning | Apply behaviour |
| --- | --- | --- |
| `matched` | provider amount, currency and identifiers agree with the snapshot | verified findings are applied |
| `mismatch` | a value disagrees, or local paid state has no provider settlement | no financial change; the attempt and order are flagged for review |
| `pending` | Stripe could not verify every attempt (read failure) | nothing is applied |
| `not_applicable` | invalid reference, unknown order, or a non-Stripe order | nothing is applied |
| `unavailable` | Stripe test-mode configuration is not ready, or the run failed | nothing is applied |

The report also returns the attempt count, the provider-confirmed paid amount
and the provider-confirmed refunded amount, so the operator can compare them
with the order totals without reading Stripe.

## 6. What applying actually does

Only for findings that passed every check:

| Finding | Write |
| --- | --- |
| paid session | attempt `succeeded`; order `paid` with `amountReceivedCents`, `paidAt`, session and intent ids; `payment.confirmed` notification |
| paid session with refunds | refund rows upserted from the charge, totals recomputed, status `partially_refunded` or `refunded` |
| expired session | attempt `expired`; order `expired` if that session is the current one |
| completed but unsettled session | order `processing` |
| still-open session | attempt marked `open` and `matched` |

Then the order is stamped `reconciliationStatus: matched` with
`lastReconciledAt`.

Writes reuse the webhook functions rather than duplicating them, so the same
monotonic guards apply: reconciliation cannot downgrade a paid order, cannot
set `paid` without a matching amount and currency, and cannot exceed the
received amount with refunds.

## 7. When to reconcile

Use the read-only check when:

- the owner received a Stripe payment notification for an order that still
  shows `awaiting_payment`, `processing` or `expired`;
- the webhook endpoint was down, redeployed or misconfigured during a payment;
- the order shows **Review required**;
- the dashboard's **Paid online** figure disagrees with the Stripe dashboard for
  a specific order;
- a refund appears in Stripe but **Confirmed refunds** has not moved.

Do not use it to:

- "fix" an amount. A mismatch is a signal to investigate, not to overwrite;
- mark a cash order paid (that is the Cash on Arrival action);
- replace the webhook endpoint. A healthy endpoint is still the primary path.

## 8. Safety properties

- Read-only by default: `apply` is a separate submission and must be `"true"`.
- Every admin submission re-authorizes; no anonymous or customer path exists.
- Provider facts are re-read inside the apply run, not trusted from the earlier
  dry run.
- A mismatch always wins: one bad attempt prevents applying anything for that
  order and flags review.
- No secret, key, raw payload or provider message is returned to the browser or
  written to the audit log.
- The check is bounded to one order and five attempts, so it cannot become a
  bulk provider sweep.
- Stripe credentials are required; without readiness the run reports
  `unavailable` and changes nothing.

## 9. Known limits

- There is no CLI reconciliation command and no scheduled job; an operator must
  open the order.
- A provider read failure leaves the result `pending`, which is honest but
  requires a retry later.
- Reconciliation repairs state the provider still knows about. A session
  deleted from the Stripe account cannot be reconstructed, and the order stays
  in review for manual handling.
- Refunds are still performed in the Stripe dashboard. Reconciliation records
  them; it never creates them.
