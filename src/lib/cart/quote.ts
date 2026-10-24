import "server-only";
import { categories as fixtureCategories } from "@/data/categories";
import { products as fixtureProducts } from "@/data/products";
import { connectDatabase, logDatabaseError } from "@/lib/db/mongoose";
import { canDeliverImage } from "@/lib/images";
import { CategoryModel } from "@/models/category";
import { ProductModel } from "@/models/product";
import { resolveCatalogueSource } from "@/lib/repositories/catalogue";
import type {
  CartQuote,
  CartQuoteRequest,
  CartQuoteResponse,
  QuotedLine,
  QuoteLineIssue,
} from "@/lib/validations/cart";

/**
 * Cart quote and price reconciliation service (Phase 4).
 *
 * This is the single authoritative source of cart pricing. The browser holds
 * only line identities and quantities; every price, name, image, availability
 * flag and total comes from here, read fresh from the catalogue.
 *
 * ## Guarantees
 *
 * - **Server-authoritative.** Nothing the client sends other than
 *   `{ slug, variantName, quantity }` is ever believed. A tampered
 *   localStorage price has no effect on any total shown at checkout.
 * - **Two queries, never one per line.** One read of the active categories and
 *   one `$in` read of the products. A 30-line cart costs the same as a 1-line
 *   cart.
 * - **Only public data leaves.** The product query filters on
 *   `status: "published"` and then re-checks category activation, so drafts,
 *   archived items and products in a disabled category are indistinguishable
 *   from products that never existed.
 * - **Integer cents throughout.** Multiplication and summation use integers
 *   only; the sole float operation in the whole pipeline is the final
 *   `Intl.NumberFormat` render.
 * - **Read-only.** It creates no order, reserves no inventory, records no
 *   customer detail and performs no write of any kind.
 */

/* ── catalogue lookup shape ─────────────────────────────────────────── */

interface ResolvableProduct {
  slug: string;
  name: string;
  categorySlug: string;
  availability: string;
  priceCents: number | null;
  variants: Array<{ name: string; priceCents: number | null }>;
  image: { secureUrl: string; alt: string } | null;
}

export type ProductLookup = Map<string, ResolvableProduct>;

/* ── pure resolution logic (unit-tested without a database) ─────────── */

/**
 * Work out the purchasable unit price for one line.
 *
 * Rules, in order:
 *  1. A product with options requires a selection — the base price is never
 *     silently substituted for a variant the owner actually configured.
 *  2. The selected option must still exist (renames and deletions surface as
 *     an actionable warning instead of a wrong price).
 *  3. Duplicate option names make the identity ambiguous, so the line is
 *     refused rather than priced by accident.
 *  4. A missing price is NEVER treated as zero.
 */
function resolveUnitPrice(
  product: ResolvableProduct,
  variantName: string | null,
): { unitPriceCents: number } | { issue: QuoteLineIssue } {
  if (product.variants.length > 0) {
    if (variantName === null) return { issue: "variant_required" };

    const matches = product.variants.filter((variant) => variant.name === variantName);
    if (matches.length === 0) return { issue: "variant_not_found" };
    if (matches.length > 1) return { issue: "variant_ambiguous" };

    const cents = matches[0].priceCents;
    if (typeof cents !== "number" || !Number.isInteger(cents) || cents < 1) {
      return { issue: "variant_unpriced" };
    }
    return { unitPriceCents: cents };
  }

  if (typeof product.priceCents !== "number" || !Number.isInteger(product.priceCents) || product.priceCents < 1) {
    return { issue: "unpriced" };
  }
  return { unitPriceCents: product.priceCents };
}

/**
 * Build a complete quote from already-resolved catalogue data. Pure: this is
 * where every reconciliation rule is exercised by the unit tests.
 */
export function buildQuote(request: CartQuoteRequest, catalogue: ProductLookup): CartQuote {
  const lines: QuotedLine[] = [];
  let subtotalCents = 0;
  let purchasableQuantity = 0;
  let purchasableLineCount = 0;

  for (const item of request.items) {
    const product = catalogue.get(item.slug);

    // Missing, draft, archived or disabled-category products all resolve to
    // the same neutral outcome: no name, no price, one shared message.
    if (!product) {
      lines.push(unavailableLine(item, "not_found"));
      continue;
    }

    if (product.availability !== "available") {
      lines.push({
        ...unavailableLine(item, "unavailable"),
        name: product.name,
        categorySlug: product.categorySlug,
      });
      continue;
    }

    const resolved = resolveUnitPrice(product, item.variantName);
    if ("issue" in resolved) {
      lines.push({
        ...unavailableLine(item, resolved.issue),
        name: product.name,
        categorySlug: product.categorySlug,
      });
      continue;
    }

    // Integer-cent multiplication only. The request bounds (≤25 per line,
    // ≤99 units per cart, prices ≤ $999,999.99) keep this far inside the
    // safe-integer range.
    const lineTotalCents = resolved.unitPriceCents * item.quantity;
    if (!Number.isSafeInteger(lineTotalCents)) {
      lines.push({
        ...unavailableLine(item, "unpriced"),
        name: product.name,
        categorySlug: product.categorySlug,
      });
      continue;
    }

    subtotalCents += lineTotalCents;
    purchasableQuantity += item.quantity;
    purchasableLineCount += 1;

    lines.push({
      slug: item.slug,
      variantName: item.variantName,
      quantity: item.quantity,
      unitPriceCents: resolved.unitPriceCents,
      lineTotalCents,
      name: product.name,
      categorySlug: product.categorySlug,
      image: product.image,
      issue: null,
    });
  }

  return {
    lines,
    subtotalCents,
    purchasableQuantity,
    purchasableLineCount,
    hasIssues: lines.some((line) => line.issue !== null),
  };
}

function unavailableLine(
  item: CartQuoteRequest["items"][number],
  issue: QuoteLineIssue,
): QuotedLine {
  return {
    slug: item.slug,
    variantName: item.variantName,
    quantity: item.quantity,
    unitPriceCents: null,
    lineTotalCents: null,
    name: null,
    categorySlug: null,
    image: null,
    issue,
  };
}

/* ── catalogue readers ──────────────────────────────────────────────── */

/** First image reference that is actually deliverable, or none. */
function firstDeliverableImage(
  images: Array<{ secureUrl?: unknown; alt?: unknown }> | null | undefined,
  fallbackAlt: string,
): { secureUrl: string; alt: string } | null {
  for (const image of images ?? []) {
    if (typeof image?.secureUrl !== "string") continue;
    const candidate = { secureUrl: image.secureUrl };
    if (!canDeliverImage(candidate)) continue;
    const alt = typeof image.alt === "string" && image.alt.trim() !== "" ? image.alt.trim() : fallbackAlt;
    return { secureUrl: image.secureUrl, alt };
  }
  return null;
}

async function loadFromDatabase(request: CartQuoteRequest): Promise<CartQuoteResponse> {
  await connectDatabase();

  const slugs = [...new Set(request.items.map((item) => item.slug))];

  // Two reads, both indexed: one for the active-category allowlist, one
  // batched product read restricted to published records.
  const [categories, products] = await Promise.all([
    CategoryModel.find({ isActive: true }).select({ _id: 1, slug: 1 }).lean(),
    ProductModel.find({ slug: { $in: slugs }, status: "published" })
      .select({
        name: 1,
        slug: 1,
        priceCents: 1,
        variants: 1,
        availability: 1,
        categoryId: 1,
        images: { $slice: 1 },
      })
      .lean(),
  ]);

  const categorySlugById = new Map(
    categories.map((category) => [String(category._id), category.slug as string]),
  );

  const catalogue: ProductLookup = new Map();
  for (const product of products) {
    const categorySlug = categorySlugById.get(String(product.categoryId));
    // A product whose category was deactivated reads exactly like one that
    // does not exist — no information leak about the private catalogue.
    if (!categorySlug) continue;

    catalogue.set(product.slug, {
      slug: product.slug,
      name: product.name,
      categorySlug,
      availability: product.availability,
      priceCents: product.priceCents ?? null,
      variants: (product.variants ?? []).map((variant) => ({
        name: variant.name,
        priceCents: variant.priceCents ?? null,
      })),
      image: firstDeliverableImage(product.images, product.name),
    });
  }

  return { ok: true, quote: buildQuote(request, catalogue) };
}

async function loadFromFixtures(request: CartQuoteRequest): Promise<CartQuoteResponse> {
  const activeSlugs = new Set<string>(fixtureCategories.map((category) => category.slug));

  const catalogue: ProductLookup = new Map();
  for (const product of fixtureProducts) {
    if (product.status !== "published" || !activeSlugs.has(product.category)) continue;
    catalogue.set(product.slug, {
      slug: product.slug,
      name: product.name,
      categorySlug: product.category,
      availability: product.availability,
      priceCents: product.priceCents ?? null,
      variants: (product.variants ?? []).map((variant) => ({
        name: variant.name,
        priceCents: variant.priceCents ?? null,
      })),
      image: firstDeliverableImage(product.images, product.name),
    });
  }

  return { ok: true, quote: buildQuote(request, catalogue) };
}

/* ── public entry point ─────────────────────────────────────────────── */

/**
 * Quote a cart against the live catalogue.
 *
 * Returns `{ ok: false, reason: "unavailable" }` when the catalogue cannot be
 * reached, so callers can preserve the customer's selections and ask them to
 * retry rather than showing an unverified total as though it were final.
 */
export async function quoteCart(request: CartQuoteRequest): Promise<CartQuoteResponse> {
  const source = resolveCatalogueSource();

  if (source === "unavailable") {
    return { ok: false, reason: "unavailable" };
  }

  try {
    return source === "fixtures" ? await loadFromFixtures(request) : await loadFromDatabase(request);
  } catch (error) {
    logDatabaseError("cart-quote", error);
    return { ok: false, reason: "unavailable" };
  }
}
