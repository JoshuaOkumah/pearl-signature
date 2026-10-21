# PEARL Signature — Cloudinary Setup (Phase 2)

Target: **Cloudinary free plan** (image storage + transformation/CDN).
No paid plan. No other image host. No hotlinked third-party images.

> **Status:** the storefront's Cloudinary *display* path is implemented
> (`FoodMedia` → `next/image` behind strict guards), but **no Cloudinary
> account or cloud has been created and no credentials were supplied** — so
> nothing has been uploaded or verified against the cloud this phase. Until
> `CLOUDINARY_CLOUD_NAME` is configured at build time, every image renders
> as the designed placeholder. **Upload/delete endpoints remain out of scope
> (Phase 3+).** This guide is for the operator when the account exists.

---

## 1. Create the free cloud (operator)

1. Create a free account at `cloudinary.com` → note the **cloud name**
   (Dashboard → Product Environment Credentials).
2. **No API secrets go anywhere near the browser or this repository.**
   The storefront only ever *delivers* images over HTTPS; uploads happen
   later through an authenticated admin flow (Phase 3+), never from client
   code and never with an unsigned preset exposed publicly.
3. Recommended naming for later uploads: folders per category, e.g.
   `pearl/products/<slug>-1.jpg`, with a documented alt text for every
   image (alt is a **required** field in the schema — see
   `docs/DATABASE_SCHEMA.md`).

## 2. Environment variables

```bash
# .env.local (git-ignored) / deployment env
CLOUDINARY_CLOUD_NAME="your-cloud-name"     # optional; enables real image delivery
# PUBLIC ids and secure URLs live in MongoDB (products.images), not in env.
```

Only the **cloud name** is needed by the storefront. There is no
`CLOUDINARY_API_SECRET` anywhere in this codebase, and none may be added to
client-visible config.

## 3. How delivery works today (implemented)

`src/components/shared/food-media.tsx` is the single migration point:

1. **Build gate:** if `CLOUDINARY_CLOUD_NAME` is set when `next build`
   runs, `next.config.ts` adds `images.remotePatterns` for
   `res.cloudinary.com` (your cloud only — an allowlist, not `*`) and
   inlines `NEXT_PUBLIC_CLOUDINARY_ENABLED=1`.
2. **Render gate:** `FoodMedia` renders a real `next/image` only when the
   flag is on **and** the URL validates (`src/lib/images.ts`):
   - `https://`
   - host exactly `res.cloudinary.com` (anything else is rejected —
     this is what keeps arbitrary/hostile URLs out of the `<img>`)
   - path shape `/<cloud>/image/upload/...`, and when the cloud name is
     configured, pinned to **your** cloud
   - Cloudinary URL, with `alt` from the record, explicit `width`/`height`
     (or ratio box) to prevent layout shift, and `sizes` for responsive
     selection.
3. **Fallbacks:**
   - flag off, URL invalid, or the image fails to load → the existing
     designed placeholder (per-dish SVG art, fixed aspect ratio, no CLS,
     no network request). This is Phase 1 behaviour, preserved.
4. Placeholders remain honest: no stock photos, no hotlinks, no fake
   photography.

### Gallery (product detail page)

- Main image + labelled thumbnail row (`ProductGallery`): thumbnails are
  buttons whose accessible name carries the description
  (`Show image 1 of 2: <alt>`), the images inside them are decorative
  (no duplicate alt), selection shows `aria-pressed`, and arrow keys move
  focus + selection. The main image area swaps with a short fade
  (reduced-motion aware via `MotionConfig`).
- Fixture data carries two **preview media slots** on the demo product so
  the gallery is exercised end-to-end; they render as placeholders today.

## 4. Verify when the cloud exists

1. Upload an image, copy its secure URL
   (`https://res.cloudinary.com/<cloud>/image/upload/v1/<folder>/<id>.jpg`).
2. Save it into a product's `images[]` (seed or admin) with real alt text.
3. Set `CLOUDINARY_CLOUD_NAME`, rebuild (`npm run build`) and load the
   product page: the placeholder is replaced by the delivered image; the
   thumbnails swap correctly; no console errors.
4. Negative checks: a non-`res.cloudinary.com` URL, a `<cloud>/raw/upload/`
   URL, or removing the env var must fall back to the placeholder, never a
   broken image.

## 5. Explicitly out of scope in Phase 2

- No upload API routes, no delete endpoints, no signed-upload presets.
- No API secrets in the app (server or client).
- No transformation/derivation URLs beyond what `next/image` requests.
- No account provisioning by the agent — creation is an operator action.
