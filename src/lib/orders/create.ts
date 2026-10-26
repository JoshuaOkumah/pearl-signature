import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { recordAudit } from "@/lib/auth/audit";
import { quoteCart } from "@/lib/cart/quote";
import { checkoutBlockers, matchServiceArea, priceCheckout } from "@/lib/checkout/pricing";
import { connectDatabase, logDatabaseError } from "@/lib/db/mongoose";
import { getCheckoutSettings } from "@/lib/store/config";
import { notifyOrderEvent } from "@/lib/notifications/dispatch";
import { stripeReadiness } from "@/lib/payments/stripe";
import { OrderModel, type OrderRecord } from "@/models/order";
import { ProductModel } from "@/models/product";
import { normalizePostalCode } from "@/lib/validations/checkout";
import type {
  PlaceOrderRequest,
  PlaceOrderResponse,
  PlacedOrderSummary,
} from "@/lib/validations/order";

/**
 * Order creation service (Phase 5) — the single path from a checkout
 * submission to a persisted order.
 *
 * ## The server trusts nothing the customer sent
 *
 * Recited in order, exactly as executed:
 *
 *  1. The request has already been parsed by `placeOrderRequestSchema`
 *     (strict allowlist: no prices, no totals, no status fields survive).
 *  2. Checkout readiness is re-read from configuration: intake, a fulfilment
 *     method and a confirmed tax treatment must all be present.
 *  3. The cart is re-quoted against the live catalogue (`quoteCart`): every
 *     product must still exist, be published, be available, sit in an active
 *     category and still carry a price.
 *  4. Totals are recomputed by the SAME pure `priceCheckout` function the
 *     browser used for its preview — integer cents, owner-configured fee,
 *     owner-attested tax.
 *  5. The recomputed total is compared with `expectedTotalCents`. A mismatch
 *     is a PRICE CHANGE: the order is NOT created, and the customer must
 *     review the new amount. The client's number never becomes the order's
 *     number.
 *  6. The idempotency key is checked against the database, then the insert
 *     runs under unique indexes so two concurrent identical submissions
 *     cannot both succeed.
 *
 * ## Durability of the outcome
 *
 * A duplicate-key rejection on the idempotency index is not an error: the
 * existing order is read back and returned as a replay, so a customer whose
 * response was lost on the wire still lands on their real confirmation, and
 * a double-click still produces exactly one order.
 *
 * Money never passes through a float. Snapshots (names, variant, unit
 * price, fee, tax) are written once and never re-derived from the catalogue.
 */

/* ── small helpers ──────────────────────────────────────────────────── */

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

/** Unpredictable public reference: `PS-` + 10 uppercase hex characters. */
function generateReference(): string {
  return `PS-${randomBytes(5).toString("hex").toUpperCase()}`;
}

/**
 * Canonical hash of the ORDER INTENT: what was ordered, by whom, how it is
 * fulfilled and how it is paid for. Deliberately EXCLUDES
 * `expectedTotalCents`, so a legitimately re-priced retry of the same
 * intent reuses its key instead of being reported as a conflict.
 */
function intentHash(request: PlaceOrderRequest): string {
  const canonical = JSON.stringify({
    items: request.items
      .map((item) => [item.slug, item.variantName ?? "", item.quantity] as const)
      .sort((a, b) => `${a[0]}|${a[1]}`.localeCompare(`${b[0]}|${b[1]}`)),
    customer: {
      fullName: request.customer.fullName,
      email: request.customer.email,
      phone: request.customer.phone,
      fulfillment: request.customer.fulfillment,
      addressLine1: request.customer.addressLine1 ?? "",
      addressLine2: request.customer.addressLine2 ?? "",
      city: request.customer.city ?? "",
      province: request.customer.province ?? "",
      postalCode: request.customer.postalCode ?? "",
      deliveryInstructions: request.customer.deliveryInstructions ?? "",
      notes: request.customer.notes ?? "",
    },
    paymentMethod: request.paymentMethod,
  });
  return sha256(canonical);
}

/** MongoDB duplicate-key code with the offending index, when reported. */
function duplicateKeyIndex(error: unknown): string | null {
  if (typeof error !== "object" || error === null) return null;
  const candidate = error as { code?: unknown; keyPattern?: unknown };
  if (candidate.code !== 11000) return null;
  if (typeof candidate.keyPattern === "object" && candidate.keyPattern !== null) {
    const [first] = Object.keys(candidate.keyPattern as Record<string, unknown>);
    return first ?? "unknown";
  }
  return "unknown";
}

function summarizeOrder(order: OrderRecord): PlacedOrderSummary {
  return {
    reference: order.reference,
    status: order.status,
    totalCents: order.money.totalCents,
    placedAtIso: new Date(order.createdAt).toISOString(),
  };
}

function replay(existing: OrderRecord): PlaceOrderResponse {
  return { ok: true, order: summarizeOrder(existing), replayed: true };
}

async function findByKey(idempotencyKey: string): Promise<OrderRecord | null> {
  return OrderModel.findOne({ idempotencyKey }).lean();
}

/* ── the service ────────────────────────────────────────────────────── */

export async function createOrder(request: PlaceOrderRequest): Promise<PlaceOrderResponse> {
  // 1. Configuration: an unready store refuses before any catalogue work.
  const settings = await getCheckoutSettings();
  const readiness = checkoutBlockers(settings);
  if (readiness.length > 0) {
    return { ok: false, reason: "blocked", blocker: readiness[0] };
  }
  if (request.paymentMethod === "stripe" && (!settings.onlinePaymentsEnabled || !stripeReadiness().ready)) {
    return { ok: false, reason: "payment_unavailable" };
  }

  // 2. Authoritative re-quote of the cart against the live catalogue.
  const quoteResponse = await quoteCart({ items: request.items });
  if (!quoteResponse.ok) return { ok: false, reason: "unavailable" };
  if (quoteResponse.quote.hasIssues) {
    return {
      ok: false,
      reason: "cart_issue",
      issues: quoteResponse.quote.lines
        .filter((line) => line.issue !== null)
        .map((line) => ({
          slug: line.slug,
          variantName: line.variantName,
          issue: line.issue!,
        })),
    };
  }

  const { quote } = quoteResponse;
  const customer = request.customer;
  const method = customer.fulfillment;
  // The stored postal code is canonicalised (`A1A 1A1`) so the snapshot is
  // normalised regardless of how the customer typed it. Matching itself is
  // case/whitespace insensitive, so both paths agree on the service area.
  const postalCode =
    method === "delivery"
      ? (normalizePostalCode(customer.postalCode) ?? customer.postalCode)
      : "";
  const address = method === "delivery" ? { province: customer.province, postalCode } : null;

  // 3. Recompute totals with the exact function the browser preview ran.
  const priced = priceCheckout({
    subtotalCents: quote.subtotalCents,
    method,
    address,
    settings,
  });
  if (!priced.ok) return { ok: false, reason: "blocked", blocker: priced.blocker };

  // 4. Price-change detection: never submit at an amount nobody reviewed.
  if (priced.totals.totalCents !== request.expectedTotalCents) {
    return {
      ok: false,
      reason: "price_changed",
      totals: priced.totals,
      taxLabel: settings.tax.label,
    };
  }

  const idempotencyHash = intentHash(request);

  // 5. Idempotency pre-check: a retry of an intent that already persisted
  //    returns that order instead of creating a second one.
  try {
    await connectDatabase();
    const existing = await findByKey(request.idempotencyKey);
    if (existing) {
      return existing.idempotencyHash === idempotencyHash
        ? replay(existing)
        : { ok: false, reason: "conflict" };
    }
  } catch (error) {
    logDatabaseError("order-idempotency-precheck", error);
    return { ok: false, reason: "unavailable" };
  }

  // 6. Build the snapshot from server data only.
  const matchedArea =
    method === "delivery" ? matchServiceArea(address!, settings.serviceAreas) : null;

  const items = await buildItems(quote.lines).catch((error: unknown) => {
    logDatabaseError("order-items", error);
    return null;
  });
  if (!items) return { ok: false, reason: "unavailable" };

  const now = new Date();
  const baseDocument = {
    idempotencyKey: request.idempotencyKey,
    idempotencyHash,
    confirmationKeyHash: sha256(request.confirmationKey),
    customer: {
      fullName: customer.fullName,
      email: customer.email,
      phone: customer.phone,
    },
    fulfillment: {
      method,
      address:
        method === "delivery"
          ? {
              line1: customer.addressLine1!,
              line2: customer.addressLine2,
              city: customer.city!,
              province: customer.province,
              postalCode,
            }
          : null,
      instructions: customer.deliveryInstructions,
      notes: customer.notes,
      serviceAreaLabel: matchedArea?.label ?? null,
      pickupInstructions: method === "pickup" ? settings.pickupInstructions : null,
    },
    items,
    money: {
      currency: "CAD" as const,
      subtotalCents: priced.totals.subtotalCents,
      deliveryFeeCents: priced.totals.deliveryFeeCents,
      taxCents: priced.totals.taxCents,
      totalCents: priced.totals.totalCents,
      taxLabel: settings.tax.mode === "rate" ? settings.tax.label : null,
      taxRateBps: settings.tax.mode === "rate" ? settings.tax.rateBps : null,
    },
    payment: {
      method: request.paymentMethod,
      status: "unpaid" as const,
      provider: request.paymentMethod === "stripe" ? "stripe" as const : "none" as const,
    },
    status: "placed" as const,
    statusHistory: [{ from: null, to: "placed" as const, at: now, adminId: null, note: null }],
    version: 1,
  };

  // 7. Insert under unique indexes. Reference collisions are retried;
  //    idempotency collisions resolve to the already-persisted order.
  for (let attempt = 0; attempt < 4; attempt++) {
    const reference = generateReference();
    try {
      const created = await OrderModel.create({ ...baseDocument, reference });
      const summary = summarizeOrder(created);

      void recordAudit({
        event: "order.placed",
        outcome: "success",
        target: { type: "order", id: summary.reference, label: "Order placed" },
        detail: `${request.paymentMethod}, ${method}, ${summary.totalCents} CAD cents`,
      });

      // Enqueue the order-placed notifications (idempotent; stores no
      // personal data) and attempt delivery in the background. Both steps
      // swallow their own errors: neither can fail or roll back an order
      // that is already persisted (docs/ORDER_NOTIFICATIONS.md).
      await notifyOrderEvent("order.placed", summary.reference);

      return { ok: true, order: summary, replayed: false };
    } catch (error) {
      const duplicate = duplicateKeyIndex(error);

      if (duplicate === "idempotencyKey" || duplicate === "unknown") {
        // A concurrent identical submission won the race (or the index name
        // was not reported). Read the winner back and treat it as a replay
        // when the intent matches.
        try {
          const existing = await findByKey(request.idempotencyKey);
          if (existing) {
            return existing.idempotencyHash === idempotencyHash
              ? replay(existing)
              : { ok: false, reason: "conflict" };
          }
        } catch (lookupError) {
          logDatabaseError("order-idempotency-recovery", lookupError);
          return { ok: false, reason: "unavailable" };
        }
        continue; // nothing found: assume a reference collision, retry
      }

      if (duplicate === "reference") continue; // astronomically rare: retry

      logDatabaseError("order-insert", error);
      return { ok: false, reason: "unavailable" };
    }
  }

  return { ok: false, reason: "unavailable" };
}

/* ── item snapshots ─────────────────────────────────────────────────── */

/**
 * Attach the catalogue `_id` to each quoted line with ONE batched read.
 *
 * The quote response deliberately never carries Mongo ids (they are not
 * part of the public surface), but an order wants a durable link back to
 * the product for the owner's operations. Runs only at order time, never
 * in a hot path.
 */
async function buildItems(
  lines: Array<{
    slug: string;
    variantName: string | null;
    quantity: number;
    unitPriceCents: number | null;
    lineTotalCents: number | null;
    name: string | null;
    image: { secureUrl: string; alt: string } | null;
  }>,
) {
  const slugs = lines.map((line) => line.slug);
  const products = await ProductModel.find({ slug: { $in: slugs } })
    .select({ _id: 1, slug: 1 })
    .lean();

  const idBySlug = new Map(products.map((product) => [product.slug as string, String(product._id)]));

  return lines.map((line) => ({
    // A published, quoted product always resolves; the fallback keeps the
    // snapshot valid rather than failing the whole order over an id.
    productId: idBySlug.get(line.slug) ?? "",
    slug: line.slug,
    name: line.name!,
    variantName: line.variantName,
    quantity: line.quantity,
    unitPriceCents: line.unitPriceCents!,
    lineTotalCents: line.lineTotalCents!,
    image: line.image,
  }));
}
