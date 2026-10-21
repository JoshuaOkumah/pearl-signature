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
| `gold-600/700` | `#B4932A` / `#8F741F` | Gold hover / **text-safe gold** |
| `gold-100` | `#F6EDCF` | Soft gold wash (badges, notes) |
| `leaf-100`, `leaf-700` | `#E7ECDF`, `#47603F` | Fresh/positive badge states |
| `terracotta-100/700` | `#F5E4DC`, `#9C553C` | Warm badge states |
| `brown-100/700` | `#ECE2D6`, `#6F5440` | Warm secondary states |

### Colour rules
- Cream is the page; navy provides structure; gold is seasoning, not a sauce.
- **No large gold panels. No small gold text on cream** (use `gold-700`).
- Gold as a solid button colour appears only on navy surfaces (high contrast).
- Hover/focus/disabled/selected states exist for every interactive element.

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
| Eyebrow | `0.75rem`, uppercase, tracking `0.22em`, `gold-700` |

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
| `Header` / `MobileNav` / `Footer` | `layout/*` | shell |

Rules:
- Server Components by default; `"use client"` only for interaction.
- No third-party UI kit; every primitive is ours and themed from tokens.
- No dead buttons: every control does something real or is not rendered.

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

Reference widths: **360 / 390 / 768 / 1024 / 1440** — verified with
`npm run screenshots` (also asserts zero horizontal overflow).

- Mobile-first CSS; desktop composition is applied over working mobile.
- Header: desktop inline nav → `md` breakpoint switches to hamburger overlay.
- Grids: favourites `sm:2 → lg:4`, menu `sm:2 → lg:3 → xl:4`, steps `md:2 → lg:4`.
- Hero: stacked media below copy on mobile; asymmetric two-column on `lg`.
- Touch targets ≥44px (h-11 buttons/chips in navigation).
- Editorial offsets (`translate-y-8`) apply only at `md+`.

## 7. Accessibility requirements

- Landmarks: `header/nav/main/footer`, one H1 per page, no skipped levels.
- Skip-to-content link (visible on focus) targeting `#main-content`.
- Focus: 2px `gold-700` ring + 2px offset (`focus-gold`) on every control.
- Mobile menu: `aria-expanded`, `aria-controls`, Escape closes, focus moves in
  and returns to the trigger, body scroll locks, panel unmounts when closed.
- Accordion: buttons expose `aria-expanded`/`aria-controls`; panels are
  `role="region"` labelled by their button and removed from the DOM when closed.
- Filtering: chips are toggle buttons (`aria-pressed`); result count is an
  `aria-live="polite"` region.
- Contrast: `ink-muted` on cream ≥ 4.5:1; gold-on-navy only at display sizes;
  gold text on cream uses `gold-700`.
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
