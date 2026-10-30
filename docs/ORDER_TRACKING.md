# PEARL Signature: Order Tracking

Phase 7. The guest-facing `/track` page, the private access model behind it, and
the cross-device email recovery flow.

## 1. The problem

A guest order has no account. In Phase 5 the only way to see an order was the
confirmation page, opened with a random capability stored in that tab's
`sessionStorage`. That is secure but fragile: closing the tab, switching device
or clearing storage loses the order forever, and the reference alone must never
be enough to open somebody else's order.

Phase 7 adds two access paths and keeps both private:

| Path | Who has it | Where the secret lives |
| --- | --- | --- |
| Capability | The browser that placed the order | `sessionStorage` (`pearl-confirmations-v1`) |
| Scoped grant | A device that verified the order's email address | `sessionStorage` (`pearl-tracking-grants-v1`) |

The URL only ever carries the public reference (`/track?ref=PS-XXXXXXXXXX`),
which grants nothing on its own. A shared or forwarded link cannot expose an
order.

## 2. What the server stores

| Collection | Fields | Notes |
| --- | --- | --- |
| `tracking_challenges` | `reference`, `codeHash`, `attempts`, `consumedAt`, `expiresAt` | Only the sha256 of the six-digit code |
| `order_access_grants` | `reference`, `orderId`, `tokenHash`, `expiresAt`, `revokedAt` | Only the sha256 of the grant token |

Both have TTL indexes. Neither stores a plaintext code or token, and neither
stores an email address: the address is compared against the order at request
time and never copied.

## 3. Same-device access

`loadOrderTrackingAction` accepts either a capability or a grant:

1. It consumes one `order.lookup` rate-limit token for the caller's address
   (30 per 15 minutes).
2. It looks up the order by reference.
3. It compares `sha256(accessKey)` with the stored `confirmationKeyHash`, or
   `sha256(grantKey)` with a live, unexpired grant scoped to that order.
4. A mismatch and a missing order return the **same** `not_found`.

There is no reference-only lookup anywhere in the codebase.

## 4. Cross-device recovery

```
reference + email
      │
      ▼  POST requestTrackingCodeAction
  generic { ok: true }  ── always, whether or not the pair matches
      │
      └─ if it matches: create challenge, email a 6-digit code INLINE
      │
      ▼  POST verifyTrackingCodeAction
  { ok: true, grantKey }  ── or { ok: false, reason: "invalid" }
      │
      ▼  grant stored in this tab's sessionStorage (24 h)
```

Properties:

| Property | Value |
| --- | --- |
| Response to a non-matching pair | Identical generic success (no enumeration) |
| Code length | 6 digits |
| Code lifetime | 10 minutes |
| Code attempts | 5 per challenge, then the challenge is dead |
| Code reuse | Impossible: `consumedAt` is set atomically on success |
| Only the newest challenge | Honoured; an older code is refused |
| Grant lifetime | 24 hours, TTL-indexed |
| Grant scope | One order reference |
| Request rate limit | 5 per 15 minutes per address |
| Verify rate limit | 10 per 15 minutes per address |
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

## 6. Page behaviour

- **Private by default:** `robots: noindex, nofollow`, and the order is fetched
  client-side, so no customer data is rendered on the server, written into an
  RSC payload or cached in a shared store.
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
| No capability and no grant | "This order needs private access" + recovery form |
| Wrong capability | "We could not open that order" (same as unknown) |
| Expired or revoked grant | The grant is forgotten and the recovery form returns |
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
| `src/lib/orders/tracking.test.ts` | Timeline per method, completed/cancelled rules, payment copy matrix |
| `e2e/tracking/tracking.spec.ts` | A–H browser matrix (same-device, reference-only, wrong capability, cross-device recovery, attempt cap, no enumeration, admin readiness + guarded processor, manual refresh) |

Polling is covered by the Vitest matrix and the manual checklist rather than a
30-second Playwright wait; see `docs/PHASE7_REPORT.md` §M for that decision.
