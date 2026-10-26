# PEARL Signature: Phase 7 Progress

Status: **7A in progress.** Transactional email and secure order tracking are
being implemented on the existing Phase 5 outbox. Deployment, live payments and
Phase 8 remain prohibited.

Specification snapshot: `docs/PHASE7_SPEC.md`. Final report (created at 7F):
`docs/PHASE7_REPORT.md`.

## Initial repository inspection

- Branch `main`, HEAD `0d79033` (Phase 6 follow-up). Working tree was clean; no
  local work was discarded or reset.
- Read `AGENTS.md`, `docs/PROJECT_SPEC.md`, `docs/PHASE_PROGRESS.md`,
  `docs/PHASE5_REPORT.md`, `docs/PHASE6_SPEC.md`, `docs/PHASE6_REPORT.md`,
  `docs/BUSINESS_CONFIGURATION.md`, `docs/MANUAL_TESTING.md`,
  `docs/ORDER_NOTIFICATIONS.md` and the order/payment/notification/admin code.
- Baseline from Phase 6 on this tree: typecheck, lint, 713 Vitest tests across
  52 files, production build, 88 Playwright tests and 200 screenshots all green.
  Phase 7 starts from that baseline.

## Existing architecture and integration points

1. `src/models/notification-outbox.ts` — unique `key`, `event`, `reference`,
   `recipientRole`, `status` (`pending|sent|failed`), failure-only `attempts`,
   sanitised `lastReason`, `nextAttemptAt`, `sentAt`, 30-day TTL on `createdAt`.
   No personal data is stored; recipients are resolved at dispatch time.
2. `src/lib/notifications/dispatch.ts` — `enqueueOrderNotifications`,
   `notifyOrderEvent`, `notifyOrderEventDurably`, `attemptDueNotifications`
   (bounded batch, opportunistic scan, no lease, no provider id, no HTML).
3. `src/lib/notifications/templates.ts` — event enum, role map, stable
   `notificationKey`, plain-text `buildNotification`, narrow order facts.
4. `src/lib/notifications/provider.ts` — provider seam, empty registry,
   `NotificationDeliveryError`, `resolveNotificationProvider`.
5. `src/lib/orders/create.ts` enqueues `order.placed` after the order insert.
6. `src/lib/actions/admin-orders.ts` enqueues `order.status_changed` after a
   successful transition and has the only manual COA paid write
   (`recordPaymentAction`) with no receipt event yet.
7. `src/lib/payments/webhooks.ts` enqueues `payment.confirmed`,
   `payment.failed`, `payment.requires_attention`, `payment.refund_review`
   durably after verified transitions.
8. `src/lib/actions/orders.ts` authorises guest confirmation reads by
   `(reference, sha256(capability))` and returns `OrderConfirmationView` with no
   customer PII. `src/lib/checkout/attempt.ts` stores the capability in
   sessionStorage (`pearl-confirmations-v1`).
9. `src/models/order-attempt.ts` / `src/lib/orders/rate-limit.ts` — hashed,
   atomic, TTL-bounded buckets with `order.create|order.lookup|payment.create`.
10. `src/models/store-config.ts` — singleton `_id: "checkout"` with intake,
    fulfilment, tax and `payments.onlineEnabled`; admin form allowlist in
    `src/lib/validations/store-config.ts`.
11. `src/app/admin/(dashboard)/settings/page.tsx` — readiness panels (checkout,
    Stripe) above the settings form; the notification readiness panel belongs
    here.
12. `src/app/admin/(dashboard)/orders/[id]/page.tsx` — detail route keyed by the
    public reference, so admin email links can use `/admin/orders/<reference>`.
13. `scripts/seed.ts` creates every index explicitly (`autoIndex` is off) and
    never drops anything; the outbox TTL migration must be explicit there.
14. Playwright: four projects against one build; the `orders` project (port
    3003) owns the disposable in-memory database, labelled fixtures and test
    store policy. The harness must also configure a controlled provider.
15. `scripts/screenshots.mjs` captures public routes at ten viewports and
    optional admin/cart/orders surfaces, asserting zero horizontal overflow.

## 7A decision record

- **Event identity.** New transitions use distinct events
  (`order.confirmed`, `order.preparing`, `order.ready_for_pickup`,
  `order.out_for_delivery`, `order.completed`, `order.cancelled`). The legacy
  `order.status_changed` remains in the enum for pending rows and existing
  tests. Keys stay `event:reference:role`.
- **Outbox extensions.** `transition`, `providerId`, `providerStatus`,
  `leaseToken`, `leaseExpiresAt`, `lastAttemptAt`, `ambiguousAttempts`; statuses
  add `processing` and `uncertain`. TTL moves to `sentAt` so unresolved
  failures are never silently deleted; the legacy `createdAt_1` TTL index is
  dropped by the seed script.
- **Claims.** Atomic `findOneAndUpdate` from `pending` to `processing` with a
  random lease token and expiry. Expired leases return to `pending` with an
  honest reason, the same provider idempotency key and a consumed attempt.
- **Ambiguous outcomes.** Timeout/network/5xx retry with the same provider
  idempotency key up to a small bound, then park as `uncertain`. Operators can
  retry explicitly; the local outbox remains authoritative.
- **Provider contract.** `send()` returns the provider message id and an
  acceptance state; `NotificationDeliveryError` gains a failure kind
  (`transient|permanent|rate_limited|ambiguous`) and optional retry delay.
- **Verification-code email.** Sent inline through one central function because
  it is a time-boxed security challenge, not a business event. It is the single
  documented exception to queue-only sending; only `codeHash` is stored.
- **Tracking grants.** Cross-device access uses a new `order_access_grants`
  collection (sha256 token, 24h expiry, TTL index, sessionStorage) scoped to one
  order. Same-browser tracking reuses the Phase 5 confirmation capability.
- **Recovery.** `tracking_challenges` stores only `codeHash`, expires in 10
  minutes, caps attempts at 5, is single-use and is rate-limited per address.
  Reference + email requests always receive the same generic response.
- **Owner preference.** Only the nonessential `preparing` update is toggleable
  (`notifications.preparingUpdateEnabled`, default true). Confirmations,
  ready/out-for-delivery/completed/cancelled and payment messages always send.
- **Email styling.** Email HTML uses centralised brand hex constants (email
  clients cannot consume CSS variables) - the documented exception to the
  no-raw-hex rule. No customer-facing em dashes.
- **Test provider.** A development/test-only `file-sink` provider writes JSONL
  (`NOTIFICATION_SINK_FILE`) so Playwright can read verification codes. It
  refuses production unless the explicit harness flag is set.
- **Scheduling.** Guarded `POST /api/notifications/process` with a bearer
  secret plus `npm run notifications:process`. Automatic scheduled delivery is
  documented as pending deployment configuration; opportunistic post-commit
  attempts are best-effort only.

## Milestones

| Milestone | State | Verification / notes |
| --- | --- | --- |
| 7A Specification and architecture | Complete | Spec, progress, integration map, security decisions |
| 7B Resend integration | Not started | Provider adapter, config, templates, unit tests |
| 7C Outbox processor | Not started | Claims, retries, idempotency, guarded execution, admin observability |
| 7D Customer tracking | Not started | Page, capability, timeline, refresh, auth tests |
| 7E Customer communication | Not started | Lifecycle/payment events, recovery, admin settings |
| 7F Quality assurance | Not started | Gates, browser regression, screenshots, docs, report |

## External integration blockers

- No `RESEND_API_KEY`, verified sending domain, `EMAIL_FROM` or
  `OWNER_NOTIFICATION_EMAIL` is available. No real email may be sent. Genuine
  Resend delivery verification is pending; controlled mocks are used.
- Genuine Stripe test-mode verification remains pending from Phase 6.
- Push is blocked: no Git credentials are configured. Commits stay local.
- `CLOUDINARY_CLOUD_NAME` still does not match the preview cloud name used by
  fixtures (Phase 2 owner decision, unrelated to Phase 7).
