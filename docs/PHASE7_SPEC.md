# PEARL Signature: Phase 7 Specification

This file preserves the approved Phase 7 brief for work that continues after
conversation compaction. The user's full prompt is the governing source; this
repository copy records its requirements in an implementation-ready form.

## 1. Objective and authority

Build reliable transactional email notifications and a secure, polished guest
order-tracking experience on top of the existing MongoDB order system. Resend is
the initial delivery provider. The work must remain within Resend's free tier,
reuse the Phase 5 `notification_outbox`, and never make an order or a payment
depend on email delivery.

Implement Phase 7 only. Do not deploy, do not activate live payments, and do not
start Phase 8 without explicit approval. Preserve the Phase 6 limitation: Stripe
has not been verified through a genuine test-mode payment against Stripe's API,
and online payment remains gated off by default.

## 2. Existing application context

Next.js 16 App Router with Cache Components, React 19, strict TypeScript,
Tailwind v4, Motion, Lucide, Fraunces/Manrope, MongoDB Atlas M0/Mongoose, Zod,
Cloudinary, Stripe Checkout, Vitest and Playwright. Canadian online food
business, CAD, delivery and optional arranged pickup, no physical storefront.

Phase 5 delivered guest checkout, server-side pricing, order creation with
idempotency, Cash on Arrival, lifecycle transitions, admin order management, a
guest confirmation capability (hash-only, sessionStorage), a notification
outbox, rate limiting and audit logging. Phase 6 added hosted Stripe Checkout,
signed webhooks, durable payment attempts, monotonic payment state,
reconciliation, admin financial reporting and payment notification events.

The outbox is not to be replaced: it is extended. Existing idempotency keys,
minimal PII storage, bounded retries and business-transaction independence must
survive.

## 3. Repository-first inspection

Before changing code: read `AGENTS.md`, `docs/PROJECT_SPEC.md`,
`docs/PHASE_PROGRESS.md`, `docs/PHASE5_REPORT.md`, `docs/PHASE6_SPEC.md`,
`docs/PHASE6_REPORT.md`, `docs/BUSINESS_CONFIGURATION.md`,
`docs/MANUAL_TESTING.md`; inspect order, payment, fulfilment, guest capability,
admin authorization, outbox, event producers, lifecycle transitions, Stripe
confirmation and the test harness. Record findings and conflicts before
changing behaviour. Do not reset history or discard local commits.

## 4. Provider choice and email architecture

- Use **Resend** as the first transactional provider, free tier only. No paid
  subscription, SMS, WhatsApp Business API or premium email service.
- Separate five concerns: business events, outbox, processor, templates,
  provider adapter (plus delivery records on the outbox entry).
- Order creation, payment confirmation and admin mutations never call Resend
  directly and never fail because email failed.
- Environment configuration (names may follow repository conventions, never
  duplicated): `RESEND_API_KEY`, `EMAIL_FROM`, `OWNER_NOTIFICATION_EMAIL`,
  `RESEND_WEBHOOK_SECRET`, plus processor secret, limits and test sink settings.
- Validate the sender (`Name <address@domain>` or bare address). Never hardcode
  addresses or keys. API keys stay server-side.
- Missing configuration: orders, payments and Cash on Arrival keep working;
  events stay recorded; admin shows a warning; nothing is reported as sent and
  no message is redirected to a developer address.

## 5. Outbox integration and processing

Preserve idempotent event creation, bounded retries, MongoDB persistence,
minimal PII, existing dedupe guarantees and sensible retention.

Processor requirements:

1. Find eligible pending entries.
2. Atomically claim with a lease/token so concurrent processors cannot send the
   same entry.
3. Recover expired leases after a crash.
4. Resolve recipients from protected records at dispatch time.
5. Select and render the correct template.
6. Send through the provider.
7. Store the provider message identifier.
8. Record provider **acceptance**, never claim delivery from HTTP success.
9. Distinguish transient, permanent, rate-limited and ambiguous outcomes.

Delivery idempotency uses a stable key derived from notification identity.
Resend's provider-side idempotency window is limited, so local outbox state is
authoritative. Ambiguous outcomes (timeout/network/5xx) are retried a bounded
number of times with the same provider idempotency key, then parked as
`uncertain` for an operator rather than blindly re-sent. Document recovery.

Retry policy: increasing delays, respect `Retry-After`/429, do not retry
permanent validation or sender errors indefinitely, stop at a bounded attempt
count. Retention: do not silently delete unresolved failures. The 30-day TTL
moves from `createdAt` to `sentAt` so only successfully accepted entries expire;
failed/uncertain entries stay visible to the operator.

## 6. Reliable processor execution

- Provide a guarded server-side entry point (Route Handler) requiring a
  server-side secret, plus a manual CLI/admin command.
- Do not make processing publicly triggerable.
- Support scheduled execution after deployment, but do not assume a free plan
  permits frequent cron. Document the real dependency. If scheduling cannot be
  configured now, mark automatic delivery as pending deployment configuration.
- Best-effort immediate processing after a committed event may reduce latency
  but must not be the only mechanism, and must not rely on unawaited promises as
  the delivery guarantee.
- No paid Redis/worker platform. Order and payment writes remain authoritative.

## 7. Notification events

| Event | Trigger | Recipients |
| --- | --- | --- |
| A `order.placed` | Genuine order creation | Customer (if email supplied) + owner |
| B `order.confirmed` | Owner confirms | Customer |
| C `order.preparing` | Preparing transition, only if enabled | Customer |
| D `order.ready_for_pickup` | Pickup order ready | Customer |
| E `order.out_for_delivery` | Delivery order dispatched | Customer |
| F `order.completed` | Completion | Customer |
| G `order.cancelled` | Cancellation | Customer |
| H `payment.confirmed` | Verified Stripe success only | Customer |
| I `payment.collected` | Owner records Cash on Arrival collection | Customer |
| J `payment.failed` / `payment.requires_attention` / `payment.refund_review` | Meaningful failed/unresolved payment facts | Customer / owner as appropriate |

Each meaningful transition gets a distinct stable event identity. Duplicate
webhooks, retries, page reloads and repeated admin actions never create a second
notification. The legacy `order.status_changed` event stays in the enum for
existing pending rows and tests, but new transitions use the specific events.

## 8. Email templates

Eleven templates: customer new order, owner new-order alert, order status
update, ready for pickup, out for delivery, completed, cancelled, online payment
confirmed, Cash on Arrival collected, tracking verification code, payment issue.
Reuse shared layout/components; avoid duplicated markup.

Brand: cream `#FDFBF7`, navy `#1A2530`, champagne gold `#D4AF37`, restrained
warm accents, email-safe system font fallbacks. Responsive, readable, accessible
contrast, meaningful alt text, plain-text alternatives, clear primary action, no
tracking pixels, no deceptive promotion, no invented business information and no
em dashes in customer copy.

Customer order confirmation includes reference, items, quantities, variants,
accepted prices, delivery/pickup, fee, taxes, total, payment method, actual
payment state and current status. Unpaid Cash on Arrival is never labelled paid.
No fabricated pickup address or business hours.

Owner alert includes enough to identify and action the order and a link to the
authenticated admin order page. Minimal customer PII in the body.

Escape all dynamic text; prevent HTML injection; never include capability
tokens, secrets or provider credentials.

## 9. Admin notification settings and observability

Show without exposing keys: whether email delivery is configured, sender
readiness, owner recipient readiness, pending/failed/uncertain counts, recent
accepted notifications, last processing attempt, last successful provider
acceptance, and quota state.

Allow the owner to disable only nonessential status email (the `preparing`
update). Confirmations and critical payment messages are always sent.

Failed-notification view: event type, order reference, attempt count, last
attempt time, sanitised reason and delivery state. Provide a guarded retry for
eligible entries. Retry accepts only an entry id: never an arbitrary recipient,
subject or body. Validate the original event and recipient context.

## 10. Guest order tracking

Public route `/track` (supporting endpoints allowed). No customer accounts.

- Reuse the Phase 5 opaque guest capability: 32-byte secret in sessionStorage,
  sha256 server-side. Never put it in a URL. Never replace it with public
  reference lookup.
- Same-browser access works while the capability is valid.
- Cross-device recovery: reference + associated email → rate limit → identical
  generic response whether or not the order exists → short-lived one-time code
  emailed → verify and consume → limited scoped tracking grant.
- Recovery security: no existence disclosure, no email disclosure, no
  reference-only access, cryptographically strong codes, hash-only storage,
  short expiry, attempt limits, request/verify rate limits, single use, no
  tokens in URLs/logs/analytics.
- If email is not configured, recovery is explicitly unavailable rather than
  pretending. Document that orders without an email address cannot be recovered
  cross-device.
- No paid SMS OTP and no weakening of existing capability protection.

## 11. Tracking interface

Premium extension of the storefront design. Show reference, current fulfilment
status, creation date, items, quantities, accepted total, method, payment
method, accurate payment status, progress and relevant timestamps. Private data
appears only after authorization.

Timeline (adapt to the Phase 5 graph, invent nothing):

- Delivery: Order Received → Confirmed → Preparing → Out for Delivery → Completed.
- Pickup: Order Received → Confirmed → Preparing → Ready for Pickup → Completed.

Cancelled orders display Cancelled and never Completed. Payment distinctions:
Cash on Arrival awaiting/collected, online pending/confirmed/failed, refund
pending review, verified refunded. No Stripe jargon in customer copy.

## 12. Live refresh

Fetch only after access verification. Modest polling, pause while hidden, stop
at terminal states, manual Refresh control, no stale overwrite, accurate
loading/error states, no fabricated progress. No paid realtime infrastructure.

Customer order data is never public/shared-cached. Apply private/no-store
protections so one guest cannot receive another guest's order from a cache.

## 13. Tracking design and states

Desktop: identity/status, prominent timeline, order summary, payment summary,
fulfilment details. Mobile: readable status, vertical timeline, comfortable
spacing, clear payment information, easy refresh, accessible controls.

Purposeful motion only for server-confirmed changes; respect reduced motion.
Handle no capability, missing order, invalid authorization, expired/invalid
code, unavailable database, email unavailable, cancelled order, unconfirmed
payment and stale status. Never expose stack traces.

## 14. Integration with confirmation and admin

- Confirmation page stays authoritative; add a visible Track Order action.
- Reuse existing order presentation components; do not build a second summary
  system.
- Admin transitions update tracking; notifications derive only from successful
  authoritative mutations. Preserve optimistic concurrency. Repeated admin
  actions do not duplicate events.
- Stripe redirect success alone never marks payment paid. Tracking reflects the
  verified provider pipeline. Repeated Stripe events never duplicate emails.
- Cash on Arrival receipt only after authorized collection recording.

## 15. Delivery feedback webhooks

If practical on the free tier, accept verified provider delivery callbacks
(accepted/delivered/bounced/complained/failed). Verify authenticity with the
provider's official method, reject unsigned mutations, handle duplicates, match
to original records, store only necessary metadata (no full payloads), and never
confuse acceptance with delivery. If it cannot be genuinely tested, document the
limitation and leave delivery state unknown.

## 16. Cost and quota

Design around free-tier limits, make them configurable (no hardcoded
assumptions), track send volume lightly, avoid duplicates and unnecessary status
mail, use bounded retries, handle 429, surface quota problems to the admin, and
never claim unlimited delivery. A customer-facing message never promises
delivery when the message was only queued.

Document verified sender domain, DNS/SPF/DKIM, a legitimate sender address and a
monitored reply channel. Do not invent or register a domain or assume
verification.

## 17. Privacy and security

Protect names, emails, phones, addresses, order details, payment information and
tracking credentials. Server-side authorization for private reads, no reference
enumeration, rate-limited recovery, no credentials in URLs, no raw token storage,
no secrets in logs, private caching, secure sessions, sanitized errors, safe
template rendering, no unauthorized sending endpoint, no arbitrary recipient
injection, no mass assignment through settings. Provider credentials strictly
server-side. Store only necessary recipient data, resolved from protected
records. Review retention against practical Canadian privacy expectations without
claiming legal compliance.

## 18. Mobile-first QA

Inspect at 320, 360, 375, 390, 430, 768, 1024 and 1440 px plus representative
landscape. Screens: confirmation, track order, progress, recovery, code form,
invalid code, cancelled, payment pending, payment confirmed, admin notification
settings, admin failed list, admin order detail.

No overlap, clipping, unreadable text, horizontal overflow, hidden close buttons,
broken fixed positioning or oversized mobile type. Important actions accessible,
strong contrast, focus states and comfortable touch targets. Inspect screenshots
visually, not only overflow assertions.

## 19. Testing

Vitest matrices:

- **A Events:** correct events on creation/transitions/payment/COA/cancel;
  duplicate attempts/webhooks/actions create none; failed transitions create none.
- **B Delivery:** claim, concurrency, provider id, transient retry, permanent
  failure, rate limit, lease recovery, missing configuration, ambiguous
  acceptance, no duplicate sends, unauthorized processor rejection.
- **C Templates:** order facts, CAD, payment accuracy, delivery/pickup
  differences, missing optional data, escaping, text alternative, no invented
  promises, no customer em dashes, no secret leakage.
- **D Tracking authorization:** valid/invalid/foreign/expired capabilities,
  reference-only refusal, no public caching, no enumeration, safe missing order.
- **E Recovery:** neutral responses, expiry, wrong code, attempt limit, reuse,
  rate limits, scoped grant.
- **F Lifecycle:** delivery/pickup/cancelled display, invalid transitions never
  completed, accurate history, payment/fulfilment separation, COA and Stripe
  states.
- **G Regression:** all Phase 1-6 tests continue to pass; do not weaken them.

Playwright scenarios A-H with isolated fixtures and controlled provider mocks:
new COA order and tracking, fulfilment updates, delivery versus pickup, verified
payment pending behaviour, tracking security, email recovery, notification retry,
and narrow mobile interactions. No real charges and no emails to real customers.

## 20. Real provider verification

If Resend credentials and a verified sending domain are available, verify API
authentication, sender, one synthetic send, acceptance response, recipient,
subject, content, observable arrival, recorded provider id and configured
callbacks. Never email real customers or repeatedly email the owner during
development. If credentials/domain are unavailable, use controlled mocks and
document real delivery as pending. Never claim real delivery from mocked SDK
responses.

## 21. Milestones

- **7A Architecture and specification:** inspect, persist spec/progress, review
  outbox, define provider integration, tracking authorization and security.
- **7B Resend integration:** SDK/config, adapter, branded templates, error
  handling, unit tests.
- **7C Outbox processor:** claiming, retries, durable idempotency, guarded
  execution, admin observability, concurrency/failure tests.
- **7D Customer tracking:** page, capability integration, timeline, refresh,
  confirmation/payment integration, authorization/cache tests.
- **7E Customer communication:** lifecycle and payment events, secure recovery,
  admin notification settings, delivery visibility.
- **7F QA:** all gates, browser regression, screenshot inspection, real provider
  test if possible, docs, commits, final report.

## 22. Required verification commands

`npx next typegen`, `npm run typecheck`, `npm run lint`, `npm run test`,
`npm run build`, `npm run test:e2e`, `npm run screenshots`. Add genuinely
required commands. Never claim a pass without executing it. Do not weaken
assertions to get green. Inspect new/modified pages in real screenshots, check
server logs, keep external provider tests separate from deterministic tests.

## 23. Documentation

Create `docs/PHASE7_SPEC.md`, `docs/PHASE7_PROGRESS.md`,
`docs/EMAIL_NOTIFICATIONS.md`, `docs/NOTIFICATION_PROCESSING.md`,
`docs/ORDER_TRACKING.md`, `docs/PHASE7_REPORT.md`. Update
`docs/PROJECT_SPEC.md`, `docs/PHASE_PROGRESS.md`, `docs/MANUAL_TESTING.md`,
`docs/BUSINESS_CONFIGURATION.md`, `docs/ADMIN_OPERATIONS.md`, `README.md` and
`.env.example`.

Email documentation covers Resend account/domain/sender/owner configuration,
secure credentials, local processing, post-deployment scheduling, test sends,
failure investigation, free-tier limits and safe testing without contacting real
customers. Tracking documentation covers same-browser capability, optional
recovery, privacy, expiry/rate limits, status mapping, mobile UX and
troubleshooting.

## 24. Strict exclusions

No customer accounts, SMS, paid WhatsApp API, marketing/newsletters/promotions,
loyalty or discount programs, new payment gateways, live Stripe activation,
automatic refunds, driver GPS or map tracking, new databases, paid message
queues, production deployment, domain purchase or major storefront redesign.

## 25. Acceptance criteria

Code-complete only when: the outbox is connected to a real provider adapter;
templates exist; new-order customer and owner notifications work; fulfilment and
verified payment notifications work; sending is separate from order
transactions; duplicate processing is controlled; retries and concurrency are
safe; failures are observable; credentials never leak; missing configuration is
honest; admin readiness is visible; guest tracking works with valid
authorization; references alone expose nothing; delivery/pickup and payment
states are accurate; secure recovery exists where email is available; invalid
tracking/verification is rate-limited; status changes update tracking; mobile
tracking/admin work; storage stays light; Phases 5 and 6 still work; relevant
tests pass; provider verification is reported honestly; documentation is
complete; production-dependent scheduling and deliverability are clearly
identified.

## 26. Final report and git

`docs/PHASE7_REPORT.md` sections A-S: implementation summary, architecture,
email provider, outbox processing, templates, customer tracking, tracking
security, admin notification management, payment integration, mobile UX,
security review, database impact, test results, real provider verification,
screenshots, operational requirements, remaining limitations, git status and
next-phase readiness. Include a manual testing guide.

Commit in meaningful milestones, preserve history, never expose a PAT or commit
secrets. If push is blocked, keep commits local and report the blocker.

## 27. Final instructions

Prioritise operational reliability over decoration. Notifications stay reliable,
idempotent and privacy-conscious. No emails for failed mutations, no
payment-success email for unverified payments, no assumption that a queued
message was delivered, no weakening of tracking authorization, no invented
contact details, addresses, estimates or business information. Keep the
experience premium, modern, mobile-first and cost-conscious. Run all tests,
produce the report, commit, then **stop**.
