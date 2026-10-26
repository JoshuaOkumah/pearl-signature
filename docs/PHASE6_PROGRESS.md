# PEARL Signature: Phase 6 Progress

Status: **6A inspection/specification complete. No payment implementation
has started. Live payment activation and deployment are prohibited.**

## Initial repository inspection

- Branch: `main`; HEAD at inspection: `582a23d` (Phase 5F); working tree was
  clean. No local work was discarded or reset.
- Read the repository `AGENTS.md` and the nested `node_modules/next/AGENTS.md`.
  Next 16 Route Handler guidance was read at
  `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/route.md`.
  It specifies standard Web `Request` APIs and `await request.text()` for a
  webhook raw body, with no Pages Router body-parser configuration. Route
  responses use Web `Response`, and this project requires Node runtime for
  Mongoose/Stripe.
- Read `PROJECT_SPEC.md`, `PHASE_PROGRESS.md`, `PHASE5_REPORT.md`,
  `BUSINESS_CONFIGURATION.md`, `MANUAL_TESTING.md`, `ADMIN_OPERATIONS.md`,
  `DATABASE_SCHEMA.md`, and Phase 5 order, payment, checkout, confirmation,
  admin, notification and test architecture.

## Phase 5 integration points and discovered blockers

1. `src/lib/orders/create.ts` is the single authoritative insert pipeline.
   It re-reads store config, quotes products, applies `priceCheckout`, checks
   reviewed total and creates the frozen snapshot. Reuse it; do not create a
   competing order service.
2. `src/lib/validations/order.ts` and `src/models/order.ts` currently permit
   only `cash_on_arrival` and payment status `unpaid|paid`; payment records
   only `paidAt` and manual admin identity. Explicit extension is required.
3. `createOrder` persists selected method but has no Stripe authorization or
   session state. Current `placeOrderAction` handles public rate limiting and
   `placeOrderRequestSchema`; guest capability is generated in browser by
   `src/lib/checkout/attempt.ts` and only the hash is stored.
4. `loadOrderConfirmationAction` authorizes read by `(reference,
   confirmationKey)` and returns a deliberately small DTO. It can be extended
   to expose payment status without PII. Capability currently exists only in
   browser sessionStorage, which Stripe return must preserve without putting
   it in URLs or metadata.
5. `src/lib/actions/admin-orders.ts` has the only manual paid write and is
   intentionally COA-only. Keep it COA-only. `OrderActions` should only show
   that control for COA.
6. `getDashboardStats` groups all `payment.status=paid` totals together and
   labels them collected. This is insufficient for multiple methods and
   refunds; reporting must distinguish online settlement, COA collection,
   outstanding/failed/pending and verified refunded/net amounts.
7. `src/lib/notifications/{templates,dispatch}.ts` supports only order
   placement/status. Add idempotent payment events through the existing
   outbox; no live provider exists and enqueue must not block settlement.
8. `store_configs` has order intake/fulfilment/tax only and defaults intake
   off. Add a default-off online-payment business switch/readiness projection;
   environment keys alone cannot open it. Test-only config stays isolated in
   `scripts/e2e-orders-server.ts`.
9. Checkout is a single Cash on Arrival boolean in
   `src/components/checkout/checkout-client.tsx`. Existing Phase 5 e2e runs
   use isolated memory Mongo; no Stripe SDK or payment route exists.
10. No transactions are assumed for Atlas M0. Payment attempts must reserve
    one active attempt before calling Stripe, reuse a stable Stripe
    idempotency key after uncertain outcomes, and permit webhook/reconciliation
    recovery if provider success and local persistence are separated.

## Next.js 16 cache findings

- The project's `cacheComponents: true` and `partialPrefetching: true` are
  enabled. The bundled `08-caching.md` says uncached database reads should
  remain request-time work and not be put under `use cache`; payment-sensitive
  status therefore stays in Server Actions/POST handlers and request-rendered
  page data, never a shared cache.
- The bundled `15-route-handlers.md` and API reference `route.md` establish
  that route handlers use Web Request/Response. `POST` handlers are not
  cached; when Cache Components is on, `GET` may be prerendered if static, so
  any payment-status GET must be explicitly request-dependent or avoided.
  Webhook uses POST and `await request.text()` exactly once before SDK
  signature construction. Sensitive responses set explicit private/no-store
  headers even on POST.
- Route handlers are public API endpoints and must independently validate
  access; layouts do not wrap route handlers. Stripe webhook therefore uses
  signature verification, while payment initiation uses capability
  authorization.

## 6A decision record

- The Phase 5 implementation has a sound extension point: payment method is
  already part of the same order snapshot/intention hash and `createOrder`
  performs all amount-affecting checks. Stripe initialization follows that
  insert; it does not accept client totals or create an independent order.
- The `unpaid|paid` status cannot encode provider pending/failure/refund and
  manual COA attribution simultaneously. Extend the one canonical payment
  subdocument and retain each provider session as a separate attempt record;
  do not repurpose lifecycle `status` or permit Stripe through the COA admin
  action.
- Phase 5 admin revenue aggregation counts any paid order's full total. Phase
  6 must derive gross collections from one successful payment attempt per
  order and COA's admin-confirmed amount, then subtract only trusted recorded
  refunds. Failed attempts have no revenue effect.
- No Atlas transaction is assumed: attempt reservation and provider
  idempotency are persisted before API call, and verified events/reconciliation
  repair incomplete writes. This must be race-tested against MongoDB, not only
  mocked.
- Phase 6 may extend settings with online payment default-off. Order intake
  remains independently default-off. Even a business toggle plus environment
  values is insufficient for live mode; test keys only are accepted in this
  phase.

## Architectural decisions (provisional, to validate in 6A)

- Online orders still enter through the single Phase 5 order service with
  `paymentMethod: stripe`; immutable order total is the Stripe amount.
- Add dedicated durable `payment_attempts` and Stripe event records if their
  unique indexes and history are needed for safe concurrency/replay. Keep the
  order's payment state as the one customer/admin status, not a second
  competing payment status store.
- Capability-protected payment initiation via same-origin POST body; never
  use the reference or Stripe session ID alone as authorization. Keep
  success/cancel URLs capability-free and allow same browser to recover via
  sessionStorage.
- Default-off explicit readiness gates include business setting and a
  server-side test-mode environment switch. Reject live secret keys and live
  webhook events in this phase.
- Webhook handling is a Node App Router Route Handler. Read `request.text()`
  once and call Stripe SDK signature construction. The verified event's
  provider references, amount/currency and persisted attempt must all match.
- Exact Stripe line-item representation and nontransactional recovery are to
  be documented/tested before enabling checkout. No Stripe Tax.

## Milestones

| Milestone | State | Verification / notes |
| --- | --- | --- |
| 6A Specification and architecture | Complete | Spec, progress, Phase 5 integration map, Next 16 route/cache guidance; baseline `npm run test`: 686/686 across 48 files |
| 6B Checkout initialization | Not started | |
| 6C Webhooks and payment state | Not started | |
| 6D Customer and admin experience | Not started | |
| 6E Reconciliation and edge cases | Not started | |
| 6F Verification and report | Not started | |

## Verification log

No Phase 6 code or tests have run yet. Record commands, exact counts,
credentials availability (never values), genuine Stripe test verification
level, screenshot review, commits and remaining blockers below as work
progresses.
