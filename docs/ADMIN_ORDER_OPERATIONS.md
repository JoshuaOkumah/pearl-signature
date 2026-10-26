# PEARL Signature - Admin Order Operations

Phase 5, Milestone D. The operator surfaces for order management:
`/admin/orders`, `/admin/orders/[id]` and the dashboard's order metrics.

## 1. Authorization model

Both routes sit behind the admin layout guard, which resolves the session
cookie against MongoDB on every request and redirects anonymous visitors to
the login screen. On top of that, each mutation re-authorizes inside its own
Server Action through `requireActionAdmin`, so a form post replayed from
somewhere else still needs a live session.

Two failure messages matter to operators:

| Message | Meaning |
| --- | --- |
| `Your session has expired. Please sign in again.` | The action was refused for lack of a live session |
| `This order changed while you were viewing it. Reload the page to see the current state.` | Another operator (or another tab) changed the order first |

Neither message leaks whether some other order exists.

## 2. The order list

`/admin/orders` is a server component: filters arrive validated through
`adminOrderQuerySchema` (`.catch` fallbacks, so a hostile query string
degrades to defaults instead of an error), every filter executes inside
MongoDB, and the pagination count comes from a real count query.

| Control | Values |
| --- | --- |
| Search `q` | Bounded, escaped before it reaches any regular expression |
| Status | Any of the seven lifecycle states |
| Payment | `unpaid`, `paid` |
| Page | 1 upward, `pageSize` up to 50 |

Presentation is responsive rather than squeezed: a table on tablet and
desktop, stacked cards on small screens, so a status, a payment badge and a
total are never truncated into an unreadable column. Each row shows the
reference as a link, the lifecycle badge, the payment badge, the total and
the date.

An empty result is a real state with a reset control, not a blank panel.

## 3. The order detail page

`/admin/orders/[id]` uses the public reference as the identifier. It is
URL-safe, already unique-indexed, and malformed values are rejected before
any database read, so a garbage identifier can never reach a query.

The page shows, in panels:

- **Status**: current status, fulfilment method, and exactly the transition
  buttons that are legal for this order right now.
- **Payment**: method, status, who recorded it and when.
- **Customer**: name, email, phone.
- **Fulfilment**: method, address or pickup instructions, service area
  label, instructions and notes.
- **Items**: name, variant, quantity, unit price, line total (the frozen
  snapshot).
- **Money**: subtotal, delivery fee, tax with its label, total.
- **History**: every status event with actor and timestamp.
- **Notes**: operator notes, bounded at 20 per order.

## 4. Confirmation dialogs

Three actions are destructive or irreversible in the operator's mind and
therefore require a two-step control: **cancellation, completion and payment
recording**. The first press arms the button and changes its label to the
consequence (`Confirm cancellation`, `Confirm completed`,
`Confirm payment received`); the second press submits. Moving focus away
disarms it.

Ordinary forward transitions (`Mark as confirmed`, `Mark as preparing`,
`Mark as ready for pickup`, `Mark as out for delivery`) submit on a single
press because they are the normal path and are themselves reversible by a
later step.

## 5. Cancellation

Cancelling requires a reason. Submitting without one returns the field error
`Add a reason for cancelling this order` and writes nothing. The reason is
stored, shown on the detail page and recorded in the status history.

Cancellation never touches payment: a cancelled unpaid order is simply no
longer outstanding money.

## 6. Payment recording

See `docs/CASH_ON_ARRIVAL.md`. Summary: the form carries only the reference
and the version token, a second record is refused even with a current token,
and recording payment never changes the lifecycle status.

## 7. Notes

Notes append without bumping `version`, so an operator writing context
cannot invalidate a colleague's pending status change. Twenty notes maximum
per order, each 500 characters.

## 8. Dashboard metrics

Five cards under `Order statistics`, aggregated from real order records in
one round trip: Orders, In progress, Awaiting payment, Outstanding,
Collected. Definitions are in `docs/BUSINESS_CONFIGURATION.md` and are
enforced by `src/lib/repositories/admin.ts`.

The rule worth repeating: an unpaid Cash on Arrival order counts toward
outstanding money and never toward collected revenue, and a cancelled unpaid
order drops out of outstanding money while still counting as an order.

## 9. Responsiveness and accessibility

The order surfaces follow the same rules as the rest of the admin area:
verified from 320 to 1440 pixels and in landscape, stacked cards instead of
compressed tables on small screens, visible `focus-gold` rings on every
control, and no motion that ignores `prefers-reduced-motion`. Alert regions
use `role="alert"` for errors and `role="status"` for confirmations, so a
screen reader hears the outcome of an action without hunting for it.

## 10. What was verified

Playwright scenarios C, D and E in `e2e/orders/orders.spec.ts` cover
payment recording and double-recording refusal, both lifecycles, an illegal
transition injected into the live form, a stale version token, cancellation
without a reason, signed-out page access and a signed-out action. Results
are recorded in `docs/PHASE5_REPORT.md`.
