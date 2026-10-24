# PEARL Signature — Manual Review Guide (Phase 4)

This guide is for a business owner reviewing the cart and checkout experience.
No coding knowledge is needed. Use the local test storefront supplied by the
developer; the sample meals and prices in the cart test are synthetic and are
not business prices.

## Before you begin

- Review only the local preview/test site, not a live customer site.
- The menu may show “Price to be confirmed”. That is intentional until the
  business supplies approved prices.
- The checkout page is not live ordering. Do not enter sensitive personal
  information. Form text stays only in the open browser tab in this phase.
- Test-only products such as “E2E Sample Meal” are synthetic. They are not
  real menu offerings.

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
3. Try switching between delivery and pickup. Both must be labelled “Not yet
   confirmed”. Delivery asks for an address; pickup must not ask for one.
4. Try leaving required fields empty, then enter sample values to see errors
   clear. Use a Canadian-format phone and postal code for the successful local
   review state.
5. Confirm there is no **Place order**, payment or final-total control. The
   page must say nothing is submitted and the details are not sent or saved.
6. Reload the page. The form details should be gone; the cart itself remains.

## 4. Check smaller screens and keyboard access

Review at a narrow phone width (320px if available) and at a typical phone
width. There should be no sideways scrolling. In the cart drawer and mobile
navigation, try Tab, Shift+Tab and Escape. Focus should remain visible, close
controls should be reachable, and the drawer should return focus to its
opening button when closed.

The automated screenshot review also covers 320, 360, 375, 390, 430, tablet,
desktop and landscape layouts. See `docs/PHASE4_REPORT.md` for the completed
test results.

## 5. Feedback for the business

Please provide approved values rather than asking the site to guess:

- Actual product names, descriptions, options and prices.
- Whether delivery and/or pickup will be offered, where and when.
- Delivery fees, tax rules, pickup instructions and any service limits.
- Verified contact details, operating hours and approved food photography.

This phase intentionally leaves these unknowns pending. It does not create or
send an order.
