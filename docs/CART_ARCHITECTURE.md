# PEARL Signature — Cart Architecture (Phase 4)

How the guest shopping cart works: what is stored, where truth lives, how the
browser and the server reconcile, and what every surface promises the
customer. Checkout has its own document: `docs/CHECKOUT_FOUNDATION.md`.

## 1. Principles

1. **The server is the only authority on price, name and availability.**
   Anything a browser has stored is a hint for display, never a fact.
2. **No figure is shown that nobody confirmed.** No `$0.00`, no invented
   totals, no prices for products that are not orderable right now.
3. **A cart is never an order.** Nothing in this phase writes to MongoDB,
   reserves stock, charges anyone or creates a record about a person.
4. **Honest failure.** If verification fails, the cart says so and keeps the
   items; it does not fall back to stale numbers.

## 2. Cart identity

A cart line is identified by the pair **`(slug, variantName)`**:

- `slug` is the public, stable identifier for a product (validated against
  `SLUG_PATTERN`). The database `_id` is never exposed to the browser.
- `variantName` is the chosen option (for example `Large`), or `null` for a
  product with no options.
- The composite key used in memory is `cartLineKey(slug, variantName)` with
  the separator `␟` (U+241F), which cannot occur inside a slug, so keys can
  never collide or be forged into a different product.

Adding the same product with the same option increments the existing line;
a different option becomes a different line.

## 3. Persisted storage

The cart lives in `localStorage` under **`pearl-cart-v1`** (schema
version 1), so it survives reloads and navigation without an account:

```json
{
  "version": 1,
  "items": [
    { "slug": "jollof-rice", "variantName": null, "quantity": 2, "unitPriceCents": 1250 },
    { "slug": "egusi-soup", "variantName": "Large", "quantity": 1, "unitPriceCents": 1400 }
  ]
}
```

- `unitPriceCents` is the **"price last seen" hint**. It exists only so the
  interface can warn "Price updated from $10.00 CAD to $12.50 CAD." after a
  change. It is stripped from the request the client sends to the server and
  is never presented as a confirmed figure on its own.
- Reading is defensive: malformed JSON, a wrong version, unknown fields,
  bad slugs or impossible quantities are dropped per line rather than
  crashing; if storage is unavailable (private mode, blocked cookies) the
  cart still works for the session and an honest notice explains that items
  will not be kept.
- **The server request schema strips everything it does not need**: the quote
  request contains only `slug`, `variantName` and `quantity` per line.

## 4. Limits (enforced twice)

| Bound | Value | Why |
| --- | --- | --- |
| Units per line | 25 | Generous for a family meal |
| Units per cart | 99 | Keeps subtotals far inside safe-integer range |
| Distinct lines | 30 | One small batched query |

Defined once in `src/lib/cart/limits.ts` and enforced:

1. in the browser (friendly, immediate), and
2. in the server-side schema `src/lib/validations/cart.ts` — the only real
   boundary, because `localStorage` is customer-controlled and a convenience
  limit is never a security control.

## 5. The store

`src/lib/cart/store.ts` is a module singleton — one store per tab, consumed
with `useSyncExternalStore` so React and plain listeners agree:

- **Hydration:** on first browser access it reads `localStorage`, validates,
  and publishes the real cart. Until then the server snapshot is the empty
  cart, so server-rendered HTML never guesses a count.
- **Writes** update memory first (instant UI), then persist; a storage event
  listener keeps multiple tabs of the same browser consistent.
- **Selectors** (`totalQuantity`, `subtotalCents`, per-line views) derive
  everything the UI shows; components never read storage themselves.

`CartProvider` (`src/lib/cart/context.tsx`) wraps the app in `layout.tsx`
and adds the reconciliation loop described below. In tests, components render
through `src/test/cart-harness.tsx` so the same provider is present.

## 6. The server quote

One Server Action — `quoteCartAction` in `src/lib/actions/cart.ts` — is the
cart's only server entry point:

- **Read-only.** No writes, no order, no identity, no cookies.
- **Validated first.** The payload is parsed with `cartQuoteRequestSchema`;
  anything malformed returns a neutral `{ ok: false, reason: "invalid" }`
  with nothing probeable.
- **Bounded.** The limits above, and **at most two indexed reads** per call
  (published products for the requested slugs + their active categories).
- **Public-safe.** Only published products in active categories can come
  back — exactly what `/menu` already exposes.
- **Never cached.** Server Actions are per-request POSTs; no customer's
  basket is ever stored in a shared cache.
- **Masked failures.** A slug that is a draft, archived, in a disabled
  category or simply never existed all resolve to the same neutral
  `not_found` issue, so the endpoint cannot be used to probe the catalogue.

### Response shape (per line)

A resolved line carries the authoritative `name`, `unitPriceCents`,
`availability`, image metadata and either `issue: null` (orderable) or one
of the issues below. Customer-facing wording lives in
`src/lib/cart/issues.ts` and is identical on every surface:

| Issue | Wording |
| --- | --- |
| `not_found` | This dish is no longer on the menu. |
| `unavailable` | This dish is temporarily unavailable. |
| `unpriced` | The price for this dish has not been confirmed yet. |
| `variant_required` | Please choose a portion size for this dish. |
| `variant_not_found` | That portion is no longer offered. Please choose another. |
| `variant_unpriced` | The price for that portion has not been confirmed yet. |
| `variant_ambiguous` | This dish has conflicting portion options. Please contact us. |

**Any issue blocks the line** from contributing to checkout: the drawer
replaces "Proceed to Checkout" with a disabled explanation, and `/cart`
marks the same control `aria-disabled` and names the problem.

## 7. Reconciliation loop

The client cannot trust itself, so after every mutation it re-verifies:

1. A change (add, quantity, remove, clear) marks the quote **stale** and
   schedules a **200 ms debounced** quote, so rapid clicks coalesce into one
   request.
2. Requests carry a **monotonic sequence number**; a response older than the
   latest request is discarded, so answers can never arrive out of order.
3. While in flight, surfaces show "Checking…" / "Updating…" instead of a
   number, and steppers are disabled only for lines whose quote is missing.
4. On success, line quotes are replaced: name, price and availability now
   come from the server, and any difference from the stored hint raises the
   price-change notice (which shows both figures and charges the new one).
5. On failure, `quoteStatus` becomes `error`: totals are replaced with
   "Could not be verified", every surface shows an honest error panel with a
   "Try again" control, and **nothing falls back to stored prices**.
6. If the quote succeeds but no line has a confirmed purchasable price, the
   subtotal reads "No verified items" rather than showing `$0.00` or remaining
   indefinitely in a loading state.

A live region (`QuoteStatusAnnouncer`) announces "Prices verified." or
"Prices could not be verified." to screen readers.

## 8. Surfaces

### Header button

`src/components/cart/header-cart.tsx` — the accessible name carries the
count: `Open your cart, it is empty` / `Open your cart, N items`, so the
state is announced without sight of the badge.

### Drawer (quick access)

`src/components/cart/cart-drawer.tsx`, portalled to `document.body`:

- **Modal behaviour:** `role="dialog"` + `aria-modal` + `aria-label="Shopping
  cart"`; focus moves into it on open, is trapped, Escape and backdrop
  dismiss it, body scroll is locked, and focus returns to the trigger on
  close. Two controls share the name "Close cart" (the backdrop and the
  header X); only the header one is tabbable (`tabIndex={-1}` on the
  backdrop).
- Portalled because the sticky header's `backdrop-filter` would otherwise
  create a containing block that breaks `position: fixed` descendants.
- **Footer:** "Subtotal", the line "Delivery and taxes are confirmed at
  checkout." (never a fee), a primary "Proceed to Checkout" that becomes a
  disabled, `aria-disabled` explanation plus "Resolve the highlighted items
  to continue." when any line is blocked, "View Cart" and "Continue
  shopping".

### Line row (drawer + `/cart` + `/checkout`)

`src/components/cart/cart-line-row.tsx`, shared so surfaces cannot disagree:

- Name, image, unit price and line total come **only from the quote**. Until
  it arrives the row shows "Loading item" and a "Checking" spinner rather
  than a guess; an unpriced product shows "Price to be confirmed".
- Quantity stepper (`Quantity of X` / `Increase quantity of X` / `Decrease
  quantity of X`), capped by both the per-line limit and the remaining stock
  pool across other lines; disabled while a line is resolving or blocked.
- Remove button names its target: `Remove {name} from your cart`.
- Price changes render the notice "Price updated from $X to $Y."; blocked
  lines render their issue wording.

### `/cart`

`src/components/cart/cart-page-client.tsx` — the spacious editing surface:
line list, "N items" header, "Order summary" with `CartSummary`,
"Return to the Menu", and a **Clear cart** control that requires explicit
confirmation ("Remove everything?" → "Yes, clear my cart" / "Keep my
cart") so nothing is destroyed by a stray click. The empty state is the
same honest panel as the drawer: "Your cart is waiting for something
delicious." with one way forward, "Explore the Menu".

### Purchase entry points

`PurchasePanel` (product page) and the menu card's quick-add render the
quantity stepper and `AddToCartButton` **only when `canOrder`** (published,
available, priced, option chosen). Otherwise they render an honest
`data-testid="not-orderable"` notice — an unavailable or unpriced product
offers no purchase control at all, disabled or otherwise.

`AddToCartButton` labels itself `Add {name} to cart` (and `{name} added to
cart` after activation), with a short local confirmation and no forced
drawer opening.

## 9. Money formatting

All figures go through `formatCad` (for example `$12.50 CAD`) from integer
cents. No floating-point arithmetic touches a price, and no surface prints a
currency figure that did not come from `formatCad` of a server-confirmed
integer.

## 10. Tests

- **Unit (Vitest):** `src/lib/cart/*.test.ts` (core, store, quote,
  issues, purchasable, limits), `src/lib/validations/cart.test.ts`, and
  component suites for the drawer, `/cart` page, header, product card, menu
  explorer — 40 files / 496 tests in total.
- **End-to-end (Playwright, `cart` project on port 3002):**
  `e2e/cart/cart.spec.ts` covers add from product page and quick-add,
  variant identity, missing controls for unavailable/unpriced products,
  drawer modal behaviour, quantity, removal, clearing with confirmation,
  persistence, navigation, the price-change warning, blocked checkout,
  offline verification and keyboard operation.

### The disposable cart server

`scripts/e2e-cart-server.ts` starts `next start` on **port 3002** using the
production build (started by the port-3000 web server) plus
`E2E_PURCHASABLE_FIXTURES=1`, which adds four clearly labelled synthetic
products from `src/data/e2e-products.ts`:

| Slug | Price | State |
| --- | --- | --- |
| `e2e-sample-meal` | $12.50 | orderable, no options |
| `e2e-portion-pack` | Small $8.00 / Large $14.00 | orderable, with options |
| `e2e-sold-out-item` | $5.00 | unavailable |
| `e2e-unpriced-item` | none | price not confirmed |

They exist only when that environment variable is set, are never in a
normal build, and are clearly named as test data.

The harness also makes the run **hermetic**: it passes `CATALOGUE_SOURCE=fixtures`
and a blank `MONGODB_URI`, plus blanked Cloudinary credentials, in the
child process environment. This matters because `.env.local` may define a
real `MONGODB_URI`, and `resolveCatalogueSource()` gives the URI precedence:
without the override the suite would read the operator's live catalogue
instead of the labelled fixtures. (Environment values are passed with
`spawn(…, { env })`, which honours empty strings; setting `$env:X=""` in
PowerShell does not — the variable is dropped before the child sees it.)

The same hermetic overrides (`MONGODB_URI: ""` and
`CLOUDINARY_CLOUD_NAME: ""`) are applied to the port-3000 web server in
`playwright.config.ts`. Storefront tests therefore use labelled fixtures and
the canonical URL-shape validation, without depending on an operator's
database or Cloudinary credentials in `.env.local`. Build-time image delivery
is disabled in this test build; invalid preview image references are dropped
individually while the products remain visible.

The dedicated Playwright cart regression also checks `/cart` at 320px with
priced and unresolvable lines. `npm run screenshots` covers populated and
unresolvable cart states at 320, 390, 1024 and 1440px.
