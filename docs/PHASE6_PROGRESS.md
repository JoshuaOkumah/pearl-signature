# PEARL Signature: Phase 6 Progress

Status: **6A-6F complete in test mode. Online payment is implemented, gated off
by default, and has not been verified against a real Stripe account. Live
payments and deployment remain prohibited.**

Final report: `docs/PHASE6_REPORT.md`. Specification snapshot:
`docs/PHASE6_SPEC.md`. Operator and integration guides:
`docs/STRIPE_INTEGRATION.md`, `docs/PAYMENT_LIFECYCLE.md`,
`docs/PAYMENT_RECONCILIATION.md`.

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
   the reviewed total and creates the frozen snapshot. Reuse it; do not create
   a competing order service.
2. `src/lib/validations/order.ts` and `src/models/order.ts` originally permitted
   only `cash_on_arrival` and payment status `unpaid|paid`; payment records
   only `paidAt` and manual admin identity. Explicit extension was required.
3. `createOrder` persists the selected method but has no Stripe authorization or
   session state. Guest capability is generated in the browser by
   `src/lib/checkout/attempt.ts` and only the hash is stored.
4. `loadOrderConfirmationAction` authorizes reads by `(reference,
   confirmationKey)` and returns a deliberately small DTO.
5. `src/lib/actions/admin-orders.ts` has the only manual paid write and is
   intentionally COA-only. It stays COA-only.
6. `getDashboardStats` originally grouped all paid totals together and labelled
   them collected. Phase 6 splits online settlement, COA collection,
   outstanding, pending, failed, refunds and net.
7. `src/lib/notifications/{templates,dispatch}.ts` originally supported only
   order placement/status. Payment events now use the same outbox.
8. `store_configs` originally had order intake/fulfilment/tax only. Phase 6 adds
   a default-off `payments.onlineEnabled` switch.
9. Checkout was a single Cash on Arrival boolean. It is now a two-option choice
   with an honest unavailable state.
10. No transactions are assumed for Atlas M0. Attempt reservation and provider
    idempotency are persisted before the Stripe call, and verified events plus
    reconciliation repair incomplete writes.

## Next.js 16 cache findings

- `cacheComponents: true` and `partialPrefetching: true` are enabled. Payment
  status is never cached: it is read in Server Actions, POST handlers and
  request-rendered pages.
- Route handlers use Web `Request`/`Response`. The webhook `POST` reads
  `request.arrayBuffer()` once and passes the raw bytes to the SDK.
- `export const runtime = "nodejs"` is **not** allowed with `cacheComponents`;
  the build rejects it. Node is the default App Router runtime, so the webhook
  route omits the export (see the comment in the route file).
- Route handlers are public endpoints and must authorize themselves. The webhook
  verifies a signature; payment initiation verifies a guest capability.

## 6A decision record

- Stripe initialization follows the Phase 5 insert; it never accepts client
  totals and never creates an independent order.
- The one canonical payment subdocument is extended rather than repurposed.
  Lifecycle `status` and `payment.status` stay independent.
- Revenue is derived from one successful attempt per order plus verified
  refunds, not from "any paid order's total".
- Attempt reservation and idempotency are durable before the provider call, so
  ambiguous outcomes are recoverable without a second charge.
- Online payment is default-off and requires both an environment switch and an
  owner-managed business switch. Live keys are rejected.

## Implemented architecture

| Concern | Location |
| --- | --- |
| Readiness gate, SDK client | `src/lib/payments/stripe.ts` |
| Session creation, reservation, retry, recovery | `src/lib/payments/service.ts` |
| Verified events, refunds, reconciliation adapters | `src/lib/payments/webhooks.ts` |
| Webhook route | `src/app/api/stripe/webhook/route.ts` |
| Monotonic state helpers | `src/lib/payments/state.ts` |
| Reconciliation service | `src/lib/payments/reconcile.ts` |
| Public actions | `src/lib/actions/orders.ts` |
| Admin reconciliation action | `src/lib/actions/payments.ts` |
| Collections | `src/models/payment-attempt.ts`, `src/models/stripe-event.ts`, `src/models/payment-refund.ts` |
| Enums, labels, schemas | `src/lib/validations/order.ts` |
| Checkout choice | `src/components/checkout/checkout-client.tsx` |
| Confirmation states | `src/components/checkout/order-confirmation.tsx` |
| Admin payment panel, attempts, refunds, reconciliation | `src/app/admin/(dashboard)/orders/[id]/page.tsx`, `src/components/admin/payment-reconciliation.tsx` |
| Financial dashboard split | `src/lib/repositories/admin.ts`, `src/app/admin/(dashboard)/page.tsx` |
| Owner switch and readiness panel | `src/app/admin/(dashboard)/settings/page.tsx`, `src/components/admin/store-settings-form.tsx` |

## Milestones

| Milestone | State | Verification / notes |
| --- | --- | --- |
| 6A Specification and architecture | Complete | Spec, progress, Phase 5 integration map, Next 16 route/cache guidance; baseline `npm run test`: 686/686 across 48 files |
| 6B Checkout initialization | Complete | Readiness gate, attempt reservation, stable idempotency key, reuse/expire/recover, rate limit, snapshot re-check; covered by `src/lib/payments/payments.test.ts` |
| 6C Webhooks and payment state | Complete | Signature-verified route, durable event ledger, monotonic transitions, refund records, late-success review, notifications |
| 6D Customer and admin experience | Complete | Checkout payment choice with honest unavailable state, confirmation pending/paid/failed/retry/refund states, admin payment detail, attempts, refunds, dashboard split, settings switch |
| 6E Reconciliation and edge cases | Complete | Dry-run default, two-step audited apply, mismatch/review handling, docs set |
| 6F Verification and report | Complete | Full gate run, screenshot review, `docs/PHASE6_REPORT.md` |

## Verification log

All commands run from the repository root on the final tree.

| Command | Result |
| --- | --- |
| `npx next typegen` | Types generated successfully |
| `npm run typecheck` | No errors |
| `npm run lint` | No errors or warnings |
| `npm run test` | 713 passed, 52 files |
| `npm run build` | Production build succeeded; `/api/stripe/webhook` is dynamic |
| `npm run test:e2e` | 88 passed, 4 projects |
| `npm run screenshots` | All captures written; no horizontal overflow at any viewport |

Credentials availability (names only, never values): `STRIPE_SECRET_KEY`,
`STRIPE_WEBHOOK_SECRET`, `STRIPE_PAYMENTS_ENABLED` and `NEXT_PUBLIC_SITE_URL`
were **not** set in the working environment, and no Stripe CLI session was
authenticated. No genuine Stripe test-mode request was made. The provider is
simulated through injected gateways in Vitest, while webhook signature
verification uses the real Stripe SDK (`generateTestHeaderString` /
`constructEvent`).

Screenshot review: `checkout-payment` (390, 1440), `admin-settings-payments`
(320, 667 landscape, 1440), `admin-dashboard-orders` (320, 1440),
`admin-orders` (1440) and `admin-order-detail` (1440) were inspected visually.
Two defects were found and fixed: the dashboard money values wrapped the
currency onto its own oversized line, and the Stripe readiness panel rendered
literal backticks around `.env.example`. The payment-panel capture was also
re-taken with the section centred, because a sticky header had covered the top
card.

Commits: Phase 6A `a9f6963` (specification and architecture); Phase 6B–6F code
`06c9865`; documentation `5764b75`. The full record is in
`docs/PHASE6_REPORT.md` §R. Nothing has been pushed.

## Remaining blockers

- Genuine Stripe test-mode verification requires an operator with test keys and
  the Stripe CLI (steps in `docs/STRIPE_INTEGRATION.md` section 11).
- Nothing has been pushed to a remote: no Git credentials are configured in
  this environment.
- `CLOUDINARY_CLOUD_NAME` still does not match the preview cloud name used by
  fixtures; that is a Phase 2 owner decision, unrelated to payments.
