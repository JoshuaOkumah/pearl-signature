# PEARL Signature - Order Lifecycle

Phase 5, Milestones C and D. This document is the operator-facing and
developer-facing description of how an order moves from placement to a final
state, which moves are legal, and how two operators are prevented from
overwriting each other.

The rules live in one module, `src/lib/orders/lifecycle.ts`. It is pure and
isomorphic, so it runs in two places for one reason: the UI decides which
buttons to offer from it, and the Server Action re-decides from it against
the freshly loaded order. The button list is a convenience; the server-side
call is the authority.

## 1. The two axes

An order carries two independent states, and they never change each other.

| Axis | Field | Values | Who changes it |
| --- | --- | --- | --- |
| Fulfilment lifecycle | `status` | `placed`, `confirmed`, `preparing`, `ready_for_pickup`, `out_for_delivery`, `completed`, `cancelled` | Admin status actions |
| Payment | `payment.method` + `payment.status` | `cash_on_arrival` + `unpaid` or `paid` | Admin payment recording only |

Completing an order does not mark it paid. Cancelling a Cash on Arrival order
does not record a refund for money that was never collected. This separation
is what lets a later payment phase add Stripe without touching order
storage.

## 2. The graph

```
placed --> confirmed --> preparing --+--> ready_for_pickup --> completed
   |          |            |          +--> out_for_delivery   --> completed
   +----------+------------+--> cancelled   (not from out_for_delivery)
```

Expressed as data:

| From | Allowed next states |
| --- | --- |
| `placed` | `confirmed`, `cancelled` |
| `confirmed` | `preparing`, `cancelled` |
| `preparing` | `ready_for_pickup`, `out_for_delivery`, `cancelled` |
| `ready_for_pickup` | `completed`, `cancelled` |
| `out_for_delivery` | `completed` |
| `completed` | (none) |
| `cancelled` | (none) |

Two properties fall out of this shape:

- **Terminal states are terminal.** `completed` and `cancelled` have no
  outgoing edges, so history is never rewritten after an order is finished.
- **Cancellation stops at the door.** An order can be cancelled up to and
  including `ready_for_pickup`, but not from `out_for_delivery`, because it
  has physically left the store and "cancelled" would misdescribe what
  happened.

## 3. Method awareness

A generic transition map would happily offer every edge to every order, so
`canTransition` adds a second filter keyed on `fulfillment.method`:

- `ready_for_pickup` is only reachable by a **pickup** order.
- `out_for_delivery` is only reachable by a **delivery** order.

Consequences for the operator:

- A pickup order never shows, and never accepts, "Out for delivery". Its
  path is `placed -> confirmed -> preparing -> ready_for_pickup ->
  completed`.
- A delivery order never shows, and never accepts, "Ready for pickup".

`availableTransitions(status, method)` produces exactly the buttons the
detail page renders, so the UI never advertises a move that would be
refused.

## 4. Refusal messages

`transitionRejection(from, to, method)` returns `null` when a move is legal,
otherwise one specific sentence. The distinctions are deliberate, because
different mistakes need different fixes:

| Situation | Message |
| --- | --- |
| Edge does not exist | `An order cannot go from {from} to {to}.` |
| Terminal state, any target | `This order is already {status}. Its status cannot change again.` |
| Same state twice | `The order is already in that state.` |
| Pickup order sent out for delivery | `Only delivery orders can be marked out for delivery.` |
| Delivery order marked ready for pickup | `Only pickup orders can be marked ready for pickup.` |

The same strings appear in the unit tests, so wording changes are caught by
`npm run test` rather than by an operator noticing.

## 5. Optimistic concurrency

Every admin mutation form carries a hidden `expectedVersion`, and every
mutation filters on it:

```
{ _id, reference, version: expectedVersion }  ->  update one, $inc version
```

If the filter matches nothing, the action returns `CONFLICT` and no write
happens:

> This order changed while you were viewing it. Reload the page to see the
> current state.

This is what makes two open windows safe. Whichever operator submits second
is told to reload instead of silently overwriting the first one's change.
`version` starts at 1 and increments on every status change, payment
recording and note addition.

## 6. Cancellation reasons

Cancelling requires a reason. With no reason the action returns a field
error:

> Add a reason for cancelling this order

The reason is stored in `cancellationReason` (300 characters maximum) and
appears on the detail page and in the status history. A reason is operator
input, not a place for customer personal data.

## 7. Status history

Every status change appends to `statusHistory`:

| Field | Meaning |
| --- | --- |
| `from` | Previous status, `null` for the initial placement event |
| `to` | New status |
| `at` | Timestamp |
| `adminId` | Operator id, `null` for the customer's placement |
| `note` | Short operator note, 300 characters maximum |

The array is bounded at `MAX_STATUS_HISTORY` (40) so a document can never
grow without limit. The placement event is written by order creation, so a
new order already has one history row showing where it started.

## 8. Where the rules are enforced

1. **Detail page rendering** calls `availableTransitions` to decide which
   buttons exist at all.
2. **`changeOrderStatusAction`** validates the request with an allowlist
   schema, loads the order, runs `transitionRejection` against that freshly
   loaded status and method, then performs the versioned update.
3. **Unit tests** in `src/lib/orders/lifecycle.test.ts` cover every edge,
   every method restriction, every terminal state and every message.
4. **Playwright scenario D** (`e2e/orders/orders.spec.ts`) walks both
   lifecycles in a browser, rewrites a hidden `to` field in the live DOM to
   request an illegal move, and confirms the refusal and the unchanged
   status.

Nothing else in the codebase writes `status`. Payment recording updates only
`payment.*` plus `version`, and operational notes update only `notes` and
deliberately do NOT bump `version`, so a note written by one operator cannot
invalidate another operator's pending status change.
