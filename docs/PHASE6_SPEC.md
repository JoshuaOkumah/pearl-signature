# PEARL Signature: Phase 6 Specification

This file preserves the approved Phase 6 brief for work that continues after
conversation compaction. The user's full prompt is the governing source; this
repository copy records its requirements in an implementation-ready form.

## 1. Objective and authority

Implement secure Stripe-hosted, one-time Checkout payments in CAD; reconcile
provider facts with MongoDB; preserve Phase 5 order placement, Cash on Arrival,
fulfilment state, guest capability privacy and notification outbox. MongoDB
orders remain authoritative for the accepted sale amount and snapshots.
Stripe is authoritative for settlement. A browser redirect is never payment
proof. Webhook signature verification and durable, idempotent state changes
are mandatory. Live payments remain disabled and this phase does not deploy.

## 2. Existing application context

Next.js 16 App Router with Cache Components, React 19, strict TypeScript,
Tailwind v4, Motion, Lucide, Fraunces/Manrope, MongoDB Atlas M0/Mongoose,
Zod, Cloudinary, Vitest and Playwright. The product is a Canadian online
Nigerian food store (no storefront), CAD, delivery and optional arranged
pickup. Phase 5 order creation re-quotes and reprices server-side, snapshots
price/product/configuration, and uses a unique 32-byte attempt key.
Administrative order updates use optimistic concurrency. Guest confirmation
stores only a hash of an opaque capability and resolves it from browser
sessionStorage. The outbox is idempotent and has bounded retries.

## 3. Scope, deliverables and milestones

### 6A: Specification and architecture
- Inspect branch/tree, project and Phase 5 docs, payment/order/auth/admin/
  notification models, tests and Next 16 cache behaviour.
- Save this spec and `docs/PHASE6_PROGRESS.md` before implementation.
- Record data model, provider boundary, states, authorization and cache rules;
  document conflicts with prior code before changing them.

### 6B: Checkout initialization
- Add the official Stripe Node SDK, server-only validated configuration,
  explicit payment-readiness gates, an authorized payment service and durable
  payment attempts with database and Stripe idempotency.
- Reuse the Phase 5 order creation/pricing pipeline and order snapshot.
- Offer Online Payment and Cash on Arrival; preserve Cash on Arrival unchanged.
- Use hosted Checkout only, no card-entry UI. A configured but unavailable
  provider shows honest unavailable copy and never silently selects cash.

### 6C: Webhooks and payment state
- Add a Node-runtime App Router webhook handler consuming the unchanged raw
  request body, verify `Stripe-Signature` with the SDK, and reject unsigned,
  invalid or environment-mismatched events.
- Handle Checkout completed, async success/failure and expiry. Check provider
  object IDs, order/attempt association, exact integer-cent amount and CAD.
- Persist event deduplication and apply transitions idempotently. Paid cannot
  be reversed by stale failure/expiry; fulfilment is independent. A late
  success after cancellation is retained and flagged for review, not revived.
- Enqueue payment notifications idempotently without blocking payment state.

### 6D: Customer and admin
- Checkout selects the method, shows server-verified amount, acknowledges
  reprice, protects double submission and redirects only to Stripe's hosted
  URL. Provide success/cancel return experience with pending verification,
  bounded status refresh, safe retry and no false-success copy.
- Return authorization uses existing opaque guest capability through
  same-origin request bodies, never URLs, metadata, logs or referrers.
- Admin order list/detail shows method, payment state, online provider refs,
  attempts, amounts, failures and reconciliation/refund state without card
  data. Keep manual collection exclusively for Cash on Arrival.
- Report order counts, paid online, Cash on Arrival collected, unpaid,
  failed/pending, gross collected, verified refunds and net collected only
  where mathematically supported; never call gross revenue profit.

### 6E: Reconciliation, edge cases and docs
- Provide guarded, audited administrative or CLI reconciliation against
  Stripe's server API, dry-run/read-only by default. Match stable references,
  compare amount/currency, record timestamp/result, and avoid duplicate
  transitions. No paid job service or broad per-request polling.
- Model full/partial refund facts from trusted provider events. No automatic
  refund on cancellation, customer refund request, one-click refund API or
  dispute UI. Document operator procedure and unresolved production risks.
- Reuse the Phase 5 notification outbox with idempotent payment event keys.
  No provider is configured; never claim a notification was sent.

### 6F: Verification and report
- Add deterministic Vitest/service/webhook/database tests and Playwright
  browser flows against isolated synthetic data. Automated tests must never
  charge real cards.
- Run typegen, typecheck, lint, unit, build, e2e and screenshot gates; inspect
  images including mobile landscape. Report exact counts and honest Stripe
  verification level. Commit meaningful milestones and stop at Phase 6.

## 4. Payment/provider decisions and data requirements

- Use Stripe Checkout Sessions, `mode: payment`, CAD, official SDK, server
  amount from the immutable order snapshot, controlled success/cancel URLs,
  minimal reference metadata, no Stripe Tax unless independently approved.
- For the simple safe itemization path, prefer one clearly described order
  total line item or itemized server-derived merchandise, delivery and tax
  components only if the exact accepted total is preserved without a second
  tax calculation. Document the choice; never double-add fee/tax.
- Secrets are server-only: `STRIPE_SECRET_KEY`,
  `STRIPE_WEBHOOK_SECRET`, canonical application URL and any explicit enable
  flags. Validate configuration, redact failures, distinguish test/live.
  Phase 6 accepts only test-mode keys/events and keeps live mode impossible.
  Environment presence alone never enables payments; use an explicit server
  payment readiness switch and a default-off business configuration switch.
- Candidate model: extend `orders.payment` with method (`cash_on_arrival` or
  `stripe`), status, provider, settlement cents/time, captured/refunded cents,
  current provider references and reconciliation/review state. Add a
  `payment_attempts` collection if needed for immutable retry history, unique
  attempt idempotency, unique Stripe Session/PaymentIntent refs and one active
  attempt per order. Add durable unique Stripe event records. Use indexes
  deliberately because Mongoose `autoIndex` is off and Atlas M0 is the target.
- Store all canonical financial values as nonnegative integer CAD cents.
  Preserve order snapshots and prior attempts; a retry uses the same order
  amount. No browser money/provider fields become authoritative.
- MongoDB M0 transactions are not assumed. Reservation is persisted before
  Stripe API calls with a stable provider idempotency key. Timeouts/retries
  recover the same provider result; a partial failure remains reconcilable.
  Event processing can retry after partial persistence and must be monotonic.

## 5. Payment state lifecycle and invariants

Adapt names to code but distinguish `unpaid/not_initiated`, `awaiting_payment`,
`processing`, `paid`, `failed`, `expired`, `partially_refunded`, `refunded`
and `review_required` as relevant. Persist provider attempt statuses and
history instead of overwriting. Only verified provider settlement marks
Stripe paid. COA is paid only by authorized existing admin flow. Failure or
expiry cannot erase paid; stale attempts cannot modify a newer attempt.
Cancelled orders are not resurrected by late success; retain funds facts and
flag refund/review. Cancelling is not a refund. Fulfilment changes never
imply payment.

Retries reuse an active valid session when safe, replace only a definitively
expired/failed attempt, reject paid/cancelled orders, and reconcile uncertain
outcomes before another chargeable attempt. Multiple tabs are controlled by
one-active-attempt DB invariants, not client state.

## 6. Security, privacy and caching

- Strict Zod allowlists, bounds, server pricing, order snapshot integrity.
- Public payment initiation requires the existing capability or equivalent
  scoped authorization; reference/session ID alone cannot authorize.
- Every admin page/action independently re-authorizes. Webhook authenticates
  only by Stripe signature, not user cookies.
- Never accept browser amounts, currency, status, Session/PaymentIntent IDs,
  paid flags, role or ownership claims. Never persist card credentials,
  secrets, raw capability or unnecessary customer PII in provider-event data.
- Payment endpoints and guest details are private/no-store/noindex; only
  same-origin server-controlled destinations. Never derive redirect URLs
  from untrusted input. Do not expose capability in query strings, metadata,
  analytics, logs or Referer.
- Rate-limit customer session initialization; do not block legitimate
  verified webhook retries. Keep provider calls bounded and server-side.
- Explicitly configured test mode only; production/live keys and live events
  fail closed. Missing settings preserve COA and disable online payment.

## 7. Business, tax and deployment boundaries

No invented delivery areas/fees, pickup details, hours, contact data, tax
rates or prices. Preserve Phase 5 owner-configured tax math. Stripe amount
must equal its server-computed total; Stripe Tax is not independently added.
If the current tax configuration is inadequate for actual Canadian food tax
treatment, document that and keep live payments disabled pending professional
business/accounting decisions. Do not open order intake automatically.

No live activation, production deployment, automatic refunds, accounts,
subscriptions, loyalty, discounts, gift cards, delivery services/tracking,
full notification provider, paid queue/job service, new database or unrelated
redesign/features.

## 8. Required tests

Test initialization amount/currency/fees/tax exactly once, tampering,
authorization, readiness, paid/cancelled rejection, idempotency, races,
timeouts and recovery. Webhook tests cover valid/missing/bad/modified
signature, malformed/unsupported event, amount/currency/account/environment/
association mismatch, all supported events, duplicate/out-of-order events,
async results, late cancelled success and outbox once. Retry tests cover
double-click/tabs, timeout, provider success/database failure, failed/expired
retries and paid rejection. Regress COA collection, order lifecycle and
reporting. Verify pending/unpaid not revenue; each paid order once; COA once;
failures not revenue; refunds distinguish gross and net.

Playwright scenarios: A successful hosted test/integration redirect and
verified return; B abandon/cancel; C fail and retry; D webhook duplicate;
E payment/fulfilment independence; F authorization/tampered amount/forged
webhook/capability protection; G mobile checkout/return states. Use isolated
fixtures and mocks unless test-mode credentials are explicitly provided.
No real charges in automated tests.

## 9. Responsive and accessibility acceptance

Checkout choice, summary, loading, pending/success/failure/retry return,
guest confirmation, admin payment summary/detail at 320, 360, 375, 390, 430,
768, 1024, 1440 and mobile landscape. No overlap, clipping or horizontal
scroll; touch-friendly controls; keyboard and visible `focus-gold`; reduced
motion; no success animation before server verification. Follow Fraunces /
Manrope and existing semantic tokens; no raw component hex or customer-facing
em dashes.

## 10. Required documentation

Create `PHASE6_SPEC.md`, `PHASE6_PROGRESS.md`, `STRIPE_INTEGRATION.md`,
`PAYMENT_LIFECYCLE.md`, `PAYMENT_RECONCILIATION.md`, `PHASE6_REPORT.md`.
Update `PROJECT_SPEC.md`, `DATABASE_SCHEMA.md`, `PHASE_PROGRESS.md`,
`MANUAL_TESTING.md`, `ADMIN_OPERATIONS.md`, `BUSINESS_CONFIGURATION.md`,
`README.md`, `.env.example`. Stripe guide covers test account/keys, env,
Stripe CLI forwarding, test payment/failure/retry, dashboard verification,
common errors and future live-readiness preparation. Reconciliation guide
requires trusted provider evidence and forbids manual online-paid marking.

## 11. Acceptance criteria

1. Official SDK and secrets server-only; no live activation.
2. Sessions are authorized, idempotent and use exact server snapshot CAD cents.
3. Attempt history is durable; duplicate sessions/concurrent starts controlled.
4. Webhook raw signature verified; events durably deduplicated and
   association/amount/currency/environment checked.
5. Redirects never mark paid; async, failure, expiry, stale/late events are
   safe and recoverable; paid is monotonic.
6. Payment is independent of fulfilment; COA remains fully functional.
7. Retry, reconciliation, admin presentation and financial totals are
   accurate; unpaid never counts as collected; refunds are separately shown.
8. Guest capability privacy, no-store/noindex, rate limits and audit remain.
9. Outbox events are idempotent, provider unconfigured honestly.
10. Mobile/accessibility, all Phase 1–5 regressions, all gates and docs pass.
11. Report differentiates mocks/SDK tests/genuine Stripe test payments and
    signed webhook verification; incomplete items are explicit.
12. Commit, report branch/tree/push honestly, stop after Phase 6.

## 12. Final report sections

`PHASE6_REPORT.md` must contain A. summary, B. architecture, C. database,
D. initialization, E. webhooks, F. lifecycle, G. customer experience,
H. admin, I. COA regression, J. security, K. reconciliation, L. refund
foundations, M. tests, N. Stripe test-mode verification, O. visual QA,
P. business configuration, Q. limitations, R. Git status, and S. readiness
for live orders, including exact manual verification steps.
