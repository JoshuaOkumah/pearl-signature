# CLIVS: Guest Email Verification

Phase 7B. The six-digit code that proves a guest controls the email address on an
order, how it is generated, stored, delivered, rate limited and enforced.

## 1. Why verification is mandatory

A guest order has no account, so the only durable identity it can have is the
email address. Phase 5 and Phase 7 protected an order with a random capability
that lived in one tab, which is secure but forgettable: closing the tab lost the
order. Phase 7B makes the email address the recovery route, and that is only
safe if the address is proven before the order exists.

So the rule is absolute:

> No order is created unless the customer has proved, in this session, that they
> control the email address on the order, within the last 30 minutes.

Both payment methods pass through the same check. There is no endpoint, flag or
environment switch that creates an order without it.

## 2. The code itself

| Property | Value |
| --- | --- |
| Length | 6 digits, leading zeroes allowed |
| Source | `crypto.randomInt(0, 1_000_000)`, the platform CSPRNG |
| Lifetime | 10 minutes |
| Wrong attempts | 5 per challenge, then the challenge is dead |
| Reuse | Impossible: `consumedAt` is set atomically on success |
| Resend | Supersedes the previous code immediately |
| Resend cooldown | 60 seconds per address and purpose (configurable) |
| Stored form | HMAC-SHA-256 digest only |

`Math.random()` appears nowhere in this path.

### The digest

```
HMAC-SHA-256(
  key  = GUEST_OTP_SECRET,
  data = challengeId + ":" + normalisedEmail + ":" + purpose + ":" + code
)
```

Three properties matter:

1. **Keyed.** A six-digit code has only a million possible values, so a plain
   `sha256` of it is reversible offline in milliseconds. Without
   `GUEST_OTP_SECRET`, a database dump yields no usable code.
2. **Context-bound.** The digest includes the challenge, the address and the
   purpose, so a digest copied from one challenge cannot be replayed against
   another, or against a different address or purpose.
3. **Constant-time comparison.** `timingSafeEqual` over equal-length hex
   buffers; a malformed digest is rejected before any comparison.

### Legacy codes

Phase 7 issued tracking codes as an unsalted `sha256(code)` and stored them in
the same collection. Those rows are marked implicitly by the absence of
`digestVersion` and remain verifiable through the tracking path only, so an
outstanding code is not broken by the upgrade. Every new code uses
`hmac-sha256-v1`. A legacy row with no email is refused: a capability alone is
not an identity.

## 3. Where codes live

`tracking_challenges` is the single challenge collection. The Phase 7 name is
kept because the collection already existed and TTL-indexed rows must not be
migrated; the model is also exported as `EmailVerificationChallengeModel` for
the broader meaning.

| Field | Meaning |
| --- | --- |
| `challengeId` | 128-bit random id, part of the digest |
| `email` | Normalised address the code was sent to |
| `purpose` | `checkout`, `recovery`, `order_email_change`, `tracking` |
| `reference` | Order reference for `tracking` only, otherwise `null` |
| `codeHash` | Keyed digest, never the code |
| `digestVersion` | `hmac-sha256-v1`, absent on legacy rows |
| `attempts` | Wrong submissions so far |
| `consumedAt` | Set on success or when superseded |
| `lastSentAt` | Drives the resend cooldown |
| `expiresAt` | 10 minutes after issue, TTL-indexed |

Expiry is enforced twice: the TTL index sweeps expired rows, and every read
compares `expiresAt` with the server clock. A TTL sweep is housekeeping, never
the security boundary.

## 4. Purposes

| Purpose | Issued from | Verified from | What success unlocks |
| --- | --- | --- | --- |
| `checkout` | `/checkout` verification panel | same panel | A fresh 30-minute proof for the typed address |
| `recovery` | `/my-orders` and `/track` ("Find my orders") | same form | A rotated remembered-device session |
| `order_email_change` | Owner-assisted correction (documented, not automated) | n/a in the customer UI | A corrected address on an existing order |
| `tracking` | `/track?ref=` recovery form | same form | A scoped grant for one order |

Challenges are scoped by `(email, purpose, reference)`, so a checkout code can
never satisfy a recovery request, and a tracking code for one order can never
open another.

## 5. Delivery

Codes are sent through the existing notification abstraction
(`src/lib/notifications`), using the same provider configuration as order email.

- Delivery is **awaited inline**, not queued. The customer is waiting on this
  code, and a queued retry would only deliver a stale one.
- Success is reported **only when the provider accepted the message**. If the
  provider refuses, the challenge is deleted immediately so the code the
  customer never received cannot remain valid.
- The provider call is bounded, so a slow provider cannot hold the request open.
- In tests and E2E the `file-sink` provider writes the rendered message to a
  git-ignored JSONL file. No real inbox is touched and no real address is used.

### Readiness

`guestVerificationReadiness()` reports `ready` only when **both** of these hold:

| Requirement | Why |
| --- | --- |
| An email provider is configured (`RESEND_API_KEY` plus a verified `EMAIL_FROM`, or the file sink) | Without it no message can be attempted |
| `GUEST_OTP_SECRET` is at least 32 characters | Without it the digest cannot be keyed |

A missing or weak secret is a distinct reason (`missing_otp_secret`,
`weak_otp_secret`), never a silent fallback to an unsalted hash. When readiness
is false:

- the checkout shows "email verification is temporarily unavailable" and refuses
  to place an order;
- recovery answers honestly that codes cannot be sent;
- no order is created and no code is issued.

`RESEND_API_KEY` on its own is **not** proof of deliverability. It only proves a
message can be attempted. Genuine delivery remains unverified until a real key,
a verified sending domain and an owner-approved test message exist.

## 6. Rate limits

All buckets are durable MongoDB rows (`order_attempts`), never in-process
counters, so a restart or a second instance cannot reset them.

| Scope | Budget | Key |
| --- | --- | --- |
| `otp.request` | 10 per 15 minutes | Hashed client address |
| `otp.email` | 5 per 15 minutes | Hashed address and purpose |
| `otp.verify` | 15 per 15 minutes | Hashed client address |

Plus the per-challenge cap of 5 wrong codes, plus the 60-second resend cooldown
on the challenge row.

Deliberate properties:

- The per-email budget is keyed by a **hash**, so the raw address is never
  stored in a rate-limit row.
- A hostile actor can make an address wait, but only until the window rolls. The
  window is short, so a victim is never permanently locked out.
- A tripped limit answers generically and sends nothing.

## 7. Verification and the proof window

A successful `checkout` verification rotates the remembered-device session (see
`GUEST_SESSION_SECURITY.md`) to the proven address and records `verifiedAt`.

`createOrder` requires:

| Check | Failure |
| --- | --- |
| A verified identity was passed in | `verification_required` |
| The identity's email equals the submitted customer email | `verification_required` |
| `verifiedAt` is within `GUEST_CHECKOUT_VERIFICATION_MINUTES` (default 30) | `verification_required` |

The gate runs **before** idempotency, payment readiness or any catalogue work,
so an unverified replay of a real submission returns `verification_required`
rather than a cached success.

The freshness window is configurable but bounded: a value that is not a positive
integer within range falls back to 30 minutes.

## 8. Changing the address

| When | Behaviour |
| --- | --- |
| Before verification | Free. The typed address is what will be verified |
| After verification, before placing the order | Editing the address revokes the local proof; the new address needs its own code |
| After the order is placed | Not possible in the customer UI. The owner can correct it through the audited admin path |

Editing back to the previously verified address still requires a new code: the
proof is revoked on any change, which is what stops one code from silently
covering two addresses.

No private information is ever sent to a new address before it is verified. The
order email change flow sends the confirmation code to the new address and
nothing else; order details continue to go to the address on the order until the
change is confirmed.

## 9. Failure states the customer sees

| Situation | Message |
| --- | --- |
| Wrong code | "That code is incorrect. Check the email and try again." |
| Expired | "That code has expired. Request a new code to continue." |
| Attempts exhausted | "That code has been used too many times. Request a new code to continue." |
| Too many requests | "Too many requests from this connection. Please wait a little while and try again." |
| Verification unavailable | Says so plainly, and confirms any existing order is safe |
| Recovery request | Always the same generic answer, whether or not the address has orders |

## 10. Out of scope

No accounts, no passwords, no social login, no SMS or WhatsApp codes, no paid
verification service, no reusable magic links.

## 11. Verification

| Suite | Covers |
| --- | --- |
| `src/lib/guest/otp.test.ts` | Code shape and entropy, digest binding, legacy digest, constant-time compare, masking, policy bounds |
| `src/lib/guest/challenges.test.ts` | Issue/verify, cooldown, supersede, provider-failure cleanup, attempt cap, single use, legacy rows |
| `src/lib/actions/guest-verification.test.ts` | Generic recovery answers, rate limits, readiness failure, purpose separation |
| `src/lib/orders/create.test.ts` | The gate: no identity, mismatched address, stale proof, canonical address accepted |
| `e2e/orders/orders.spec.ts` | Every placement completes a real code read from the file sink |
