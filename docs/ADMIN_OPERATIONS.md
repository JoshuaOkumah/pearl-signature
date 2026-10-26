# PEARL Signature — Admin Operations Guide (Phase 3–6)

> Day-to-day operating instructions for the owner dashboard at `/admin`.
> This guide assumes the owner account already exists (see
> `docs/ADMIN_AUTH.md` §6 for the bootstrap command). Order and payment
> operations are covered in depth in `docs/ADMIN_ORDER_OPERATIONS.md`.

---

## 1. Signing in

1. Open `/admin/login`. Anonymous visitors to any `/admin/**` route are
   redirected here automatically.
2. Enter the owner email and password. The error text is deliberately
   generic; if you are sure the credentials are correct, check whether the
   account was disabled or a rate-limit window is active (5 failed attempts
   per address or per email per 15 minutes).
3. Signing in lands on the dashboard at `/admin`. Signing out (sidebar
   link) revokes the session server-side immediately.

The dashboard and every admin route is excluded from search engines
(`noindex`) and uses no storefront chrome — it is an operational surface,
not a marketing page.

---

## 2. Dashboard (`/admin`)

Real counts computed from the database on every request — no cached or
invented numbers:

- Total, published, draft and unavailable (published but missing a price
  or category) product counts.
- Active and disabled category counts.
- Order and money cards: orders, in progress, awaiting cash, cash outstanding,
  paid online, cash collected, online pending, online failed or expired, gross
  collected, confirmed refunds and net collected.
- Recently updated products (last five edits with the edit date).

Use the unavailable count as the operational to-do list: a product that is
"published" but missing a price or category is invisible to customers in
some views and must be completed. Use **Online pending** and **Online failed or
expired** as the payment to-do list, and **Net collected** (not gross) when
thinking about money kept.

---

## 3. Products (`/admin/products`)

### List

- Search by name, filter by status (draft/published/archived), category
  and "unavailable" (published but incomplete), sort by name, price,
  updated date or display order, and paginate.
- Each row shows the name, category, price (in dollars, stored as integer
  cents), photo count, status badge and last-updated date.
- Archived products stay in the list (filter: status=archived) — they are
  never deleted.

### Creating a product (`/admin/products/new`)

Required fields: name and category. Everything else can be filled later;
a product can be saved as a **draft** without a price (drafts are never
visible on the storefront).

- **Pricing** — enter the customer-facing price in dollars; it is stored
  as integer cents server-side (no floating-point money). A discounted
  price is optional and must be lower than the base price.
- **Variants** — optional. Add named variants (e.g. "Small", "Family")
  each with their own price and stock; a product without variants uses
  its base price.
- **Visibility** — draft (hidden) or published (visible once complete).
- **Organisation** — category, optional tags, display order.
- **Photos** — add photos on the edit page after saving (see §5).

### Editing a product (`/admin/products/[id]/edit`)

- All fields editable. The **web address (slug) is editable here**; when
  it changes, the old address is remembered and public links to it redirect
  to the new address automatically (up to five previous addresses).
- **Archive** instead of delete: archiving hides the product from the
  storefront but keeps the record, its photos and its order history
  intact. Archiving is reversible (**Restore**).
- Edits are protected by optimistic concurrency: if a save reports that
  the product changed elsewhere, reload and reapply the edit.

---

## 4. Categories (`/admin/categories`)

- Create a category with a name, description and display order. The
  **web address (slug) is fixed at creation and never changes**, so public
  filter links stay stable even when the category is renamed.
- Edit name, description and display order at any time.
- Disable instead of delete: unchecking **Visible to customers** hides the
  category and its products from the storefront, and the action asks for a
  confirmation when products still reference it. There is no delete
  operation, so product references can never dangle.
- Renaming a category does not change its slug or its id; existing links
  and filters keep working.

---

## 5. Photos (Cloudinary)

Photos are uploaded directly from the browser to Cloudinary with a
server-signed request:

- The server fixes the folder, filename policy and format constraints; the
  browser never chooses where the file lands.
- Limits: maximum 5 MB per file, JPEG/PNG/WebP only, and the file is
  re-verified server-side after upload (correct type, dimensions and
  ownership) before it is attached to a product.
- Reordering photos, writing alt text and removing a photo are edit-page
  operations; removing a photo also removes the Cloudinary asset.
- **When Cloudinary is not configured**, the edit page shows an honest
  notice ("Photo uploads are not configured on this deployment yet") and
  disables the upload control. Existing photos can still be described,
  reordered and removed. Nothing silently fails.

See `docs/CLOUDINARY_SETUP.md` for the Cloudinary account setup and
`docs/CLOUDINARY_UPLOADS.md` for the exact request flow.

---

## 6. Storefront effect

Every admin mutation calls `revalidatePath` for the affected storefront
routes, so changes are visible on the public site on the next request —
no restart, no cache purge step. Phase 2B search (title-first relevance,
typo tolerance) is unchanged: admin product edits and new products are
searchable immediately.

---

## 6b. Orders and online payments

Order placement, the lifecycle, Cash on Arrival recording, Stripe payment
status, reconciliation and refund records are documented in
`docs/ADMIN_ORDER_OPERATIONS.md`. The rules an owner must not break:

- Cash on Arrival is recorded by hand; online payment is recorded only from
  verified Stripe events.
- Cancelling an order never refunds it.
- A payment marked **Review required** needs a Stripe check before any action.
- Reconciliation has a read-only check first; applying changes requires a
  second confirmation and is audited.

---

## 7. Troubleshooting

| Symptom | Cause | Action |
| --- | --- | --- |
| Redirected to sign-in mid-session | Session expired (7 days) or the account was disabled / password rotated | Sign in again |
| "Too many attempts" on sign-in | Rate-limit window (15 minutes) | Wait, or reduce failed attempts |
| Save reports "changed elsewhere" | Optimistic-concurrency guard fired | Reload the record and reapply the edit |
| Photos cannot be added | Cloudinary not configured on this deployment | Expected; see §5 |
| A published product does not appear | Missing price or category (unavailable) | Fix from the dashboard's unavailable count |
| Online payment is greyed out at checkout | Stripe test configuration incomplete, or the online payment switch is off | Check the Stripe readiness panel at `/admin/settings`; see `docs/STRIPE_INTEGRATION.md` §3 |
| A Stripe order has no manual payment control | Correct: online payments are never recorded by hand | Use reconciliation after checking Stripe |
| An order shows **Review required** | Provider and local facts disagree, or a cancelled order received a late payment | Read the attempts, check Stripe, then reconcile or decide on a refund in Stripe |
| **Paid online** disagrees with Stripe | A webhook may have been missed | Open the order, run the read-only reconciliation check |
