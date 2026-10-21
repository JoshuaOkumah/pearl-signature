# PEARL Signature — MongoDB Atlas M0 Setup (Phase 2)

Target: **MongoDB Atlas M0 (free tier)**. No paid tier, no other database
service. Supabase/Firebase/Postgres are rejected dependencies and must never
be added.

> **Status:** the application code, schema, seed tooling and all database
> read paths are implemented and unit-tested with mocked models. The hosted
> Atlas cluster itself is **pending** — no `MONGODB_URI` has been supplied
> and no cloud resource has been created, upgraded or verified by this
> phase. Follow this guide with the business owner's account.

---

## 1. Create the free cluster (operator, ~5 minutes)

1. Create a free account at `cloud.mongodb.com` (Atlas free tier, M0).
2. Build a database → **M0 (Free)**, any region/name, default settings.
3. **Database Access:** create a dedicated application user with
   *Read and write to any database* (record the password in a password
   manager — never in this repository).
4. **Network Access:** add your IP for setup. For the eventual deployment,
   add the host's IP or `0.0.0.0/0` only if you accept the trade-off, and
   prefer a restricted allowlist.
5. **Connect → Drivers:** copy the connection string, e.g.

   ```
   mongodb+srv://<user>:<password>@pearl.xxxxx.mongodb.net/pearl_signature?retryWrites=true&w=majority
   ```

## 2. Configure the environment (local, never committed)

`.env.example` documents the placeholders:

```bash
# .env.local  (git-ignored)
MONGODB_URI="mongodb+srv://<user>:<password>@pearl.xxxxx.mongodb.net/pearl_signature?retryWrites=true&w=majority"
# Optional; only needed to display real Cloudinary images:
# CLOUDINARY_CLOUD_NAME="your-cloud"
# CATALOGUE_SOURCE   # "database" | "fixtures" — normally left unset
```

Rules:

- `.env.local` / deployment env vars are the only places credentials live.
- Never put the URI (or parts of it) in source, docs, logs, tests, screenshots
  or commands. Database error logging redacts credentials defensively.
- **Source resolution** (`resolveCatalogueSource`):
  - `CATALOGUE_SOURCE=fixtures` → labelled preview fixtures (dev/preview).
  - `MONGODB_URI` set → database.
  - no URI + non-production → fixtures (development convenience).
  - no URI + **production** → *catalogue unavailable* honest error state
    (never silent fixtures, never a silent fallback when a query fails).

## 3. How the connection behaves

`src/lib/db/mongoose.ts` (server-only, not reachable from client components —
ESLint also blocks `src/lib/db` and `src/models` imports under
`src/components/**`):

- One cached global connection (dev-HMR safe: the Node `globalThis` cache is
  reused instead of re-connecting per hot reload).
- `bufferCommands: false` (no silent buffering when disconnected),
  `serverSelectionTimeoutMS` / `connectTimeoutMS` = 5 s (bounded waits),
  `autoIndex: false` (the app never creates indexes itself).
- Reads run **only at request time**. Page loaders call `await io()` before
  any database work, which keeps prerendering off the database entirely —
  `next build` performs zero queries (verified: the build succeeds with no
  `MONGODB_URI` present).
- Every failure is caught, logged with credentials redacted, and returned as
  `{ ok: false }` → the UI shows a friendly "temporarily unavailable" state
  with a Try again action. A failed query never falls back to fixtures.

## 4. Seed (explicit, idempotent, never automatic)

```bash
npm run seed                 # dry run: prints masked target, connects to nothing
npm run seed -- --yes        # apply (requires MONGODB_URI)
npm run seed -- --yes --force-production   # additionally required if NODE_ENV=production
```

Guarantees (see `scripts/seed.ts`):

- **`$setOnInsert` only** — existing documents are never modified or
  overwritten; re-running is safe and cannot clobber live data.
- **Never runs automatically** (not at build, not at startup). No drops, no
  `deleteMany`; `createIndexes()` only *adds* missing indexes.
- Prints the **masked target** (`host / database name` only) before doing
  anything; refuses without `MONGODB_URI`, without `--yes`, and in
  production without `--force-production`.
- Seeds the three launch categories and the labelled preview products
  (including the draft record, seeded **as draft**). Prices insert as
  `null` — "Price to be confirmed" — because the business has not supplied
  pricing. It never invents customers, orders or amounts.

**Do not run the seed against a hosted database without the business
owner's explicit authorization.**

## 5. Verify a real cluster (when credentials exist)

1. Set `MONGODB_URI` in `.env.local`, restart `npm run dev`.
2. `npm run seed -- --yes`, then load `/menu` → preview products render
   **without** the "Preview catalogue" badge (that badge appears only in
   fixtures mode).
3. Toggle `CATALOGUE_SOURCE=fixtures` → badge returns (source switching
   works without code changes).
4. Create a test product with `status: "draft"` → confirm it 404s at
   `/menu/<slug>` and is absent from listings.
5. Break the URI (wrong password) → confirm the friendly unavailable state,
   no stack traces, and that a *failed* query does not show fixtures.

## 6. Notes and limits on M0

- **Search:** plain escaped-substring regex over name/descriptions — no
  Atlas Search (paid). On an M0-sized catalogue a collection scan is fine;
  if the catalogue grows substantially, add a `$text` index (free) or
  revisit.
- **No build-time queries, no scheduled jobs.** Everything is request-time
  with a 5-second bound.
- M0 has usage/instance limits; nothing in this app opens pools beyond the
  single cached connection.
