# CLIVS: My Orders Experience

Phase 7B. The customer-facing order history, the email-only recovery in front of
it, and the labels that tie tracking together across the site.

## 1. What the customer can now do

| Before Phase 7B | After Phase 7B |
| --- | --- |
| See an order only in the tab that placed it | See every order for a verified email, on any device |
| Lose the order when the tab closes | Come back in 30 days and still be signed in |
| Need the reference to track anything | Type only an email address |
| No place to see past orders | `/my-orders` |

No account, no password, no app.

## 2. The journey

```
/menu  →  /checkout  →  verify email  →  place order  →  /order-confirmation
                                                              │
                                        ┌─────────────────────┴──────────────────┐
                                        ▼                                        ▼
                                  Track Order                              View My Orders
                                  (/track?ref=…)                              (/my-orders)
```

Later, from any device:

```
/my-orders  →  type email  →  code arrives  →  verify  →  every order for that address
```

## 3. `/my-orders`

The page is rendered per request, never prerendered: the remembered-device cookie
decides whether it shows history or the recovery form. A shared shell would be
wrong here, so the segment opts out of static prerendering and awaits
`connection()`.

### Signed in

| Element | Detail |
| --- | --- |
| Verified email card | Masked address (`a***@example.com`), the 30-day reminder, and **Forget this device** |
| Groups | **In progress**, **Completed**, **Cancelled**, each with a count |
| Order card | Reference, placement date, item summary, fulfilment method, payment method and status, total, **View Order** |
| Paging | 10 orders per page, server-side, with previous and next controls |

Grouping is by stored status only:

- `cancelled` is its own group, so a cancelled order is never mistaken for work
  in progress;
- `completed` is its own group;
- everything else is **In progress**.

An order's payment line is literal. Cash on arrival reads "Cash on arrival /
Unpaid" until the owner records collection. Nothing is described as paid because
the order exists.

### Not signed in

- The email-only **Find my orders** form.
- If verification cannot be delivered at all, an honest notice instead of a form
  that would fail, plus **Browse the menu**.

### Empty history

A verified address with no orders gets an honest empty state: "You haven't placed
any orders yet", the masked address, and **Browse the menu**. This is deliberately
reachable, because an address with no history must be indistinguishable from one
with history *before* verification, and after verification there is nothing to
hide.

## 4. Find my orders (email-only recovery)

One field: the email address. No reference, no order number, no account.

| Step | What happens |
| --- | --- |
| Submit an address | `requestRecoveryCodeAction` answers the same generic message whether or not orders exist |
| Code arrives | Six digits, 10-minute expiry, 5 attempts |
| Verify | `verifyRecoveryCodeAction` rotates the remembered-device cookie to that address |
| Result | The list is loaded from the server's view of that address |

Security properties:

- The response before verification never confirms that an address has orders.
- Rate limits and a provider failure still produce the same generic answer.
- The browser never supplies an email to the history read; the server uses the
  session it just verified.
- A code for one address cannot open another address's orders.

### Lost access to the email

Documented, not automated: the customer contacts the kitchen, and the owner can
verify the order another way. The UI says so under the form. A phone number or a
reference alone never opens an order.

## 5. Opening one order

**View Order** navigates to `/track?ref=PS-XXXXXXXXXX`, which reuses the Phase 7
tracking page: timeline per fulfilment method, item table, money breakdown,
payment summary, fulfilment panel and private-access note. My Orders is the
scannable index; tracking is the detail view. Nothing is duplicated.

`loadOrderTrackingAction` accepts three kinds of proof, in this order:

1. the Phase 5 confirmation capability in this tab's `sessionStorage`;
2. a scoped grant from verifying the order's email;
3. the Phase 7B remembered-device session, whose email must match the order.

A reference on its own still opens nothing.

## 6. Confirmation page

After placing an order:

| Element | Detail |
| --- | --- |
| Reference | Prominent, with "Keep this reference handy" |
| Payment state | Literal: cash is not paid; a Stripe order shows its real state |
| **Track Order** | Primary action to `/track?ref=…` |
| **View My Orders** | Secondary action to `/my-orders` |
| How updates reach you | Explains email updates and that My Orders works on this device or after verifying elsewhere |

The confirmation survives closing and reopening the browser. `accessKey` is
optional on the confirmation request: when the tab's capability is gone, the
server falls back to the remembered-device session, so a customer who restarts
their browser still sees their order. A viewer with neither gets a plain notice
that the order is not open on this device, plus the recovery route.

## 7. Navigation and labels

One primary label, used consistently:

| Surface | Label | Destination |
| --- | --- | --- |
| Desktop header | **My Orders** | `/my-orders` |
| Mobile menu | **My Orders** | `/my-orders` |
| Footer, Explore | **My Orders** | `/my-orders` |
| Footer, Explore | **Track an order** | `/track` |
| Confirmation | **Track Order** | this order |
| Confirmation | **View My Orders** | history |
| Order email | **Track My Order** | `/my-orders` |
| My Orders card | **View Order** | this order |

"Track Order" is an action on a specific order; "My Orders" is the destination.
Emails link to the public entry point only, never to a URL carrying a credential.

## 8. Copy rules

- No em dashes in customer-facing copy.
- No invented statuses, prices or delivery promises.
- Cash is never called paid before collection is recorded.
- Gold text on cream uses the darker `gold-700` token.
- Empty and unavailable states always say what is safe and what to do next.

## 9. Accessibility

- The code field is a single labelled input with `inputMode="numeric"`,
  `autoComplete="one-time-code"` and a six-digit pattern, so mobile keyboards
  offer numbers and paste works.
- Errors are announced through `role="alert"`; successes through an
  `aria-live="polite"` region.
- Every interactive element has a visible `focus-gold` ring.
- Motion respects the user's reduced-motion setting.

## 10. Responsive behaviour

Verified at 320, 360, 375, 390, 430, 667 (landscape), 768, 1024 and 1440 px:

- The verified-email card stacks on phones and becomes one row from `sm`.
- Order cards never widen the page; long item summaries truncate inside the card.
- Actions wrap instead of overflowing; at 320 px **View Order** and **Order
  again from the menu** sit on separate lines.
- No horizontal overflow is detected at any width (see `npm run screenshots`).

## 11. Failure states

| Situation | What the customer sees |
| --- | --- |
| Session expired between render and read | "This device is no longer remembered", then the recovery form |
| Verification unavailable | Honest notice, Browse the menu, and a note that existing orders are safe |
| Database error | "We could not load your orders right now. They are safe." with Try again |
| Rate limited | "Too many requests from this connection" with Try again |
| Wrong or expired code | A specific message and a way to request a new code |
| Forget this device | Straight back to the recovery form, with no history behind it |

## 12. Out of scope

No accounts, no order editing, no customer-initiated cancellation, no reorder
automation (the link simply goes back to the menu), no invoices or receipts
beyond what the order already shows, no loyalty or credits.

## 13. Verification

| Suite | Covers |
| --- | --- |
| `src/lib/actions/guest-verification.test.ts` | Session-derived history, pagination, counts, masking, generic recovery, Forget This Device |
| `src/lib/orders/tracking.test.ts` | Grouping and item-summary rules |
| `e2e/orders/orders.spec.ts` J2–J7, J10 | Different device, multiple orders, email change, shared device, admin progress, cash honesty, empty recovery |
| `e2e/orders/orders.spec.ts` J1, J9 | Browser restart and 390 px mobile journey |
| `npm run screenshots` | My Orders, confirmation and tracking at every reference width |
