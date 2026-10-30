# PEARL Signature — Manual Review Guide (Phase 7)

This guide is for a business owner reviewing the storefront, ordering and
payment experience. No coding knowledge is needed. Use the local test site
supplied by the developer: the sample meals, prices, delivery area and tax label
in the test data are synthetic and are not business values.

## Before you begin

- Review only the local preview/test site, not a live customer site.
- The menu may show “Price to be confirmed”. That is intentional until the
  business supplies approved prices.
- Test-only products such as “E2E Sample Meal” are synthetic. They are not real
  menu offerings.
- **Online payment is test mode only.** If it is available at all, use the
  Stripe test card below. Never enter a real card number, and never enter
  sensitive personal information on a test site.
- Nothing in this phase is deployed, and no live payment can be taken.

## 1. Browse the menu

1. Open **Menu** and try a category and a name search.
2. Open a dish. Check its description, image placeholder, availability and
   price message.
3. A dish with an unconfirmed price should say so. It must not look free, and
   there must not be an Add to cart control for it.
4. A product with options should let you choose only an option with a
   confirmed price before adding it.

## 2. Try the cart

Using the synthetic products in the test environment:

1. Add an orderable sample from its detail page, then add one from a menu card.
2. Open the cart button in the header. Check the product, option, quantity and
   price. Change a quantity and remove a line.
3. Close the drawer with its X, Escape, and the backdrop. The cart should
   remain available when you open it again.
4. Visit `/cart`. Edit quantities and try **Clear cart**. It should ask for
   confirmation; choose **Keep my cart** first, then repeat and confirm.
5. Refresh the page. The guest cart should remain in this browser.
6. A test item that is no longer on the menu should be highlighted and should
   not receive an invented price. The cart should explain that it needs
   attention.

## 3. Check the checkout review

1. With a sample cart, open **Proceed to Checkout**.
2. Confirm that names and prices are checked against the menu. If checking
   cannot finish, prices should be withheld and a retry offered.
3. Switch between delivery and pickup. The configured delivery area and fee,
   the tax line and the total must match what the owner configured in
   `/admin/settings`; an address outside every configured area must be refused
   with a stated reason.
4. Try leaving required fields empty, then enter sample values to see errors
   clear. Use a Canadian-format phone and postal code.
5. Confirm the total shown is the amount the server accepts. If the owner
   changes a fee or tax rate while the page is open, placing the order must ask
   the customer to review the new total instead of charging the old one.

## 4. Choose how to pay

1. Under **Payment**, two choices should appear: **Cash on arrival** and
   **Online payment**.
2. If online payment is not configured, the online choice must be visibly
   disabled and say "Online payment is not available yet. Cash on Arrival
   remains available." It must not silently fall back to cash, and it must not
   look like a working button.
3. With cash selected, the line should read "Amount due on arrival" and the
   place-order button should say **Place order**. The page must not claim
   anything was paid.
4. Place a cash order and check the confirmation page. It should say the order
   was received, show the reference, and state plainly that payment is still
   due in cash when the order is delivered or collected. Nothing may say
   "paid".

## 5. Review an online payment in Stripe test mode

Only do this if the developer has enabled test-mode Stripe configuration and
turned on **Offer Stripe online payment** in `/admin/settings`.

1. At checkout, choose **Online payment**. The button should say **Continue to
   Secure Payment** and the line should read "Amount to pay online".
2. Place the order. The browser should leave this site for a page whose address
   starts with `checkout.stripe.com`, and the amount there must equal the amount
   you reviewed. Card details are entered at Stripe, never on this site.
3. Pay with the Stripe test card `4242 4242 4242 4242`, any future expiry date
   and any three digits for the security code.
4. You should return to the order confirmation page. Until the payment is
   confirmed by Stripe it must say "We're confirming your payment. Your order
   details are saved." and offer **Check payment status**. It must not claim
   success early.
5. Once confirmed, the page should say "Payment received. Thank you for your
   order.", and the order in the admin should show **Paid** with the collected
   amount.
6. Return to the Stripe payment page from the browser history and press back
   without paying. The order should remain payable, and the confirmation page
   should let the customer try again. A second attempt must not create a second
   charge.
7. Cancel an unpaid online order in the admin, then complete a test payment for
   it. The order must stay cancelled, keep the payment record, and show a
   **Payment needs review** warning. Cancelling is not a refund.

## 6. Check the owner's payment screens

1. Sign in to `/admin` and open **Orders**. Each order should show its status,
   its payment state and its payment method separately. Filter by payment state
   and confirm the results match the rows.
2. Open a cash order and use **Record payment received**. It should require two
   presses and then show the collected amount. Open a Stripe order: there must
   be no manual payment control, because online payments are recorded only from
   verified Stripe events.
3. On a Stripe order, check the **Online payment attempts** panel: attempt
   number, state, amount, session and intent references. Check the **Stripe
   reconciliation** panel: **Run read-only check** must not change anything;
   applying requires a second confirmation and is recorded in the admin audit
   log.
4. On the dashboard, read the money cards carefully. **Paid online**, **Cash
   collected**, **Cash outstanding**, **Online pending**, **Online failed or
   expired**, **Gross collected**, **Confirmed refunds** and **Net collected**
   must each mean what their label says. An unpaid cash order is outstanding,
   never collected. A failed or pending online payment counts as zero collected.
5. If a refund was made in the Stripe dashboard, **Confirmed refunds** should
   change only after Stripe reports it, and **Net collected** should drop by
   that amount. There is no refund button in this application.

## 7. Check smaller screens and keyboard access

Review at a narrow phone width (320px if available) and at a typical phone
width, plus a phone held sideways. There should be no sideways scrolling. Try
Tab, Shift+Tab and Escape through the cart drawer, the payment choices and the
confirmation controls. Focus should remain visible, and the selected payment
choice must be operable with the keyboard alone.

The automated screenshot review also covers 320, 360, 375, 390, 430, 667
landscape, 768, 1024 and 1440 layouts. See `docs/PHASE7_REPORT.md` for the
completed results.

## 8. Check order tracking and private access

1. Place a Cash on Arrival order, then follow **Track this order** on the
   confirmation page. The order should open with a timeline that matches its
   current status. A pickup order must show **Ready for pickup** and must never
   show **Out for delivery**; a delivery order shows the opposite.
2. Check the payment panel. Cash on Arrival must say payment is due on delivery
   or collection until the owner records it. After the owner records it, it may
   say payment received. Nothing may say "paid" before that.
3. Open the same `/track?ref=...` address in a private window, where the order
   was never placed. It must not reveal the order. It should say the order needs
   private access and offer the email recovery form.
4. Enter the order reference and the email address used on the order, then press
   **Email me a code**. The message must be neutral whether or not the order
   exists. If the developer has not configured email, it must say recovery is
   unavailable instead of pretending to send.
5. With email configured, enter the six-digit code. The order should open on
   that device and keep opening after a reload. Enter a wrong code five times:
   the sixth attempt must be refused even with the correct code.
6. Ask the owner to change the order status. Press **Refresh** on the tracking
   page; the new status must appear, and the page must never show an older one
   afterwards.
7. Cancel an order and open its tracking page. It must say it was cancelled and
   must never show a completed step. A refund that Stripe has not confirmed must
   never be described as money returned.

## 9. Check the owner's notification screens

1. Sign in to `/admin` and open **Notifications**. **Delivery readiness** must
   state whether email is configured, without ever showing a key or a secret.
2. If email is not configured, the page must say so plainly and the queue counts
   must still work. Nothing may claim a message was sent.
3. If email is configured, send a test order event and process the queue (the
   developer will run the processor). Accepted messages should appear with a
   time and a provider status of **accepted**. That is not the same as
   delivered; the page must not say "delivered" unless the provider reported it.
4. A failed entry should show a short, readable reason with no email address in
   it. **Retry** should be offered only for failed or uncertain entries, and
   pressing it must not create a duplicate message.
5. In `/admin/settings`, check that the **preparing** update switch is the only
   message you can turn off. Confirmations, handover, completion, cancellation
   and payment messages must always send.

## 10. Feedback for the business

Please provide approved values rather than asking the site to guess:

- Actual product names, descriptions, options and prices.
- Whether delivery and/or pickup will be offered, where and when.
- Delivery fees, tax rules, pickup instructions and any service limits.
- Whether online payment should be offered at all, and the Stripe account that
  should receive it (test mode first, live only after a separate approval).
- A Resend account, a verified sending domain, the address messages should come
  from, and where owner alerts should go. Until these exist, no email is sent.
- Verified contact details, operating hours and approved food photography.

Unknowns stay pending. The application never invents a fee, a tax rate, a
delivery area, a contact detail or a payment claim.
