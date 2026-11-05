# PEARL Signature: Guest Session Security

Phase 7B. The remembered-device cookie that lets a guest return to their orders
without an account, and the rules that keep it from becoming a liability.

## 1. The problem it solves

A capability in `sessionStorage` is private but fragile: closing the tab loses
the order. The customer should be able to close the laptop, come back tomorrow,
and still see their orders. That requires something durable, which means a
cookie, which means a new class of risk:

| Risk | Mitigation |
| --- | --- |
| Database dump turns into working cookies | Only a sha256 of the token is stored |
| Cookie stolen by page script | `HttpOnly`: JavaScript cannot read it |
| Cookie sent over plain HTTP | `Secure` in production |
| Cookie leaks to a sibling subdomain | Host-only: no `Domain` attribute |
| Cookie rides along on a cross-site POST | `SameSite=Lax` |
| Stolen cookie lives forever | Absolute 30-day expiry, never extended |
| Old token survives a re-verification | Token rotation on every verification |
| Two people share a phone | One verified email per session, never merged |

## 2. The token

| Property | Value |
| --- | --- |
| Entropy | 32 random bytes from `crypto.randomBytes` |
| Encoding | base64url, 43 characters |
| Effective strength | 256 bits |
| Stored server-side | `sha256(token)`, 64 hex characters |
| Stored client-side | The raw token, in one HttpOnly cookie |
| Lifetime | 30 days, absolute |

The raw token never appears in `localStorage`, `sessionStorage`, a URL, an RSC
payload, a log line or the database. The only place it exists outside memory is
the cookie itself.

## 3. The cookie

Name: `pearl_guest`.

| Attribute | Value | Why |
| --- | --- | --- |
| `HttpOnly` | yes | Page scripts cannot read or exfiltrate it |
| `Secure` | yes in production | Never sent over plain HTTP |
| `SameSite` | `Lax` | Not sent on cross-site POSTs |
| `Path` | `/` | Scoped to this site only |
| `Domain` | not set | Host-only: no sibling subdomain receives it |
| `Max-Age` / `Expires` | 30 days | Explicit, so the browser drops it on schedule |

Cookie writes happen **only in Server Actions**. Next.js 16 forbids setting
cookies during Server Component rendering, and this design depends on that
restriction: a page render can read a session but can never mint one.

## 4. What is stored

`guest_sessions`:

| Field | Meaning |
| --- | --- |
| `tokenHash` | sha256 of the raw token, unique-indexed |
| `email` | The one verified address this session represents |
| `verifiedAt` | When that address was last proved |
| `expiresAt` | Absolute expiry, TTL-indexed |
| `revokedAt` | Set by Forget This Device, by rotation, or by owner action |
| `ipHash` | One-way hash of the client address, for bounded abuse investigation |

No raw IP address, no user agent string, no order data. The orders themselves are
never copied here: they are found by matching `customer.email`.

## 5. Reading a session

Every read follows the same path, and every step can only reject:

```
cookie present?
  └─ token length 32..128?
       └─ sha256(token) matches a row?
            └─ revokedAt is null?
                 └─ expiresAt > now?
                      └─ email is non-empty?
                           └─ identity { email, verifiedAt, expiresAt }
```

A failure at any step returns `null`. The caller then behaves exactly as it
would for a browser that never had a session: no order history, no tracking
access, a fresh verification required. Errors are logged without the token.

The TTL index is housekeeping. Application code always re-checks `expiresAt`, so
a row that has not been swept yet is still refused.

## 6. Rotation

Every successful verification rotates the token:

1. The previous row (if any) is revoked.
2. A new 256-bit token is generated.
3. A new row is written for the newly proven address.
4. The cookie is replaced.

This defeats session fixation: a token that existed before verification can
never become the authenticated token. It also means an old cookie value found in
a backup or a log is dead the moment the customer verifies again.

## 7. Forget This Device

`forgetGuestDeviceAction`:

1. Revokes the row behind the current cookie server-side.
2. Clears the cookie (`Max-Age: 0`).
3. Returns the unauthenticated state.

Revocation is server-side first. Clearing the cookie alone would leave a working
row alive for anyone who had copied the token. After the action, the same
browser sees the recovery form, and Back or Forward cannot resurrect the
previous identity's history because the server no longer recognises the token.

## 8. Shared devices

A session has exactly **one** verified email. There is no list of identities and
no merge.

| Situation | Result |
| --- | --- |
| Second person verifies a different address on the same browser | The token rotates, the identity is replaced, the first person's orders disappear |
| Second person opens `/my-orders` after that | Sees only the newly verified address's orders |
| Either person uses Back | The server re-checks the token and refuses the old view |
| Two addresses somehow present in one request | Impossible: the query is derived from the single session email |

Orders are never merged across addresses. That is the whole point: on a shared
phone, proving one address must not reveal another.

## 9. Guest sessions and admin sessions are separate

| | Guest | Admin |
| --- | --- | --- |
| Cookie | `pearl_guest` | admin session cookie |
| Grants | Order history for one email | Admin surfaces |
| Lifetime | 30 days | short, per admin policy |

A guest cookie grants nothing in `/admin`, and an admin cookie grants no guest
order history. Both directions are covered by the E2E security scenario.

## 10. What a session does and does not authorise

| Action | Requires |
| --- | --- |
| See My Orders | A live session |
| Open one order from My Orders | A live session matching the order's email |
| Place an order | A live session whose `verifiedAt` is within 30 minutes **and** matches the submitted address |
| See an order from `/track?ref=` | A capability, a scoped grant, or a matching live session |
| Admin access | Nothing this cookie can provide |

## 11. Revocation paths

| Trigger | Effect |
| --- | --- |
| Forget This Device | Row revoked, cookie cleared |
| Re-verification | Previous row revoked, new row created |
| Expiry | Refused by application code, swept by TTL |
| Owner action | Documented process; revokes the row for an address |

## 12. Out of scope

No accounts, no passwords, no "remember me" toggle, no cross-device sync of the
cookie itself, no session list in the customer UI, no refresh-token rotation
scheme.

## 13. Verification

| Suite | Covers |
| --- | --- |
| `src/lib/guest/session.test.ts` | sha256-only storage, cookie attributes and host-only scope, expiry, revocation, rotation, Forget This Device |
| `src/lib/actions/guest-verification.test.ts` | Session-derived history, rotation on recovery, revocation |
| `e2e/orders/orders.spec.ts` J1 | Cookie attributes, no token in web storage or URLs, survival across a browser restart |
| `e2e/orders/orders.spec.ts` J5 | Shared-device switch, no merged history, no Back resurrection |
| `e2e/orders/orders.spec.ts` J8 | Guest cookie grants no admin access and vice versa |
