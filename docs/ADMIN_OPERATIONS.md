# CLIVS — Admin Operations Guide (Phase 3–7)

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

The dashboard has two views over the same live data. The view is part of the
address, so it survives a reload and can be bookmarked:

- `/admin` — **Simple** (default)
- `/admin?view=analytics` — **Analytics**

Nothing is cached, estimated or invented: every number is counted from the
database on the request that renders it. Day buckets follow the **server's**
timezone, so on a host in another region "today" is that host's day, not
necessarily the store's.

### Simple — what needs you today

- **Orders to accept** — placed and not yet confirmed. This is the first job
  of the day.
- **In progress** — orders confirmed through out for delivery, with a split
  of preparing / ready / on the way.
- **Cash to collect** — money not yet received, with the number of orders it
  belongs to.
- **Today's orders** — the latest orders placed today, with status and total.
- **Your menu** — total, live, draft and unavailable dish counts, the category
  count, and a warning when live dishes have no price (customers can see them
  but cannot order them).
- **Quick actions** — the four things an owner does most often.

Treat the "Price to be confirmed" warning as the to-do list: a live dish
without a price is visible but not orderable.

### Analytics — how the week is going

- **All orders**, **orders this week**, **collected this week** (paid orders
  only) and **still to collect**.
- A seven-day bar chart of orders per day and a completion ring (completed
  orders divided by finished orders; cancelled orders count against it).
- **Where orders stand** — a bar per status, over every order ever placed.
- **Best-selling dishes** — units sold, cancelled orders excluded.
- **Money in detail** — cash collected, cash outstanding, paid online, gross
  collected, confirmed refunds and net collected, plus a collected versus
  outstanding meter.

Use **Net collected** (not gross) when thinking about money kept, and
**Still to collect** as the cash follow-up list. A placed order is never
counted as money until it is paid.

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
- **Organisation** — category in the main form; optional tags and display
  order live under **More options**, which stays collapsed until you open it.
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

## 6c. Notifications (`/admin/notifications`)

Reached from **System status** (`/admin/system`), not from the main
navigation: it is a diagnostic page, not part of the daily job. Everything the
store has queued, accepted or failed to email, and whether email is configured
at all. See `docs/EMAIL_NOTIFICATIONS.md` and
`docs/NOTIFICATION_PROCESSING.md` for the full model.

- **Delivery readiness** states whether a send can be attempted, the provider
  name, whether a sender and owner recipient are configured, whether the
  processor secret and delivery callbacks exist, and whether cross-device
  tracking recovery is available. It never shows a key, a secret or a
  recipient address.
- **Queue state** counts `pending`, `processing`, accepted (`sent`), `failed`
  and `uncertain`, and shows the last processing attempt and the last provider
  acceptance.
- **Configured send limits** are the store's own ceilings, not a claim about the
  provider's plan.
- **Notifications needing attention** lists failed and uncertain entries with a
  short reason that contains no address or token. **Retry** takes the entry id
  only, requeues the original event, and keeps the provider idempotency key, so
  a retry cannot duplicate a message that was already accepted.
- **Accepted** means the provider took the message. It is **not** delivery. Only
  a verified provider callback may move an entry to delivered, bounced or
  complained.
- If email is not configured, the page says so and the queue still records
  everything. Nothing is ever reported as sent when it was not.

An entry that stays `pending` for a long time usually means no scheduler is
draining the queue. Run `npm run notifications:process` or call the guarded
endpoint; see `docs/NOTIFICATION_PROCESSING.md` §9.

---

## 6d. System status (`/admin/system`)

Four plain-language panels, each answering "can this work right now?":

- **Taking orders** — whether checkout can accept an order, and which
  Settings decisions are still missing when it cannot.
- **Card payments** — whether test-mode Stripe is configured. Real payments
  are not enabled in this release.
- **Emails to customers** — whether a message can be attempted at all.
- **Verifying customer email** — whether a confirmation code can be issued
  and whether cross-device tracking recovery is available.

The page reports configuration only: it changes nothing and never displays a
secret. These panels used to sit on Settings mixed in with the owner's own
decisions, which made a missing server setting look like a setting the owner
had forgotten to save. Settings is now only what the owner chooses (intake,
delivery areas, pickup, tax).

The detailed email queue, retries and delivery evidence are one link away on
`/admin/notifications`.

---

## 7. Troubleshooting

| Symptom | Cause | Action |
| --- | --- | --- |
| Redirected to sign-in mid-session | Session expired (7 days) or the account was disabled / password rotated | Sign in again |
| "Too many attempts" on sign-in | Rate-limit window (15 minutes) | Wait, or reduce failed attempts |
| Save reports "changed elsewhere" | Optimistic-concurrency guard fired | Reload the record and reapply the edit |
| Photos cannot be added | Cloudinary not configured on this deployment | Expected; see §5 |
| A published product does not appear | Missing price or category (unavailable) | Fix from **Your menu → Unavailable** on the dashboard |
| Online payment is greyed out at checkout | Stripe test configuration incomplete, or the online payment switch is off | Check **Card payments** on `/admin/system`; see `docs/STRIPE_INTEGRATION.md` §3 |
| A Stripe order has no manual payment control | Correct: online payments are never recorded by hand | Use reconciliation after checking Stripe |
| An order shows **Review required** | Provider and local facts disagree, or a cancelled order received a late payment | Read the attempts, check Stripe, then reconcile or decide on a refund in Stripe |
| **Paid online** disagrees with Stripe | A webhook may have been missed | Open the order, run the read-only reconciliation check |
| A notification sits at **Pending** for hours | No scheduler is draining the queue | Run `npm run notifications:process` or call the guarded endpoint |
| Every notification stays **Pending**, readiness says "not configured" | `NOTIFICATION_PROVIDER` is blank or its settings are incomplete | Configure Resend as described in `docs/EMAIL_NOTIFICATIONS.md` §3 |
| A notification is **Uncertain** | A provider timeout made acceptance unknowable | Check the provider dashboard before retrying, then use **Retry** |
| Tracking recovery says "unavailable" | Email is not configured, so no code can be sent | Configure email; same-device tracking still works |
