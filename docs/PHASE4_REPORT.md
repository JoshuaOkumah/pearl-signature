# PEARL Signature — Phase 4 Report

## A. Summary and status

Phase 4 implements a guest cart, a cart drawer, `/cart`, server-verified
catalogue quotes and a review-only `/checkout` foundation. The work is
implemented and awaiting business review. It does not create orders, take
payments or reserve stock.

## B. Approved scope

Included: product/option cart identity, local persistence, quantity and line
editing, authoritative quote/reconciliation, honest blocked/error states,
Canadian form validation in the browser, and responsive/accessibility review.

Excluded: order submission, Stripe or cash collection, inventory reservation,
promo codes, customer accounts, delivery pricing/coverage, tax calculation,
pickup scheduling and deployment.

## C. Cart identity and persistence

Lines are identified by `(slug, variantName)`; database `_id` never reaches
browser storage. `pearl-cart-v1` stores version 1 lines with slug, option,
quantity and a non-authoritative last-seen price hint. Requests strip that
hint. Full details are in `docs/CART_ARCHITECTURE.md`.

## D. Limits and validation

Client and server enforce at most 25 units per line, 99 units per cart and 30
distinct lines. Zod validates slug and option text, integer quantities, total
units and duplicate identities. Browser storage is treated as untrusted.

## E. Server-authoritative quote

`quoteCartAction` is a read-only Server Action. It accepts only slug, option
and quantity, uses bounded catalogue reads, and derives current product names,
availability, option eligibility and prices from the public catalogue. Draft,
archived, disabled-category and unknown slugs are masked as `not_found`.
Nothing is cached or written.

## F. Reconciliation and price honesty

Cart changes trigger a 200ms debounce; monotonic sequence numbers discard
out-of-order responses. Prices are hidden while checking or after quote
failure. A changed price shows the old and current figures; only the current
server quote is used. Delivery and tax are not shown as zero, and no final
total is claimed. A successful quote with no purchasable lines says “No
verified items” rather than `$0.00` or a permanent loading message.

## G. Cart surfaces

The header button announces unit count. Its body-portalled drawer supports
focus trap/restore, Escape, backdrop, scroll lock and visible close control.
`/cart` supports quantity changes, removal and explicit clear confirmation.
The same quoted line component is shared with checkout review.

## H. Purchase entry points

An Add to cart control is rendered only for an available, priced product with
an eligible option selected. Unavailable, unpriced or option-requiring menu
cards do not offer a misleading quick-add. The product panel explains why an
item cannot be added; a pending price also says when pricing will be published.

## I. Checkout review and privacy

`/checkout` is a static, noindex shell. It reviews the basket and validates
customer inputs locally. Values stay in component state in the current tab;
there is no form action or submission endpoint, and values are not persisted.
The page plainly says order placement is unavailable. See
`docs/CHECKOUT_FOUNDATION.md`.

## J. Canadian form rules and fulfilment

Names and email are bounded; email is normalised. Canadian/NANP phone numbers
and Canadian postal codes are checked and normalised. Delivery address,
province/territory and postal code are required only for delivery; pickup asks
for no address. Both fulfilment choices remain labelled “Not yet confirmed”.
No service area, fee, schedule or pickup address is invented.

## K. Database and security impact

No MongoDB collections, indexes or write paths were added. The cart is local
to the browser; the quote is read-only; checkout data is not sent or stored.
Zod boundaries and server-side catalogue reads prevent client-supplied prices
from being trusted. No secrets or credentials were added to source.

## L. Responsive and accessibility review

Cart line controls wrap at 320px rather than causing horizontal overflow. The
header wordmark/gaps adapt below 360px. Interactive controls retain focus
rings; modals manage focus and Escape; quote state is announced politely;
reduced motion follows the existing `MotionProvider` setting.

Screenshots were visually inspected at narrow phone, standard phone and
desktop sizes, including cart, unresolvable cart line, checkout and drawer.
The screenshot gate reported zero horizontal overflow across all captures.

## M. Test coverage and verification

| Gate | Result |
| --- | --- |
| `npx next typegen && npm run typecheck` | PASS, zero errors |
| `npm run lint` | PASS, zero errors/warnings |
| `npm run test` | PASS, 496 tests across 40 files |
| `npm run build` | PASS as part of the production e2e harness |
| `npm run test:e2e` | PASS, 79 tests across storefront, cart/checkout and admin projects |
| `npm run screenshots` | PASS, 161 captures, zero horizontal overflow |

The e2e cart server uses isolated synthetic priced products and blanks real
database/Cloudinary values. The storefront fixtures now drop invalid image
references individually, matching the database repository behaviour, so a
preview cloud-name mismatch cannot remove a dish from the catalogue.

## N. Owner inputs and limitations

Business-approved prices, portions, delivery coverage and fees, tax rules,
pickup details, operating hours, contact channels and real product photography
remain pending. The preview cloud-name mismatch also needs an owner decision
before real Cloudinary delivery is considered verified. Nothing in this phase
resolves those business decisions.

The nontechnical review steps are in `docs/MANUAL_TESTING.md`.

## O. Completion boundary and next approval

Phase 4 is ready for review, not for accepting real orders. Before a later
phase, the owner must approve order submission and supply the relevant
business/payment decisions. Stripe, cash handling, order records, inventory,
notifications and deployment must not be started without explicit approval.
