# PEARL Signature: Transactional Email

Phase 7. This document explains what the store emails, how the provider is
configured, what happens when it is not, and which parts are still unverified.

`docs/ORDER_NOTIFICATIONS.md` describes the Phase 5 outbox. This document
supersedes it where they disagree; the Phase 5 file is kept as the historical
record of the outbox's first version.

## 1. Honest starting position

The code path is complete and tested. **No real message has been sent from this
repository**, because no Resend account, verified sending domain, `EMAIL_FROM`
or `OWNER_NOTIFICATION_EMAIL` is available to this project.

That is a deliberate state, not a bug:

- With nothing configured, orders, payments, tracking and admin actions behave
  exactly as they did in Phase 6.
- Every event is still written to `notification_outbox` and stays `pending`
  with zero consumed attempts.
- `/admin/notifications` and `/admin/settings` report `Not configured` and say
  plainly that nothing has been sent.
- No surface anywhere claims a message was delivered.

## 2. Provider

The initial provider is **Resend**, free tier (3,000 messages/month, 100/day).
Only transactional messages are sent: order lifecycle, payment, and the
tracking verification code. There is no marketing, no newsletter, no SMS and no
WhatsApp.

The transport is behind a provider contract (`src/lib/notifications/contract.ts`)
so a different service can be added later without touching order, payment or
admin code:

| Module | Role |
| --- | --- |
| `config.ts` | One reader for every setting, at call time |
| `contract.ts` | `NotificationProvider`, `NotificationSendResult`, `NotificationDeliveryError` |
| `provider.ts` | Registry keyed by `NOTIFICATION_PROVIDER` |
| `providers/resend.ts` | Resend adapter (plain `fetch`, no SDK) |
| `providers/file-sink.ts` | Development/test only; writes JSONL |

The adapter never throws for a business reason: it returns a failure with a
`kind` (`transient`, `permanent`, `rate_limited`, `ambiguous`) so the processor
decides what to do. Provider error bodies are reduced to a fixed sentence before
anything is stored, because a third-party error can echo the recipient address.

## 3. Configuration

| Variable | Required | Effect when blank |
| --- | --- | --- |
| `NOTIFICATION_PROVIDER` | for sending | Not configured: nothing is sent, entries stay `pending` |
| `RESEND_API_KEY` | for Resend | Readiness reports `missing_api_key` |
| `EMAIL_FROM` | for Resend | Readiness reports `invalid_sender`; no fallback sender is invented |
| `OWNER_NOTIFICATION_EMAIL` | no | Owner alerts resolve the active owner admin account |
| `RESEND_WEBHOOK_SECRET` | no | No delivery callbacks; entries stay at `accepted` |
| `NOTIFICATION_PROCESSOR_SECRET` | for the HTTP processor | `POST /api/notifications/process` answers 503 |
| `NOTIFICATION_MONTHLY_LIMIT` | no | 3,000 |
| `NOTIFICATION_DAILY_LIMIT` | no | 100 |

`EMAIL_FROM` accepts `orders@yourdomain.com` or
`PEARL Signature <orders@yourdomain.com>`. Anything else, including an empty
string, is rejected rather than guessed.

Readiness is strict: `configured` means **a send can be attempted**, never that
something was delivered.

## 4. Events

| Event | Customer | Store | Notes |
| --- | --- | --- | --- |
| `order.placed` | yes | yes | Receipt |
| `order.confirmed` | yes | no | Essential |
| `order.preparing` | yes | no | The only muteable message |
| `order.ready_for_pickup` | yes | no | Pickup only |
| `order.out_for_delivery` | yes | no | Delivery only |
| `order.completed` | yes | no | Essential |
| `order.cancelled` | yes | no | Essential |
| `order.status_changed` | yes | no | Legacy event, still valid for old rows |
| `payment.confirmed` | yes | yes | Verified online payment |
| `payment.collected` | yes | yes | Cash recorded by the owner |
| `payment.failed` | yes | yes | Online payment not completed |
| `payment.requires_attention` | yes | yes | Under review |
| `payment.refund_review` | yes | yes | Refund needs an operator |

Identity is stable: `key = event:reference:recipientRole` with a unique index,
so a webhook replay, a retried action, a page reload or a repeated admin click
upserts the same entry instead of sending twice.

Only `order.preparing` can be muted (`notifications.preparingUpdateEnabled` in
store configuration, default on). Confirmations, handover, completion,
cancellation and payment messages always send: they are the ones a customer
would be misled by missing.

## 5. Templates

Eleven branded templates share one layout:

| Template | Plain text |
| --- | --- |
| Order received (customer) | yes |
| New order (store) | yes |
| Order confirmed | yes |
| Order preparing | yes |
| Ready for pickup | yes |
| Out for delivery | yes |
| Order complete | yes |
| Order cancelled | yes |
| Payment received / cash collected | yes |
| Payment not completed / needs review | yes |
| Tracking verification code | yes |

Design rules:

- Cream `#FDFBF7` background, navy `#1A2530` text, gold `#D4AF37` accents.
- Brand hex lives in `src/lib/notifications/email/theme.ts`. This is the
  documented exception to the "no raw hex in components" rule: email clients
  cannot consume CSS custom properties, so the values must be inlined.
- Every message has a plain-text alternative built from the same facts.
- Dynamic text is HTML-escaped (`escapeHtml`) before it reaches the markup.
- No em dashes in customer-facing copy.
- No invented facts: no delivery windows, no phone number, no address, no
  review count, no "bestseller".
- No secret, capability, grant token or processor secret is ever placed in an
  email. A tracking link carries only the public reference, which grants
  nothing on its own.

## 6. When email fails

| Situation | Result |
| --- | --- |
| Provider not configured | Entry stays `pending`, zero attempts consumed, admin warning |
| Transient provider failure | Attempt consumed, backoff, retried |
| Permanent provider failure | Entry `failed` with a sanitised reason |
| Timeout or 5xx (ambiguous) | Retried with the same idempotency key, bounded, then `uncertain` |
| Recipient cannot be resolved | `failed` with a specific reason |
| Database trouble during a scan | Entry released back to `pending`, scan stops |

An order placement, a payment confirmation or an admin action **never** fails,
rolls back or slows down because email failed. The business write either
succeeded on its own merits or it did not.

## 7. Privacy

The outbox stores no email address, name, address or message body. Recipients
resolve at dispatch time from the order or the admin collection; the rendered
message exists only in flight. Accepted entries expire 30 days after `sentAt`;
unresolved failures never expire, so a problem cannot silently disappear.

## 8. What is still unverified

- No genuine Resend delivery has been observed from this project. The adapter
  is covered by unit tests with a mocked `fetch`, and the whole pipeline is
  proven end to end against the file-sink provider, but "Resend accepts and
  delivers" remains unproven until an account exists.
- No delivery webhook has been received, so `providerStatus` has never moved
  past `accepted` in a real environment.
- The free-tier ceilings are configured from Resend's published limits, not
  measured against a live quota.

See `docs/PHASE7_REPORT.md` §N for the exact verification status.
