# PEARL Signature — Design System

> Creative concept: **THE SIGNATURE TABLE**
> Direction: *Warm Premium Nigerian Food Commerce × Modern Editorial Design*
>
> The single source of truth for tokens and component behaviour lives in
> `src/app/globals.css` (Tailwind v4 `@theme`) and `src/components/**`.
> This document explains the system around that code.

---

## 1. Colour tokens

### Brand palette (locked)

| Token | Hex | Role |
| --- | --- | --- |
| `cream` | `#FDFBF7` | Primary background — the page is predominantly cream |
| `navy` | `#1A2530` | Structure, headings, body text, primary buttons, footer |
| `gold` | `#D4AF37` | Restrained premium accent (rules, numbers, CTA on navy only) |
| `leaf` | `#5C7A58` | Freshness, supportive states |
| `terracotta` | `#B86A4F` | Appetite, warmth (italic headline accents, secondary CTA) |
| `brown` | `#8A6A52` | Subtle warm secondary elements |

### Derived tokens (semantic — never scatter raw hex in components)

| Token | Value | Use |
| --- | --- | --- |
| `cream-100` | `#F9F4EA` | Raised warm surface (alternating section bands) |
| `cream-200` | `#F2EBDC` | Subtle fills, chips, icon circles |
| `surface` | `#FFFEFB` | Cards |
| `border` | `#E4DBC8` | Default component border |
| `sand` | `#E7DCC6` | Warm hairlines, dividers |
| `navy-800/900` | `#22303D` / `#131C25` | Primary-button hover/press |
| `navy-600/700` | `#46586A` / `#33424F` | Inverse text steps |
| `ink-muted` | `#52606E` | Secondary text on cream (AA-safe) |
| `gold-600/700` | `#B4932A` / `#806519` | Gold hover / **text-safe gold** (≥4.5:1 on cream, cream-100, cream-200, surface and gold-100; never on navy — use `gold`) |
| `gold-100` | `#F6EDCF` | Soft gold wash (badges, notes) |
| `leaf-100`, `leaf-700` | `#E7ECDF`, `#47603F` | Fresh/positive badge states |
| `terracotta-100/700/800` | `#F5E4DC`, `#9C553C`, `#84462F` | Warm badge states; `secondary` button bg/hover (cream text ≥4.5:1) |
| `brown-100/700` | `#ECE2D6`, `#6F5440` | Warm secondary states |

### Colour rules
- Cream is the page; navy provides structure; gold is seasoning, not a sauce.
- **No large gold panels. No small gold text on cream** (use `gold-700`).
- **On navy, small gold text uses `gold` (`#D4AF37`, 7.4:1), never `gold-700`**
  (2.8:1 on navy). `Eyebrow` exposes this as `tone="inverse"`.
- Gold as a solid button colour appears only on navy surfaces (high contrast).
- Hover/focus/disabled/selected states exist for every interactive element.
- Token text colours are verified against their **actual** backgrounds
  (computed-style contrast, WCAG 2.x AA: 4.5:1 normal, 3:1 large). Opacity
  modifiers on navy (e.g. `text-cream/55`) composite ≥4.5:1 at their shipped
  sizes. Re-verify with `node scripts/audit-mobile.mjs` after palette changes.

## 2. Typography

| Role | Font | Weights/styles |
| --- | --- | --- |
| Display | **Fraunces** (via `next/font`, `--font-fraunces`) | semibold headings, italic accents |
| Interface/body | **Manrope** (via `next/font`, `--font-manrope`) | 400–800, all UI text |

- `font-display` = Fraunces → hero H1, section H2s, card titles, wordmark,
  pull-quotes, step numbers, accordion questions.
- Default body = Manrope → navigation, buttons, prices, forms, descriptions,
  anything dense or interactive.
- Never set dense interface text in Fraunces.

### Scale (responsive)
| Element | Mobile → Desktop |
| --- | --- |
| H1 | `2.65rem → 3.5rem`, leading `1.06` |
| Section H2 | `1.875rem → 2.25rem`, leading `1.12`, tracking `-0.01em` |
| H3 / card title | `1.25rem` |
| Body | `1rem (→1.125rem md)`, leading `1.6` |
| Small / meta | `0.75–0.875rem` |
| Eyebrow | `0.75rem`, uppercase, tracking `0.22em`, `gold-700` (`tone="inverse"` → `gold` on navy panels) |

Measure: body copy is capped (`max-w-xl`/`max-w-2xl`, ~60–70ch) for readability.
Headlines use `text-balance` to avoid orphan words.

## 3. Spacing & layout

- Base unit: 4px (Tailwind scale).
- Section rhythm: `py-16 / md:py-24 / lg:py-28` — owned by the `Section`
  component’s `padding` prop (`default | flush | flush-top | flush-bottom`).
  **Never override section padding via className** — responsive variants would
  fight in the cascade (this bug was found and fixed in Phase 1).
- Content wrapper: `max-w-6xl` with `px-5 / md:px-8`, centred.
- Card grid gaps: `gap-6` (24px). Editorial offsets use `translate-y-8`
  (category cards) and asymmetric `lg:grid-cols-[a_b]` splits (story, FAQ).
- Radii: `2xl/3xl` (16–24px) for cards; `full` for buttons/chips; `2–2.5rem`
  for large media panels.
- Elevation: `shadow-card` (resting) and `shadow-lift` (hover) tokens.

## 4. Component conventions

| Component | File | Notes |
| --- | --- | --- |
| `Button` / `ButtonLink` | `ui/button.tsx` | variants: `primary` (navy), `secondary` (terracotta), `accent` (gold, dark surfaces), `outline`, `outlineLight`, `ghost`; sizes `sm/md/lg/icon`; focus ring, `active:scale-[0.98]`, disabled opacity |
| `Chip` | `ui/chip.tsx` | `aria-pressed`, animated active pill (`layoutId`), counts |
| `Badge` | `ui/badge.tsx` | tones: neutral/gold/leaf/terracotta/navy |
| `Section` / `Eyebrow` / `SectionHeading` | `ui/section.tsx` | editorial heading stack |
| `Accordion` | `ui/accordion.tsx` | FAQ items, `aria-expanded/aria-controls`, region panels |
| `Reveal` | `ui/reveal.tsx` | one-shot scroll reveal (fade + 20px rise) |
| `Divider` | `ui/divider.tsx` | hairline with rotated gold diamond |
| `Skeleton` | `ui/skeleton.tsx` | `motion-safe:animate-pulse` |
| `Wordmark` | `shared/wordmark.tsx` | temporary typographic mark + pearl dot |
| `FoodMedia` | `shared/food-media.tsx` | temporary plated-dish SVG illustration (Cloudinary migration path built in) |
| `ProductCard` | `shared/product-card.tsx` | preview only — no price/cart UI |
| `Header` / `MobileNav` / `Footer` | `layout/*` | shell; `MobileNav` is a portal-rendered full-screen modal dialog (see §6) |

Rules:
- Server Components by default; `"use client"` only for interaction.
- No third-party UI kit; every primitive is ours and themed from tokens.
- No dead buttons: every control does something real or is not rendered.
- **`cn` is a plain joiner — it does not merge Tailwind conflicts.** A
  component's own classes and caller `className` values can fight (both ship;
  stylesheet order decides). Use props for variation (`Eyebrow` `tone`,
  `Badge` `tone`, `Button` `variant`/`size`), never className overrides of
  display/colour. Responsive visibility belongs on a wrapper element
  (`hidden md:block`), not on a component whose base sets `display`.

## 5. Motion guidelines

- Library: **Motion for React**, configured once in `MotionProvider`
  (`reducedMotion="user"`), which disables motion for reduced-motion users.
- Duration: **150–300ms** for microinteractions; reveals up to 550ms.
- Easing: soft expo `cubic-bezier(0.22, 1, 0.36, 1)`.
- Allowed: hover lifts, image scale (≤1.04), button press, chip pill glide,
  mobile-menu stagger, accordion height, one-shot scroll reveals.
- Banned: bouncing/loopy springs, continuous decoration loops, parallax on
  scroll, animating critical content, layout-shifting animation.
- Reveals fire once (`viewport: { once: true }`) with ≤0.35s stagger delays.
- Nothing is *only* visible via motion: content is in the DOM regardless.

## 6. Responsive behaviour

Reference widths: **320 / 360 / 375 / 390 / 430 / 667×375 (landscape) /
844×390 (landscape) / 768 / 1024 / 1440** — verified with
`npm run screenshots` (also asserts zero horizontal overflow) and by
`e2e/mobile.spec.ts` (bounding-box and hit-test assertions).

- Mobile-first CSS; desktop composition is applied over working mobile.
  Mobile layouts are composed, not shrunk: hero stacks media under copy,
  grids collapse to one column, the ordering steps stack, the closing panel
  and footer stack, and the menu chips wrap.
- Header: desktop inline nav + `Explore Menu` CTA; below `md` the CTA is
  removed from layout via a `hidden md:block` wrapper and the hamburger
  (≥44×44, `shrink-0`) is shown via a `md:hidden` wrapper — visibility
  switching happens on wrappers so display classes can never conflict.
- **Mobile menu (`MobileNav`)**: a full-viewport modal panel portalled to
  `document.body` (`role="dialog" aria-modal="true"`, `z-[70]` above the
  header's `z-50`). It owns its top bar (wordmark + visible X close button),
  a scrollable link list (`overflow-y-auto`, internal scrolling on short
  landscape viewports), and a pinned CTA footer with safe-area padding.
  The portal makes `fixed inset-0` resolve against the viewport regardless
  of ancestor stacking contexts or `backdrop-filter` containing blocks
  (the root cause of the Phase 1B navigation bug). z-index scale: content
  (auto) < header 50 < skip-link 60 < mobile menu 70.
- Grids: favourites `sm:2 → lg:4`, menu `sm:2 → lg:3 → xl:4`, steps `md:2 → lg:4`.
- Hero: stacked media below copy on mobile; asymmetric two-column on `lg`.
- Touch targets ≥44px (h-11 buttons/chips in navigation).
- Editorial offsets (`translate-y-8`) apply only at `md+`.

## 7. Accessibility requirements

- Landmarks: `header/nav/main/footer`, one H1 per page, no skipped levels.
- Skip-to-content link (visible on focus) targeting `#main-content`.
- Focus: 2px `gold-700` ring + 2px offset (`focus-gold`) on every control.
- Mobile menu: a modal dialog (`role="dialog"`, `aria-modal="true"`, labelled
  "Site navigation"). The hamburger exposes `aria-expanded`/`aria-controls`;
  a visible ≥44px X inside the panel, Escape, and link selection all close it;
  focus moves to the X on open, is trapped inside the panel while open
  (Tab wraps at the boundaries) and returns to the trigger on close; body
  scroll locks while open and is released on close or when the viewport
  widens past `md` (no leftover overlay or scroll lock); the panel unmounts
  when closed and survives repeated open/close cycles.
- Accordion: buttons expose `aria-expanded`/`aria-controls`; panels are
  `role="region"` labelled by their button and removed from the DOM when closed.
- Filtering: chips are toggle buttons (`aria-pressed`); result count is an
  `aria-live="polite"` region.
- Contrast (WCAG AA, computed from real backgrounds): hero eyebrow
  `gold-700`/cream 5.4:1; body `ink-muted`/cream 6.2:1; footer `cream/55`/
  navy 5.5:1; closing-panel `gold`/navy 7.4:1; footer `cream/70`/navy 8.1:1;
  button text `cream`/`navy` 15:1; focus ring `gold-700`/cream 5.4:1.
  Automated in `e2e/mobile.spec.ts` ("key text pairs meet WCAG AA contrast").
- Decorative media/illustrations are `aria-hidden`; meaningful images will get
  descriptive alt text when real photography lands.
- Reduced motion respected by Motion, smooth scrolling, and `motion-safe` pulses.

## 8. Imagery guidance

Phase 1 uses **temporary local illustrations** — no hotlinked third-party images
and no fake photography presented as real dishes.

- `FoodMedia` draws a stylised plated-dish SVG per item using its `DishTheme`
  palette; layout never collapses without photos because the component fills a
  fixed `aspect-*` box (prevents CLS).
- **Cloudinary migration path:** keep `FoodMedia`’s props API, replace the SVG
  body with `next/image` + Cloudinary loader + real `alt`. No layout rewrites.
- Final photography direction: close-up Nigerian dishes, warm natural light,
  clean plating, rich realistic texture, cream/earthy backgrounds.
- Business must supply approved photos before launch; document insertion points:
  hero, category cards, product cards, brand story.
- Temporary logo note: the current wordmark is an interim typographic mark,
  **not** the final official logo. Replace when the P+S monogram is delivered.

## 9. Admin surfaces (Phase 3)

The dashboard at `/admin/**` is an **operational surface**, not a
marketing page. It reuses the same tokens and primitives so the brand
reads consistently, but drops the storefront chrome entirely:

- **Chrome:** no marketing Header/Footer (`SiteChrome` suppresses them for
  `/admin/**`); the admin tree renders its own `AdminShell` — a compact
  top bar on mobile (wordmark + "Open navigation menu" button opening a
  labelled drawer, `role="dialog"` "Admin navigation" with backdrop,
  Escape and focus handling) and a persistent sidebar at `md+` with the
  owner email, navigation links and Sign out.
- **Tokens:** cream backgrounds, `surface` cards with `border` hairlines,
  navy headings (`font-serif` page titles), `ink-muted` secondary text,
  `Badge` tones for status (leaf = published/active, neutral = draft,
  terracotta = archived/disabled). Gold stays restrained: focus rings and
  the wordmark dot only.
- **Forms:** shared admin field primitives (`TextField`, `TextAreaField`,
  `SelectField`, `CheckboxField`) with labels carrying "(required)",
  inline `error` text, `hint` text, and `focus-gold` rings. `useActionState`
  drives create/update forms; direct `<form action>` mutations surface a
  `?opError=1` banner. Destructive-leaning actions (disable a populated
  category) arm a two-step confirm ("Confirm disable" + alert) that
  disarms whenever the form changes.
- **Tables/lists:** card-based rows (`ProductTable`, `CategoryManager`)
  instead of dense tables, so the 320–1440px range needs no horizontal
  scrolling; honest empty states ("No photos yet.", "Not set") in
  `ink-muted` text, never invented values.
- **Motion:** minimal — hover transitions and the drawer only; no scroll
  reveals on operational content (data must be visible immediately).
- **Accessibility:** every interactive element keeps the `focus-gold`
  ring; the drawer is a real modal dialog; forms use fieldsets/legends
  where grouped; status is never colour-only (text labels accompany
  badges).

## 10. Cart and checkout surfaces (Phase 4)

Cart and checkout reuse the storefront shell and tokens, with a restrained
operational tone. They are review interfaces only: no price is inferred from
browser storage, and no order/payment action is shown (Phase 4 boundary;
Phase 5 adds the submission control described in section 11).

- **Header cart control:** accessible name includes the unit count; it opens a
  body-portalled modal drawer with a visible close control, Escape/backdrop
  dismissal, focus trap/restore and scroll lock.
- **Cart rows:** the same `CartLineRow` is used in the drawer, `/cart` and the
  checkout summary. On narrow screens the quantity and price may wrap rather
  than create horizontal scrolling; controls retain their 44px targets.
- **Price states:** only server-quoted integer-cent prices are formatted. While
  a quote is in flight, rows say “Checking”; on quote failure, prices are
  withheld and retry is offered. Delivery and tax are “To be confirmed”, not
  `$0.00`, and no provisional figure is called a total.
- **Checkout layout:** details and order review use two columns on wide screens
  and one column on mobile. The summary is not sticky on small screens, so the
  on-screen keyboard cannot cover the form's next control.
- **Unconfirmed choices:** delivery/pickup are selectable for review but carry
  a “Not yet confirmed” notice. No fee, coverage, pickup address, or completion
  promise is implied.
- **Interaction and accessibility:** all buttons, links, steppers, option
  radios and form fields have visible `focus-gold` focus; errors are associated
  with their fields; quote changes use a polite live region; reduced motion is
  inherited from `MotionProvider`.

Responsive checks include the cart and checkout at 320, 390, 1024 and 1440px;
the populated and unresolvable cart states are included in the screenshot
utility and 320px cart layout is covered by Playwright.

## 11. Order surfaces (Phase 5)

Order screens keep the same tokens and add an operational register: calm for
the customer, explicit for the owner.

**Checkout payment and submission**

- **Payment panel:** one Cash on Arrival option presented as a selectable
  card with a radio control, the plain statement that nothing is paid
  online, and an `Amount due on arrival` line rendered through `formatCad`
  with tabular figures. No fee, tax or total is ever shown in raw digits.
- **Place order:** `variant="primary"`, full width, with a polite
  `role="status"` line underneath that always explains the current state
  (verifying, awaiting address, awaiting acknowledgment, submitting,
  unavailable). Submission errors use a terracotta `role="alert"` block with
  `data-testid="submit-error"`.
- **Price-change panel:** a gold-bordered `role="alert"` block stating the
  new total, the previous total and that the order was not submitted, with
  an outline acknowledgment control. Until acknowledgment the Place order
  button stays disabled, so an amount nobody reviewed can never be sent.

**Confirmation page**

- Order reference, status badge, item snapshot, money breakdown and the
  fulfilment method, each in its own rounded surface. Customer contact
  details are deliberately not echoed back.
- Failure states are first-class and worded neutrally: no capability on this
  device, reference not found, rate limited, unavailable. One sentence each,
  no stack traces, no database terms.

**Admin order surfaces**

- **Status buttons:** navy pill buttons for forward transitions; the two
  consequential actions (cancel, complete) and payment recording use the
  two-step control, which changes its own label to the consequence and
  returns to rest when focus leaves.
- **Danger tone:** cancellation uses `terracotta-700` once armed; ordinary
  progression stays navy, so colour follows consequence rather than
  decoration.
- **Results:** `FormAlert` in `success` or `error` tone directly under the
  panel that acted, with `role="status"` and `role="alert"` respectively.
- **Metrics:** five `StatCard`s under `Order statistics`, values in
  `formatCad` where they are money.
- **List:** a table from tablet upward, stacked cards below it, so status
  and payment badges are never compressed into unreadable columns.
- Focus, contrast and reduced-motion rules are identical to the storefront;
  order pages are screenshot-checked at 320, 360, 390, 768, 1024 and 1440px
  and in landscape.
