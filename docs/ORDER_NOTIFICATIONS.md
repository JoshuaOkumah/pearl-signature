# PEARL Signature - Order Notifications

Phase 5, Milestone E. This document describes what is notified, how
delivery works, what happens when no provider is configured, and which
limitations are real.

## 1. Honest starting position

Phase 5 ships no third-party integration: no email API key, no SMTP
credentials, no vendor SDK, no scheduler. What exists is a complete,
tested pipeline with an empty transport registry, so the business can pick a
provider later without touching order logic.

Nothing in this system pretends to send a message that it did not send.

## 2. Events and recipients

| Event | Customer | Store |
| --- | --- | --- |
| `order.placed` | yes | yes |
| `order.status_changed` | yes | no (the operator made the change) |

The store recipient is the active owner admin, resolved at send time. The
customer recipient is the order's email, resolved at send time.

Messages state facts drawn only from the stored order: reference, status,
fulfilment method, total and the customer's name. There are no delivery
windows, no marketing claims and no contact details the business has not
configured. Money always renders through `formatCad`.

There are deliberately no links: the guest confirmation URL needs a secret
capability that only the placing browser holds, so a notification cannot
honestly build one.

## 3. The outbox

Every event first writes an entry to `notification_outbox`, then delivery is
attempted afterwards.

| Property | Value |
| --- | --- |
| Idempotency key | `${event}:${reference}:${recipientRole}` with a unique index |
| Statuses | `pending`, `sent`, `failed` |
| Attempts counter | counts FAILURES only; a success ends the entry |
| Maximum attempts | 5, then the entry is parked as `failed` |
| Retention | entries are deleted 30 days after creation |
| Batch size | 10 entries per scan |
| Personal data stored | none |

Because enqueue upserts on the unique key, a replayed order placement or a
retried admin action can never double-notify.

## 4. Why persistence is independent of delivery

`createOrder` and `changeOrderStatusAction` AWAIT only the enqueue, then
start delivery in the background. Enqueueing itself swallows its own errors,
and the background scan never rejects.

The consequence is a hard guarantee: a notification problem cannot fail,
roll back or slow down an order placement or an operator's status change.
The business write either succeeded on its own merits or it did not.

## 5. Delivery model, stated honestly

There is no cron and no queue worker in Phase 5. Attempts happen
opportunistically: whenever an order event enqueues new work, the same
request scans for due `pending` entries (bounded to 10), and backoff pushes
the rest to a later scan. An entry whose next attempt lands between scans
waits for the next order event.

This is adequate for a low-volume store and is a known limitation for a
high-volume one. No scheduler is implied where none exists.

Backoff after a failure: 60 seconds, 2 minutes, 4 minutes, 8 minutes,
capped at one hour. The pure function is `nextAttemptDelayMs`.

## 6. Configuration states

`NOTIFICATION_PROVIDER` decides one of three states:

| Value | Behaviour |
| --- | --- |
| Blank (the Phase 5 default) | Not configured. Entries stay `pending` with zero attempts, `lastReason` reads `Notification provider not configured`, and their next attempt is pushed 15 minutes forward |
| A registered name | Configured. `send()` resolves on success and the entry becomes `sent` |
| An unknown but non-blank name | Configured but unsupported. Sending raises a non-retryable error, so a typo surfaces as an honest `failed` entry with a readable reason instead of retrying forever |

The registry (`REGISTRY` in `src/lib/notifications/provider.ts`) is empty in
Phase 5 on purpose: the project rules forbid wiring a service before the
business picks one. A later phase adds one line such as
`registry["postmark"] = () => postmarkProvider()`.

## 7. Failure handling

- A delivery failure increments `attempts`, stores a reason and schedules a
  retry with backoff.
- After 5 failures, or on any non-retryable error, the entry becomes
  `failed` with the reason kept for the operator.
- Infrastructure trouble reading the order or writing the entry leaves the
  entry `pending` without consuming a retry.
- An entry whose order no longer exists, or whose recipient cannot be
  resolved (no customer email, no active owner admin), is settled as
  `failed` with a specific reason.

## 8. Privacy

The outbox stores no email, no name, no address and no message body.
Recipients resolve at dispatch time from the order and the admin collection,
and the rendered message exists only in flight. Provider error messages are
replaced with a fixed sentence before anything is stored, because a
third-party error might echo the recipient address.

That is also why a 30-day TTL over a collection holding no personal data is
safe on a shared Atlas M0 database.

## 9. Verification

`src/lib/notifications/dispatch.test.ts` covers enqueue idempotency, the
three configuration states, backoff arithmetic, attempt exhaustion,
non-retryable failures, missing recipients and the never-throwing contract.
`docs/PHASE5_REPORT.md` records the executed results.
