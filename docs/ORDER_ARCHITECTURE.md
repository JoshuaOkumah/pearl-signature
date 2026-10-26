# PEARL Signature - Order Architecture

Phase 5. This is the map of how a checkout submission becomes a durable
order, what the server trusts, and where every rule lives.

Companion documents: `docs/ORDER_LIFECYCLE.md` (state changes),
`docs/CASH_ON_ARRIVAL.md` (payment), `docs/ADMIN_ORDER_OPERATIONS.md` (the
operator surfaces), `docs/ORDER_NOTIFICATIONS.md` (outbox),
`docs/BUSINESS_CONFIGURATION.md` (owner-managed configuration).

## 1. Scope and boundaries

Phase 5 adds: order placement, Cash on Arrival, the order lifecycle, admin
order management, notification outbox, and the public rate limiting around
both endpoints.

Phase 5 does not add: Stripe or any card handling, refunds, customer
accounts, discounts or gift cards, inventory reservation beyond product
availability, or deployment. There is no code path that takes money online.

## 2. File map

| Concern | File |
| --- | --- |
| Order document, indexes | `src/models/order.ts` |
| Shared constants and request/response schemas | `src/lib/validations/order.ts` |
| Placement pipeline | `src/lib/orders/create.ts` |
| Public Server Actions | `src/lib/actions/orders.ts` |
| Admin Server Actions | `src/lib/actions/admin-orders.ts` |
| Lifecycle rules | `src/lib/orders/lifecycle.ts` |
| Rate limiting | `src/lib/orders/rate-limit.ts`, `src/models/order-attempt.ts` |
| Pricing (browser and server) | `src/lib/checkout/pricing.ts` |
| Checkout attempt / capability keys | `src/lib/checkout/attempt.ts` |
| Dashboard and list queries | `src/lib/repositories/admin.ts` |
| Notification outbox | `src/lib/notifications/*`, `src/models/notification-outbox.ts` |
| Owner configuration | `src/lib/store/config.ts`, `src/models/store-config.ts` |

Isomorphic modules (`src/lib/validations`, `src/lib/checkout/pricing`,
`src/lib/orders/lifecycle`) never import mongoose, so the browser bundle
stays free of database code and the model imports its constants from them.

## 3. The request contract

`placeOrderRequestSchema` is the complete allowlist. Anything else is
stripped by Zod before the pipeline sees it.

| Field | Meaning |
| --- | --- |
| `idempotencyKey` | 32-64 hex characters, generated in the browser per checkout attempt |
| `confirmationKey` | 32-64 hex characters, the guest confirmation capability |
| `expectedTotalCents` | The total the customer reviewed. Never used to price anything |
| `items` | The bounded, price-free cart contract (slug, variant, quantity) |
| `customer` | The Phase 4 checkout form, re-validated server-side |
| `paymentMethod` | Closed enum, one member: `cash_on_arrival` |

There is no field named `paid`, `paymentStatus`, `status`, `price` or
`total`. A forged "payment succeeded" or "status: completed" simply does not
parse.

## 4. Placement pipeline

`createOrder` executes these steps in order and stops at the first failure:

1. **Configuration readiness.** Re-read the owner's store configuration.
   Order intake must be enabled, a fulfilment method must be offered, and
   the tax treatment must be configured. Anything missing returns `blocked`
   with the specific blocker, before any catalogue work.
2. **Authoritative re-quote.** `quoteCart` re-reads the live catalogue: each
   product must exist, be published, be available, sit in an active
   category and still carry a price. Any problem returns `cart_issue` with
   per-line detail (or `unavailable` when the catalogue cannot be read).
3. **Recompute totals.** `priceCheckout`, the same pure function the browser
   preview ran, computes subtotal, delivery fee, tax and total in integer
   cents from owner configuration.
4. **Price-change gate.** If the recomputed total differs from
   `expectedTotalCents`, the response is `price_changed` with the new
   totals. No order is written. The customer's number never becomes the
   order's number.
5. **Idempotency pre-check.** Look up `idempotencyKey`. A hit with the same
   intent hash is a replay; a hit with a different intent hash is `conflict`.
6. **Snapshot and insert.** Build the document from server data only
   (catalogue names, variant, unit price, configured fee, configured tax,
   generated reference), then insert under unique indexes.

Reference generation is `PS-` plus 10 uppercase hex characters from
`randomBytes(5)`, so references are unpredictable and URL-safe.

## 5. What is stored

Everything a customer agreed to is frozen at creation. Nothing on an order
reads back from `products`, so editing or archiving a product later never
rewrites history.

| Group | Contents |
| --- | --- |
| Identity | `reference`, `idempotencyKey`, `idempotencyHash`, `confirmationKeyHash` |
| Customer | name, email, phone (exactly these three) |
| Fulfilment | method, address block or null, instructions, notes, service area label, pickup instructions |
| Items | product id, slug, name at purchase, variant, quantity, unit price, line total, image reference |
| Money | currency `CAD`, subtotal, delivery fee, tax, total, tax label, tax rate in basis points |
| Payment | method, status, paidAt, paidByAdminId, paidByLabel |
| Lifecycle | status, statusHistory, cancellationReason, notes, `version` |

A schema-level validator requires `subtotal + deliveryFee + tax === total`,
so an inconsistent money block cannot be persisted even by a code mistake.

## 6. Idempotency

The browser generates a fresh unpredictable `idempotencyKey` per checkout
attempt (`src/lib/checkout/attempt.ts`) and reuses it for retries of the
same intent.

- **Unique index** on `idempotencyKey`: two concurrent identical
  submissions cannot both insert.
- **`idempotencyHash`** is a sha256 of the canonical intent: sorted lines,
  customer details, fulfilment, payment method. It deliberately EXCLUDES
  `expectedTotalCents`, so a legitimately re-priced retry is a replay rather
  than a conflict.
- **Duplicate key on insert** is not an error: the existing order is read
  back and returned with `replayed: true`, so a lost response still lands
  the customer on their real confirmation.
- **Same key, different intent** returns `conflict`, which the client
  resolves by generating a fresh attempt key and retrying once.

A double-click, a retried request and a browser resubmission all converge on
exactly one order.

## 6a. Price safety

The browser computes a preview with the same `priceCheckout`, but that
preview is a convenience, never an authority. Two guards:

- The server recomputes and compares against `expectedTotalCents`.
- On mismatch the client shows the price-change panel: the new amount, the
  statement that the order was not submitted, and an explicit
  acknowledgment control. Only after acknowledgment can the customer submit
  again, at the new amount they have now seen.

Playwright scenario B tampers with `expectedTotalCents` on the wire and
proves no order exists afterwards.

## 7. Guest confirmation capability

`/order-confirmation?ref=PS-XXXXXXXXXX` carries only the public reference.

- The browser holds a 32-byte capability in `sessionStorage`
  (`pearl-confirmations-v1`, entries of `{ reference, key, at }`).
- The server stores only `sha256(key)` on the order.
- Lookup matches `reference + confirmationKeyHash` in one query.

Consequences: a shared or leaked link opens nothing, references cannot be
enumerated (malformed reference and wrong key return the same neutral
`not_found`), and the capability never appears in a URL, a referrer header
or a log line. The confirmation view deliberately excludes customer PII: it
shows items, money, fulfilment method, payment state and status only.

Client-side states are explicit: `missing_reference`, `no_capability`,
`not_found`, `rate_limited`, `unavailable`.

## 8. Rate limiting

`consumeOrderRateLimit` uses the same design as the Phase 3 login limiter
(atomic upsert with `$inc`, hashed key, TTL expiry) in a SEPARATE
`order_attempts` collection so the two budgets can never consume each
other.

| Scope | Trigger | Limit |
| --- | --- | --- |
| `order.create` | every place-order attempt | 10 per 15-minute window per address |
| `order.lookup` | every confirmation read | 30 per 15-minute window per address |

Properties: counted on attempt rather than on success (failing does not buy
budget), fail-closed when the database read fails, and the counter runs
BEFORE the Zod parse so malformed payloads still cost an attempt.

Known limitations, stated rather than hidden: one address behind NAT shares
a bucket, and the TTL sweep runs on MongoDB's background pass, so an expired
bucket can survive up to about 60 seconds past its window.

## 9. Admin write paths

Both admin order actions follow one contract:

```
requireActionAdmin -> Zod allowlist -> load the order fresh
  -> lifecycle or payment rules decided from THAT record
  -> update filtered by { _id, reference, version }
  -> audit entry -> honest result object
```

The button list on screen is a convenience rendered from
`availableTransitions`. The authority is `transitionRejection` executed
server-side against the freshly loaded status and fulfilment method.

Every mutation re-authorizes. `requireActionAdmin` resolves the session
cookie against MongoDB on each call, so a stolen form post with an expired
session returns `Your session has expired. Please sign in again.`

## 10. Notifications hook

Order creation awaits an idempotent outbox enqueue for `order.placed`
(customer and owner), and status changes enqueue `order.status_changed`
(customer). Delivery runs in the background, bounded and never throwing, so
a notification problem cannot fail a business write. Full behaviour in
`docs/ORDER_NOTIFICATIONS.md`.

## 11. Where personal data is allowed

| Location | Personal data |
| --- | --- |
| `orders` document | name, email, phone, address (needed to fulfil) |
| `notification_outbox` | none: recipients resolve at send time |
| Rate-limit buckets | hashed address only |
| Logs | none: actions log error categories, never payloads |
| Confirmation view | none |
| Audit log | operator email and order reference |

## 12. Testing map

| Layer | File |
| --- | --- |
| Placement pipeline | `src/lib/orders/create.test.ts` |
| Lifecycle rules | `src/lib/orders/lifecycle.test.ts` |
| Admin actions | `src/lib/actions/admin-orders.test.ts` |
| Dashboard metrics | `src/lib/repositories/admin-orders.test.ts` |
| Validation contracts | `src/lib/validations/order.test.ts` |
| Notification dispatch | `src/lib/notifications/dispatch.test.ts` |
| End-to-end scenarios A to E | `e2e/orders/orders.spec.ts` |
