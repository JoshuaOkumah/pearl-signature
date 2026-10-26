# PEARL Signature: Phase 5 Report

Phase 5 turns the review-only checkout into a working order flow: owner-managed
configuration, real order records in MongoDB, Cash on Arrival, the order
lifecycle, the owner's order screens, guest confirmation and public rate
limits. The work is implemented and awaiting business review.

**Methods to validate:** run `npx next typegen`, `npm run typecheck`,
`npm run lint`, `npm run test`, `npm run build`, `npm run test:e2e` and
`npm run screenshots` from the repository root, then read the captures in
`screenshots/` at 320, 360, 390, 667 (landscape), 768, 1024 and 1440 pixels
wide, and follow the nontechnical walkthrough in `docs/MANUAL_TESTING.md`.
Behavioural detail lives in `docs/ORDER_ARCHITECTURE.md`,
`docs/ORDER_LIFECYCLE.md`, `docs/CASH_ON_ARRIVAL.md`,
`docs/ADMIN_ORDER_OPERATIONS.md`, `docs/ORDER_NOTIFICATIONS.md` and
`docs/BUSINESS_CONFIGURATION.md`.

## A. Summary and status

Phase 5 implements order placement end to end for Cash on Arrival: a guest
submits an order, the server re-prices it against the live catalogue, stores a
frozen snapshot with a unique reference, and the owner manages it through
`/admin/orders` and `/admin/orders/[id]`. The guest sees the confirmation
through an opaque capability that only the placing browser holds. The phase is
implemented and awaiting business review. It does not take card payments and
is not deployed.

## B. Approved scope

Included: owner-managed business configuration (intake switch, delivery areas
and fees, pickup instructions, tax treatment), server-authoritative order
creation with idempotency and optimistic concurrency, Cash on Arrival
recording, the full order lifecycle with validation and cancellation reasons,
admin order list, detail and dashboard metrics, guest confirmation capability,
public rate limiting, a provider-agnostic notification outbox, regression
tests, screenshots and documentation.

Excluded by boundary: Stripe or any card handling, refunds, customer
accounts, discounts or gift cards, inventory beyond availability, a
registered notification provider, and deployment. No prices, fees, tax rates,
addresses, hours or contact details were invented.

## C. Business configuration and checkout readiness

Configuration lives in a single `store_configs` document with three tax modes:
`unconfigured`, `zero` and `rate`. Nothing is hardcoded. Delivery areas carry
their own fees, pickup carries owner-written instructions, and tax is either
explicitly zero or an owner-supplied rate applied with half-up rounding on
integer cents. While tax treatment is `unconfigured`, live submission is
blocked with a stated reason and no Place order control is offered. Synthetic
end-to-end runs use a configuration that is clearly labelled as test data.
See `docs/BUSINESS_CONFIGURATION.md`, which ends with the manual
pre-launch checklist.

## D. Order creation pipeline

The submission Server Action runs a fixed sequence: rate-limit check, Zod
allowlist parse, configuration read, cart re-quote against the live catalogue,
server-side repricing with the same pure `priceCheckout` the browser
previewed, then a single insert. Client-supplied prices, subtotals, fees, tax,
totals and payment-success flags are never trusted; only identifiers,
quantities, customer details and fulfilment choice are accepted. The stored
order freezes item names, options, unit prices, fee, tax, total and the
configuration snapshot, so editing a product later never rewrites history.
Every order gets a unique public reference of the form `PS-` plus ten hex
characters.

## E. Idempotency and concurrency

The browser generates an unpredictable 32-byte checkout-attempt key per
attempt. A unique index on that key makes double submission impossible:
the first insert wins, a duplicate key resolves to the existing order, and a
concurrent conflict triggers one fresh-key retry. The intent signature covers
the customer, fulfilment and line identities but excludes the expected total,
so a legitimate retry after acknowledgement is not mistaken for a different
order. Admin mutations carry an `expectedVersion` that is embedded in the
update filter, so two operators racing on the same order cannot silently
overwrite each other; the loser receives a conflict message.

## F. Price safety

If the server's total differs from the total the customer reviewed, the
action returns `price_changed` with the new figures and writes nothing. The
Place order button stays disabled until the customer explicitly acknowledges
the new total, with the hint "Review the new total above to continue."
Nothing is submitted on the customer's behalf while that acknowledgement is
outstanding. All money is integer CAD cents end to end.

## G. Cash on Arrival

Payment is a separate axis from lifecycle: `payment.method` and
`payment.status` (`unpaid` / `paid`) never change the order's `status`. The
owner records receipt on the order detail page through a two-step control
that carries no amount field (the amount is whatever was ordered). A second
recording is refused even from a window holding a current version token.
Dashboard metrics count paid orders as collected regardless of cancellation,
count unpaid and not-cancelled orders as outstanding, and never present
unpaid Cash on Arrival as revenue. See `docs/CASH_ON_ARRIVAL.md`.

## H. Order lifecycle

`placed` moves to `confirmed` or `cancelled`; `confirmed` to `preparing` or
`cancelled`; `preparing` to `ready_for_pickup` (pickup only) or
`out_for_delivery` (delivery only); both of those to `completed` or
`cancelled`. The rules are method-aware, so a pickup order never sees or
accepts "Out for delivery". Invalid transitions are refused with specific
messages that distinguish the same state, a terminal state, a missing edge
and a method mismatch. Cancellation requires a reason that is stored in the
status history. Every status entry records the actor and timestamp.
See `docs/ORDER_LIFECYCLE.md`.

## I. Admin order management

`/admin/orders` lists orders with validated status, payment and fulfilment
filters plus pagination, rendering as a table on wide screens and stacked
cards on narrow ones. `/admin/orders/[id]` shows the customer and fulfilment
snapshot, item snapshot, totals, status history, operational notes (internal
only, bounded to 20) and the action panel. Cancel, complete and payment
recording each require a two-step confirmation dialog; every action
re-authorizes the session server-side, validates against a Zod allowlist,
checks the version, then the lifecycle rule, then writes an audit record.
Dashboard metrics come only from real order records. See
`docs/ADMIN_ORDER_OPERATIONS.md`.

## J. Guest confirmation

`/order-confirmation?ref=...` opens only when the browser also holds an
opaque 32-byte capability created at placement time (kept in
`sessionStorage`, never in the URL). The server stores only the hash of that
capability. A missing capability, a malformed reference and an unknown
reference all return the same neutral result that reveals nothing about
whether the order exists. The page works after a refresh, carries `noindex`
and private cache headers, and is not publicly cacheable. E2E scenario E1
proves the link is worthless on a device that holds no capability.

## K. Notifications

Order events are written to a `notification_outbox` with idempotent keys,
bounded retries with backoff, a 30-day TTL and no stored personal data
beyond what a provider needs to send one message. No provider is registered,
so entries stay `pending` with an honest "not configured" reason and the
order flow never depends on delivery. Order persistence, confirmation and
admin actions all succeed with notifications disabled. See
`docs/ORDER_NOTIFICATIONS.md`.

## L. Security, rate limits and database impact

Public order submission is limited to 10 attempts per 15-minute window per
address and confirmation reads to 30, counted per attempt in an
`order_attempts` collection with TTL expiry and hashed keys; the limit fails
closed if the store is unreachable, and it runs before parsing. Zod
allowlists bound every field (30 items per order, 40 history entries, 20
notes, a total ceiling). Admin actions re-authorize per request. Logs and
audits carry references and events, not customer payloads, and confirmation
responses are never shared-cacheable.

Four collections were added: `orders` (unique reference and idempotency-key
indexes), `store_configs` (singleton), `order_attempts` (TTL) and
`notification_outbox` (unique idempotent key, TTL). All are created through
Mongoose with `autoIndex` off and built by the seed/migration path, which is
M0-appropriate. Existing Phase 1 to 4 collections were not changed in
breaking ways; historical orders are immune to product edits by design of the
snapshot. No secrets were added to source.

## M. Test coverage and verification

| Gate | Result |
| --- | --- |
| `npx next typegen && npm run typecheck` | PASS, zero errors |
| `npm run lint` | PASS, zero errors/warnings |
| `npm run test` | PASS, **686 tests across 48 files** |
| `npm run build` | PASS, all routes present (`/admin/orders`, `/admin/orders/[id]`, `/order-confirmation`, `/admin/settings`) |
| `npm run test:e2e` | PASS, **87 tests** across storefront, cart/checkout, admin and the new `orders` project |
| `npm run screenshots` | PASS, **191 captures**, zero horizontal overflow |

Order-focused unit suites: `orders/create.test.ts` (34),
`actions/admin-orders.test.ts` (31), `notifications/dispatch.test.ts` (27),
`checkout/pricing.test.ts` (24), `validations/order.test.ts` (20),
`orders/lifecycle.test.ts` (17), `repositories/admin-orders.test.ts` (17),
`validations/store-config.test.ts` (16).

The new Playwright `orders` project (port 3003) runs a disposable
in-memory MongoDB with the real catalogue, a labelled test configuration and
four synthetic orderable products, and covers scenarios A to E: A a guest
order lands and the owner sees it; B1 an identical replay keeps one order and
B2 a total tampered with on the wire is refused before any order exists; C
payment is recorded once and counted honestly; D both lifecycles advance
legally while illegal transitions, method mismatches and stale versions are
refused; E1 the confirmation link is worthless without its capability, E2
admin pages and actions re-authorize every request, and E3 repeated
submissions are rate limited.

The screenshot gate now also captures `checkout-ready`, `checkout-pickup`,
`order-confirmation` (with and without the capability), `admin-orders`,
`admin-order-detail` and `admin-dashboard-orders` at 320, 360, 390, 667
(landscape), 768, 1024 and 1440 pixels. Every capture was visually inspected:
stacked cards replace tables on narrow screens, money rows stay inside the
viewport, and the confirmation echoes no customer details beyond what the
placing customer already typed.

## N. Owner inputs and limitations

Before real orders can be accepted, the owner must complete the manual
checklist in `docs/BUSINESS_CONFIGURATION.md`: decide whether ordering is
open, define delivery areas and fees, write pickup instructions, choose the
tax treatment (including the actual rate, which must not be guessed), and
supply business hours and contact details. A notification provider must be
chosen before any notification leaves the outbox, and the Cloudinary
cloud-name mismatch noted in earlier phases still needs an owner decision.
None of these decisions were made on the owner's behalf.

## O. Completion boundary and next approval

Phase 5 is ready for review, not for launch: nothing is deployed and no
external service is connected. Stripe or any card handling, refunds,
customer accounts, discounts, inventory management and deployment must not be
started without explicit approval for a later phase. This report and the
companion documents are the Phase 5 deliverable.
