# PEARL Signature — Cloudinary Upload Flow (Phase 3)

> This document describes the signed, server-verified photo upload path
> added in Phase 3. Cloudinary account provisioning and the *display*
> path are covered by `docs/CLOUDINARY_SETUP.md`; this document is the
> contract for *how a photo gets into the account and onto a product*.

**Status:** implemented and unit-tested; end-to-end verification against a
real cloud is **pending** because no Cloudinary credentials were supplied
for this phase. With credentials absent, the admin edit page shows the
honest "Photo uploads are not configured on this deployment yet" state
(screenshotted in `screenshots/admin-upload-not-configured-1440x900.png`)
and the storefront keeps rendering designed placeholders. No upload ever
fails silently.

---

## 1. Design goals

- The **API secret never leaves the server.** No unsigned presets, no
  browser-visible secrets, no secrets in logs.
- A signed client **cannot choose its own namespace**: the folder,
  overwrite policy and timestamp are fixed by the server before signing.
- The **server re-verifies every asset after upload** by re-fetching it
  from Cloudinary's Admin API; product records are built exclusively from
  that authoritative response. A forged browser reply can never attach an
  arbitrary URL or a foreign asset.
- **Orphan cleanup**: uploads that fail verification, or attachments that
  exceed the image limit, are deleted again — unless another product
  references the same asset.
- Compatible with the **Cloudinary free plan** and Atlas M0: one small
  request per upload, no webhooks, no background workers.

---

## 2. Environment variables

```bash
# .env.local (git-ignored) / deployment env — server-side only
CLOUDINARY_CLOUD_NAME="your-cloud-name"
CLOUDINARY_API_KEY="…"
CLOUDINARY_API_SECRET="…"        # never sent to the browser, never logged
```

All three are required for uploads. `CLOUDINARY_CLOUD_NAME` alone (the
Phase 2 display setting) enables real image *delivery* but not uploads.
`isUploadConfigured()` in `src/lib/cloudinary/server.ts` is the single
gate; when it returns false, the upload UI degrades to the designed
notice and every upload action returns the generic "not configured"
result.

---

## 3. Upload contract (server-fixed values)

Defined once in `src/lib/cloudinary/shared.ts` (client-safe, no secrets):

| Constraint | Value |
| --- | --- |
| Upload folder | `pearl-signature/products` |
| Maximum file size | 5 MB |
| Allowed formats | JPEG, PNG, WebP |
| Maximum dimension | 10,000 px per side |
| Images per product | 10 (atomic server-side guard) |
| Filename policy | `unique_filename=true`, `overwrite=false` |

---

## 4. The request flow

```
Browser (admin edit page)          Server                     Cloudinary
────────────────────────────       ───────────────────────    ──────────────────
1. request upload ──────────────►  requireActionAdmin()
   (Server Action)                  isUploadConfigured()
                                    signUpload()  ── signs folder,
                                                      timestamp, no-overwrite
   ◄────────────────────────────   returns UploadSignature
2. POST the file directly ─────────────────────────────────►  image/upload
   (XHR with the signed params)                              (validated
                                                              server-side
                                                              signature)
3. attach (publicId + alt) ─────►  verifyUploadedAsset()  ─►  Admin API
                                    re-fetches the asset      resources/…
   ◄────────────────────────────   validates folder, type,
                                    format, bytes, dimensions
                                    builds the image DTO from
                                    THAT response, writes it
                                    to the product
```

### Step 1 — signing (`requestUploadSignatureAction`)

- Guarded by `requireActionAdmin()`; anonymous callers get the generic
  session-expired result.
- Returns a `UploadSignature`: cloud name, API key, upload URL, fresh
  timestamp, the fixed folder, and an SHA-256 signature computed over the
  sorted parameters **plus the API secret** (which is never included in
  the response).
- `overwrite=false` + `unique_filename=true` mean a signed request can
  only ever *add* a new uniquely-named asset inside the fixed folder.

### Step 2 — direct browser upload

- The edit page (`ImageManager`) posts the file with an XHR straight to
  `https://api.cloudinary.com/v1_1/<cloud>/image/upload` using the signed
  parameters. File bytes never pass through the Next.js server (important
  on small deployments).
- Client-side checks (size, MIME type) provide early feedback only; they
  are **not** the security boundary.

### Step 3 — verification and attach (`attachImageAction`)

- Guarded again by the session; the `publicId` returned by Cloudinary and
  the required alt text are parsed with Zod.
- `verifyUploadedAsset(publicId)` re-fetches the asset from the Admin API
  and validates: it lives in `pearl-signature/products`, is an uploaded
  *image*, is JPEG/PNG/WebP, is 1–5 MB, and has sane dimensions. The
  returned `VerifiedAsset` (public id, secure URL, width, height) is the
  **only** source of the image fields written to MongoDB.
- Failure codes map to specific, honest error messages (`too_large`,
  `invalid_type`, `wrong_folder`, `not_found`, transient `network`). An
  asset that exists but violates the contract is **destroyed
  immediately** (unless another product references it), so failed uploads
  cannot accumulate.
- The attach itself is an atomic `$push` guarded by a `< 10` image count,
  so concurrent saves cannot exceed the limit; if the product is full,
  the just-uploaded asset is cleaned up and a clear error is returned.

### Step 4 — reorder / re-annotate / remove

- `saveImagesAction` can only **permute, renumber, edit alt text or drop**
  images already on the product: the submitted public-id set must equal
  the stored set exactly, so nothing unverified can enter through this
  path. Alt text is required for every image.
- `removeImageAction` pulls the reference first, then destroys the
  Cloudinary asset **only when no other product references it**. The audit
  entry distinguishes "detached and asset deleted", "detached; asset kept
  (referenced elsewhere)" and "cleanup deferred".

---

## 5. Audit trail

Upload-related events written to the audit log:

- `image.attached` — asset verified and attached to a product.
- `image.updated` — order/alt text saved for a product's images.
- `image.removed` — image detached (with the cleanup outcome in the
  detail field).

Every entry carries the acting admin, the product target and a hashed
client address. API secrets and raw asset credentials are never logged.

---

## 6. Verification checklist (when credentials exist)

Run once Cloudinary variables are configured against the disposable
admin stack:

1. Upload a valid JPEG (<5 MB) → it attaches, appears as the product's
   photo on the storefront after `revalidatePath`, with the alt text you
   entered.
2. Upload a >5 MB file → rejected client-side early, and if forced past
   that, the server verification rejects it and **deletes the asset**.
3. Upload a non-image (e.g. `.txt` renamed to `.jpg`) → rejected as
   `invalid_type`, asset cleaned up.
4. Reorder two photos, save, reload → order persists; the storefront
   gallery honours it.
5. Remove one of two photos that share no references → asset is deleted
   in Cloudinary (check the Media Library).
6. Sign out, replay an old attach request → generic session error, no
   write.

Negative checks: an unsigned upload to the folder fails at Cloudinary
(the signature is mandatory); a signed upload from another account cannot
target your cloud; a forged attach reply with a made-up `publicId`
resolves to `not_found` and nothing is written.

---

## 7. Explicitly out of scope

- No video, archive or non-image uploads.
- No client-side or server-side image *transformations* beyond what
  `next/image` requests at delivery time.
- No automatic background derivative generation (free-plan friendly:
  transforms are on-demand).
- No account provisioning by the agent — creating the cloud is an
  operator action (`docs/CLOUDINARY_SETUP.md` §1).
