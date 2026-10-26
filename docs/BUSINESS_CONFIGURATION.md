# PEARL Signature - Business Configuration

Phase 5, Milestone A. Everything a business must decide before a customer can
place a real order lives in one owner-managed document: the `store_configs`
singleton (`_id: "checkout"`). Nothing about fulfilment, fees or tax is
hardcoded anywhere in the codebase.

## 1. The configuration surface

| Group | Fields | Effect when missing |
| --- | --- | --- |
| Order intake | `orderIntakeEnabled` | Checkout blocked with `intake_closed` |
| Delivery | `delivery.enabled`, service areas (label, provinces, postal prefixes, fee) | Delivery unavailable, or `area_unsupported` for an unserved address |
| Pickup | `pickup.enabled`, pickup instructions | Pickup unavailable; enabling pickup without instructions is a validation error |
| Tax | mode (`unconfigured`, `zero`, `rate`), rate in basis points, base (`merchandise` or `with_delivery`), label | `tax_unconfigured` blocks submission |

Service areas: up to 20, each with 1 to 13 Canadian province or territory
codes, optional three-character forward sortation area prefixes (empty means
the whole province), and a delivery fee in integer cents. A malformed area is
dropped rather than rendered with a wrong fee.

Tax modes:

- `unconfigured` - no treatment decided. Blocks ordering.
- `zero` - the owner has confirmed that nothing is charged. Still requires
  an explicit confirmation in the settings form.
- `rate` - an owner-attested rate in basis points plus a base. A rate
  without a rate value or a base is treated as `unconfigured`, never as
  zero.

There is no hardcoded Canadian tax rate, no default delivery fee and no
assumed pickup address anywhere.

## 2. What the customer sees

`checkoutBlockers(settings)` produces the honest states shown on
`/checkout`:

| Blocker | Customer-facing meaning |
| --- | --- |
| `settings_unavailable` | Configuration cannot be read right now |
| `intake_closed` | Ordering is temporarily closed |
| `no_fulfillment_method` | Neither delivery nor pickup is offered |
| `tax_unconfigured` | Totals cannot be completed yet |
| `method_unavailable` | The chosen method is switched off |
| `area_unsupported` | This address is outside the served area |
| `total_out_of_bounds` | The computed total is out of range |

The same blockers gate order creation server-side, so a customer cannot
submit through a modified client when the store is not ready.

## 3. Where configuration is edited

`/admin/settings` (owner session required). The form validates consistency
before saving:

- Delivery on with no service area: `Add at least one service area, or turn
  delivery off`.
- Pickup on with no instructions: `Describe where and how pickup works
  before offering it`.
- Tax mode `rate` with a bad rate: `Enter the approved rate as a percentage,
  for example 13`, or `Choose what the rate applies to` when no base is
  selected.
- Intake on with neither method: `Turn on delivery or pickup before
  accepting orders`.
- Intake on with tax unconfigured: `Confirm the tax treatment before
  accepting orders`.

Reads are defensive: a corrupt tax block resolves to `unconfigured` (which
blocks) rather than to a silent $0 tax.

## 4. Snapshots, not live settings

An order stores the configuration that priced it: the service area label,
the delivery fee, the tax label, the tax rate in basis points and the pickup
instructions in effect. Changing settings afterwards never rewrites an
existing order.

## 5. Test-only configuration

Automated tests use explicitly labelled synthetic policies. The disposable
Playwright stack (`scripts/e2e-orders-server.ts`) seeds a store
configuration named for testing with a labelled service area, a stated fee
and an "E2E test HST" rate, plus clearly named `E2E` products. None of this
exists in `next dev`, in `next build`, in production, or in any other e2e
project.

The public preview fixtures remain unpriced (`priceCents: null`), so the
storefront never displays a price the business has not confirmed.

## 6. Manual business configuration checklist

Complete this before the first real order. Every item is a business
decision; none can be filled in by a developer.

**Identity and contact**

- [ ] Business name confirmed for customer-facing copy.
- [ ] Contact email configured (used for order notifications to the store).
- [ ] Owner admin account credentials secured and stored safely.

**Fulfilment**

- [ ] Pickup offered? If yes: pickup address, hours and instructions written
      out in the settings form.
- [ ] Delivery offered? If yes: for each area, the area name, the provinces
      served, any postal prefixes, and the delivery fee in dollars.

**Tax**

- [ ] Tax treatment chosen: zero-rated, or a specific rate.
- [ ] For a rate: the exact percentage and whether it applies to merchandise
      only or to merchandise plus delivery.
- [ ] The label customers will see (for example the statutory abbreviation)
      entered exactly as it should appear.
- [ ] The owner has confirmed that the rate and base match what they will
      actually charge and remit.

**Payment**

- [ ] Cash on Arrival confirmed as the accepted method for launch.
- [ ] The person who records payments on arrival is identified and has an
      admin account.

**Notifications**

- [ ] A notification provider chosen and registered in a later phase, or the
      team accepts that outbox entries will remain `pending` with the reason
      `Notification provider not configured`.

**Before going live**

- [ ] Order intake switched on only after the checklist above is complete.
- [ ] A test order placed and walked through to `completed`, then the test
      data removed or clearly identified.
- [ ] Prices on the real catalogue confirmed by the business (the preview
      fixtures are unpriced on purpose).
