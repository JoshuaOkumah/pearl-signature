# CLIVS: Order Tracking

Phase 7 built the guest-facing `/track` page, the private access model behind it,
and the cross-device email recovery flow. Phase 7B added a third access path (a
remembered device) and made `/my-orders` the primary destination.

## 1. The problem

A guest order has no account. In Phase 5 the only way to see an order was the
confirmation page, opened with a random capability stored in that tab's
`sessionStorage`. That is secure but fragile: closing the tab, switching device
or clearing storage loses the order forever, and the reference alone must never
be enough to open somebody else's order.

Phase 7 added two access paths and kept both private. Phase 7B added a third,
durable one:

| Path | Who has it | Where the secret lives | Scope |
| --- | --- | --- | --- |
| Capability | The browser that placed the order | `sessionStorage` (`pearl-confirmations-v1`) | One order, this tab |
| Scoped grant | A device that verified the order's email address | `sessionStorage` (`pearl-tracking-grants-v1`) | One order, 24 hours |
| Remembered device | A device that verified an email address | `pearl_guest` HttpOnly cookie | Every order for that email, 30 days |

The URL only ever carries the public reference (`/track?ref=PS-XXXXXXXXXX`),
which grants nothing on its own. A shared or forwarded link cannot expose an
order.

**Phase 7B:** `/my-orders` is the primary destination (email-only recovery, then
the full history). `/track?ref=` remains for direct links from a confirmation
page or an order email, and now also accepts the remembered device.

## 2. What the server stores

| Collection | Fields | Notes |
| --- | --- | --- |
| `tracking_challenges` | `challengeId`, `email`, `purpose`, `reference`, `codeHash`, `digestVersion`, `attempts`, `consumedAt`, `lastSentAt`, `expiresAt` | Keyed HMAC digest for new codes; legacy sha256 rows tracking-only |
| `order_access_grants` | `reference`, `orderId`, `tokenHash`, `expiresAt`, `revokedAt` | Only the sha256 of the grant token |
| `guest_sessions` | `tokenHash`, `email`, `verifiedAt`, `expiresAt`, `revokedAt`, `ipHash` | Only the sha256 of the opaque cookie token |

All three have TTL indexes. None stores a plaintext code or token. The session
stores the verified address, which is what makes email-wide history possible;
the grant and challenge do not.

## 3. Same-device access

`loadOrderTrackingAction` accepts any of three proofs, tried in this order:

1. The Phase 5 confirmation capability for this order.
2. A live, unexpired scoped grant for this order.
3. The Phase 7B remembered-device session, whose verified email must equal the
   order's `customer.email`.

Before any of that it consumes one `order.lookup` rate-limit token for the
caller's address. A presented capability or grant that does not match returns
`not_found`. A browser that presents no local proof but has no matching session
returns `no_access`, which shows the private-access notice rather than implying
the order does not exist.

There is no reference-only lookup anywhere in the codebase.

## 4. Cross-device recovery

Phase 7B splits recovery into two entry points:

- `/my-orders` (and `/track` with no `ref`): **email only**. No reference. This
  is "Find my orders" and it unlocks the whole history for that address.
- `/track?ref=`: **reference plus email**, which unlocks one order through a
  scoped grant.

```
email only (Find my orders)
      │
      ▼  POST requestRecoveryCodeAction
  generic { ok: true }  ── always, whether or not the address has orders
      │
      ▼  POST verifyRecoveryCodeAction
  { ok: true }  ── session rotated to the proved address
      │
      ▼  GET /my-orders  → every order for that email
```

```
reference + email (one order)
      │
      ▼  POST requestTrackingCodeAction
  generic { ok: true }  ── always, whether or not the pair matches
      │
      ▼  POST verifyTrackingCodeAction
  { ok: true, grantKey }  ── or { ok: false, reason: "invalid" }
      │
      ▼  grant stored in this tab's sessionStorage (24 h)
```

Properties:

| Property | Value |
| --- | --- |
| Response before verification | Identical generic success (no enumeration) |
| Code length | 6 digits |
| Code lifetime | 10 minutes |
| Code attempts | 5 per challenge, then the challenge is dead |
| Code reuse | Impossible: `consumedAt` is set atomically on success |
| Only the newest challenge | Honoured; an older code is refused |
| Grant lifetime | 24 hours, TTL-indexed |
| Grant scope | One order reference |
| Session lifetime | 30 days, absolute |
| Session scope | Every order for one email |
| Request rate limit | 5 per 15 minutes per address (tracking), plus `otp.*` scopes |
| Verify rate limit | 10 per 15 minutes per address (tracking), plus `otp.*` scopes |
| Plaintext stored | Never |

The verification email is the **single documented exception** to queue-only
sending: it is a time-boxed security challenge the customer is waiting on, so it
is sent inline rather than through the outbox. A queued retry would only deliver
a stale code.

When email is not configured, both recovery actions return
`{ ok: false, reason: "unavailable" }` and the UI says recovery is unavailable.
Nothing pretends a code was sent.


## 5. Why no capability appears in a link

An emailed or copied link is the least private artefact in the system: it ends up
in browser history, chat logs, referrer headers and screenshots. Putting a
capability in a URL would turn "anyone with the link" into "anyone with the
order". So:

- The tracking email contains a link with the reference only.
- The confirmation page's "Track this order" link carries the reference only.
- The grant is created by verification and stored locally, never transmitted in
  a URL.
- The remembered-device token lives only in an HttpOnly cookie; it never appears
  in a URL, web storage, an RSC payload or a log line.

## 6. Page behaviour

- **Private by default:** `robots: noindex, nofollow`, and the order is fetched
  client-side, so no customer data is rendered on the server, written into an
  RSC payload or cached in a shared store.
- **One server read on load (Phase 7B):** the client always asks the server once,
  because the remembered device is an HttpOnly cookie it cannot inspect. The
  server answers with the order, `no_access` or `not_found`.
- **Timeline per fulfilment method:** delivery shows *Order received →
  Confirmed → Preparing → Out for delivery → Completed*; pickup shows *Ready for
  pickup* instead of *Out for delivery*. Never both.
- **Completed orders** show every step complete and no "Now" badge.
- **Cancelled orders** never show a completed step and never show a current
  step; the cancellation is stated plainly.
- **Payment states are literal:** Cash on Arrival is not "paid" until the owner
  records collection. A confirmed refund says "Refund confirmed". A pending or
  failed refund is never described as money returned. Review states tell the
  customer no action is needed rather than inventing one.
- **No invented statuses:** every label maps to a stored status or a stored
  payment fact.
- **Live refresh:** the page polls every 30 seconds, pauses while the tab is
  hidden, stops at `completed`/`cancelled`, offers a manual **Refresh**, and
  ignores a stale response that resolves after a newer one. There is no paid
  realtime infrastructure.

## 7. Failure and refusal states

| Situation | What the customer sees |
| --- | --- |
| No capability, no grant, no matching session | "This order needs private access" + recovery form |
| Wrong capability or grant | "We could not open that order" (same as unknown) |
| Expired or revoked grant | The grant is forgotten and the recovery form returns |
| Expired or forgotten device | The recovery form returns; My Orders shows Find my orders |
| Rate limited | "Too many attempts", with the recovery form hidden |
| Email not configured | "Tracking is unavailable right now"; recovery says so |
| Database error | "Tracking is unavailable right now"; the order is still stored |

## 8. Out of scope

No accounts, no passwords, no SMS or WhatsApp codes, no GPS or map tracking, no
push notifications, no order editing, no cancellation by the customer.

## 9. Verification

| Suite | Covers |
| --- | --- |
| `src/lib/actions/tracking.test.ts` | Capability/grant access, cross-order grant refusal, expiry, single-use, attempt cap, newest-challenge rule, generic responses, rate limits, hash-only storage |
| `src/lib/actions/guest-verification.test.ts` | Session-derived history, recovery rotation, Forget This Device |
| `src/lib/guest/challenges.test.ts` | HMAC challenge issue/verify, cooldown, supersede, provider failure, legacy rows |
| `src/lib/orders/tracking.test.ts` | Timeline per method, completed/cancelled rules, payment copy matrix |
| `e2e/tracking/tracking.spec.ts` | A–H browser matrix (same-device, reference-only, wrong capability, cross-device recovery, attempt cap, no enumeration, admin readiness + guarded processor, manual refresh) |
| `e2e/orders/orders.spec.ts` J1–J10 | Browser restart, other device, multiple orders, email change, shared device, progress, cash honesty, guest/admin isolation, mobile |

Polling is covered by the Vitest matrix and the manual checklist rather than a
30-second Playwright wait; see `docs/PHASE7_REPORT.md` §M for that decision.

