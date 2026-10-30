# PEARL Signature: Notification Processing

Phase 7. How entries leave `notification_outbox`, who is allowed to drain the
queue, and what is still missing for unattended production delivery.

## 1. The shape of the pipeline

```
order / payment / admin action
        │  (business write commits first)
        ▼
notifyOrderEvent(event, reference)          ← awaits only this
        │
        ├── upsert outbox entry  (key = event:reference:role)
        └── kickProcessing()     ← detached, best effort, never rejects
                 │
                 ▼
        attemptDueNotifications(provider?, options?)
                 │
                 ├── recoverExpiredLeases()
                 ├── claim up to 10 due entries atomically
                 ├── render + send through the provider
                 └── settle: sent | failed | uncertain | pending (deferred)
```

Three things can call the processor:

| Caller | Path | Notes |
| --- | --- | --- |
| Background kick | `kickProcessing()` | Latency improvement only |
| Guarded HTTP endpoint | `POST /api/notifications/process` | `Authorization: Bearer <NOTIFICATION_PROCESSOR_SECRET>` |
| Operator CLI | `npm run notifications:process` | Same code, Node with `--conditions=react-server` |

## 2. The guarantee that matters

Order placement, payment confirmation and admin status changes **await only the
enqueue**. Delivery is decoupled:

- The enqueue swallows its own errors, so a queue problem cannot undo a
  committed order.
- The background scan is detached and never rejects.
- A failure of any kind leaves the entry in the queue for the next scan.

The business operation therefore cannot fail, roll back or be slowed by email.

## 3. Claiming and leases

An entry is claimed with one atomic `findOneAndUpdate`:

```
{ status: "pending", nextAttemptAt: { $lte: now } }
  → { status: "processing", leaseToken: <random>, leaseExpiresAt: now + 2 min }
```

Every settlement write includes the `leaseToken`, so a processor whose lease
expired can no longer mark the entry `sent`. A crash therefore leaves an entry
`processing` only until the lease expires; the next scan returns it to `pending`
with `lastReason = "A previous delivery attempt was interrupted before it was
recorded"`, and consumes one attempt.

That is what makes two concurrent processors (a cron and a manual run) safe:
they cannot both send the same entry.

## 4. States

| Status | Meaning |
| --- | --- |
| `pending` | Waiting for its next due time |
| `processing` | Claimed under a lease by one processor |
| `sent` | The provider **accepted** the message |
| `failed` | A permanent failure, or the attempt budget is exhausted |
| `uncertain` | Ambiguous outcome retried to its bound; needs an operator |

`sent` never means "delivered". `providerStatus` starts at `accepted` and only a
verified provider callback may move it to `delivered`, `bounced` or
`complained`. An HTTP 200 from a provider proves acceptance, not arrival.

## 5. Retries, backoff and bounds

| Situation | Behaviour |
| --- | --- |
| Transient failure | `attempts += 1`, backoff 60 s, 2 m, 4 m, 8 m … capped at 1 h |
| Permanent failure | Settled `failed` immediately with a sanitised reason |
| Rate limited | Deferred without consuming an attempt, honouring the provider's `retryAfterMs` (default 15 min) |
| Timeout / network / 5xx | Ambiguous: retried with the **same** idempotency key, up to 2 ambiguous attempts, then `uncertain` |
| No provider configured | Deferred without consuming an attempt, `nextAttemptAt` pushed 15 min forward |
| Quota exhausted | Deferred, `lastReason = QUOTA_REASON`, no attempt consumed |
| Infrastructure failure mid-scan | Claim released, `deferred += 1`, scan stops |

`MAX_NOTIFICATION_ATTEMPTS = 5` and
`MAX_NOTIFICATION_AMBIGUOUS_ATTEMPTS = 2` are the two independent budgets.
Ambiguous outcomes get their own smaller budget because they are the only
failures that risk a duplicate message.

Every send carries a deterministic idempotency key derived from the outbox key,
so a retry after an ambiguous timeout cannot produce a second email even if the
first one was accepted.

## 6. Batch size and quota

- `NOTIFICATION_BATCH_LIMIT = 10` entries per scan.
- `notificationVolume()` counts accepted entries today and this month and stops
  before the configured ceiling (`NOTIFICATION_DAILY_LIMIT`,
  `NOTIFICATION_MONTHLY_LIMIT`; defaults 100/day and 3,000/month).
- Quota is checked per scan, so a burst can never overshoot by more than one
  batch.

## 7. The guarded HTTP endpoint

```
POST /api/notifications/process
Authorization: Bearer <NOTIFICATION_PROCESSOR_SECRET>
```

| Condition | Response |
| --- | --- |
| `NOTIFICATION_PROCESSOR_SECRET` blank | `503` (never open) |
| Missing or wrong bearer | `401` |
| Valid bearer | `200` with bounded counters |

The body is only counters:

```json
{ "processed": 3, "sent": 2, "failed": 0, "deferred": 1,
  "uncertain": 0, "recovered": 0, "quotaBlocked": false }
```

No recipient, reference, subject or provider payload is returned, and an
internal error is replaced with a fixed sentence (a stack trace or connection
string must never reach the caller). Responses are `no-store`.

## 8. The CLI

```bash
npm run notifications:process
```

Runs exactly one bounded scan and exits, closing the Mongoose pool. It uses the
same configuration reader as the route, so it cannot disagree with what the
admin panel reports. Useful for a manual drain after a provider outage, or as
the command a scheduler invokes.

## 9. Scheduling: what is real and what is not

**Real:** the guarded endpoint, the CLI, the opportunistic post-commit scan.

**Not real:** there is no cron, no hosted scheduler and no background worker in
this repository. Automatic delivery between order events depends on a scheduler
the operator has not yet configured. This is documented rather than implied:

- Every entry created between scans waits for the next scan.
- The admin panel shows the pending count, the oldest attempt and the last
  accepted send, so "nothing is draining" is visible instead of silent.
- Until a scheduler exists, the honest statement is: **delivery happens on the
  next order event, a manual admin retry, or a manual processor run.**

A deployment task must add a scheduler that calls the endpoint (or the CLI) on a
short interval and stores the secret outside the repository. That work is
explicitly out of scope for Phase 7.

## 10. Operator retry

`retryNotificationById` (admin Server Action) takes an **entry id only**, never
a recipient or a payload:

- Guards `isValidObjectId`.
- Only `failed` and `uncertain` entries can be requeued.
- Resets `attempts` and `ambiguousAttempts`, clears `lastReason`, sets
  `nextAttemptAt = now`.
- **Keeps the provider idempotency key**, so a retry cannot duplicate a message
  that was actually accepted.

Each retry is audited as `notification.retried` with target type
`notification`, and the UI never exposes an API key, a secret or a recipient
address.

## 11. Verification

| Suite | Covers |
| --- | --- |
| `src/lib/notifications/dispatch.test.ts` | Enqueue idempotency, all three configuration states, backoff, attempt exhaustion, ambiguous → uncertain, lease recovery, quota, retry-by-id |
| `src/lib/notifications/auth.test.ts` | Bearer comparison, blank-secret refusal |
| `src/app/api/notifications/process/route.test.ts` | 503 / 401 / 200, counters, no internal leak |
| `src/lib/notifications/observability.test.ts` | Counts, problem list, reason sanitising, no secrets in readiness |
| `e2e/tracking/tracking.spec.ts` (G) | Real HTTP call against the built server with the file-sink provider |

See `docs/PHASE7_REPORT.md` §M for the executed matrix.
