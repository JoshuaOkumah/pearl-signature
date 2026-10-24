# PEARL Signature — Checkout Foundation (Phase 4)

This is a **review-only** checkout foundation, not a way to place an order.
It exists so the customer can review a basket, confirm the current menu prices
and see which details a future checkout will require. Nothing is submitted.

## 1. Customer flow

1. A customer adds an available, priced product from its detail page or menu
   card. Products with options require a priced option to be selected.
2. The header drawer and `/cart` show the server-verified name and current
   price. The customer can change quantities, remove lines or clear the basket
   with a confirmation step.
3. `/checkout` reviews the same basket and asks for basic contact details and a
   fulfilment preference. The summary reuses the authoritative quote.
4. The page explicitly says order placement is not available. There is no
   submit endpoint or button, payment flow, order record or confirmation.

## 2. Price and quote rules

- Money is stored and calculated as integer CAD cents.
- The browser sends only product slug, option name and quantity to
  `quoteCartAction`. A stored “price last seen” value is stripped from the
  request and is never trusted as a current price.
- Products, availability, variants and prices are resolved from the current
  public catalogue. Draft, archived, disabled-category and unknown products
  receive the same masked `not_found` issue.
- A price is hidden while checking or if the quote fails. Customers get a
  retry action, not a fallback to stale local data.
- Delivery and estimated taxes read “To be confirmed”; neither is presented
  as zero. The merchandise subtotal is not described as a final total.

## 3. Local form validation

The form is controlled by `CustomerForm` and validated with
`checkoutFormSchema` in `src/lib/validations/checkout.ts`:

- Full name: required, printable text, up to 120 characters.
- Email: required and normalised to lowercase.
- Phone: Canadian/NANP shape, 10 digits or leading country code 1; the parsed
  value is normalised to `+1XXXXXXXXXX`.
- Delivery: street, city, province/territory and a Canadian postal code are
  required only when delivery is selected. Postal codes are normalised to
  uppercase `A1A 1A1` form. Apartment/unit and instructions are optional.
- Pickup: delivery address fields are not requested.
- Notes are optional. All input fields are length-bounded.

Validation is currently **local only**. Values live in React state in the
current tab, are not written to localStorage, are not sent to a server and do
not survive a reload. Accessible labels, field errors and focus rings are
provided for review; field values should be treated as temporary.

## 4. Fulfilment uncertainty

Delivery and pickup are choices under consideration, not confirmed services.
Both are labelled “Not yet confirmed”. The checkout explains that service
areas, fees and pickup arrangements are still being finalised. It does not
invent coverage, schedules, a pickup address or delivery/tax amounts.

The business must supply and approve those details, tax treatment and any
restrictions before order submission is designed.

## 5. Scope boundary

Phase 4 includes cart editing, price reconciliation and this review page only.
It does **not** include:

- Order creation, order IDs, receipts, email/SMS notifications or order
  history.
- Stripe, cash-on-arrival collection, payment authorisation or refunds.
- Inventory reservation, stock deduction, promo codes or discounts.
- Customer accounts, server-side customer data storage or analytics of form
  values.
- Confirmed delivery regions, fees, taxes, pickup dates or addresses.

These require business inputs and explicit approval for a later phase.

## 6. Implementation and tests

- Route shell: `src/app/checkout/page.tsx`, static and `robots: noindex`.
- Review UI: `src/components/checkout/checkout-client.tsx`.
- Form: `src/components/checkout/customer-form.tsx`.
- Schema/helpers: `src/lib/validations/checkout.ts`.
- Cart state and authoritative quote: `docs/CART_ARCHITECTURE.md`.
- Unit and Playwright suites cover Canadian phone/postal parsing, conditional
  delivery requirements, field errors, privacy/no-submission copy, verified
  prices, blocked products and keyboard operation.

For a nontechnical walkthrough, use `docs/MANUAL_TESTING.md`.
