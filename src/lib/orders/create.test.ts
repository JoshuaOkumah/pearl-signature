// @vitest-environment node
import { randomBytes, createHash } from "node:crypto";
import mongoose from "mongoose";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { MongoMemoryServer } from "mongodb-memory-server";
import { createOrder } from "./create";
import { connectDatabase } from "@/lib/db/mongoose";
import { placeOrderRequestSchema, type PlaceOrderRequest } from "@/lib/validations/order";
import { AuditLogModel } from "@/models/audit-log";
import { CategoryModel } from "@/models/category";
import { OrderAttemptModel } from "@/models/order-attempt";
import { NotificationOutboxModel } from "@/models/notification-outbox";
import { OrderModel } from "@/models/order";
import { ProductModel } from "@/models/product";
import { StoreConfigModel } from "@/models/store-config";

/**
 * Order creation matrix (Phase 5, Milestone B) against a REAL MongoDB.
 *
 * A disposable in-memory server is used rather than mocks, because the
 * properties under test are the ones mocks cannot prove: unique indexes,
 * concurrent duplicate-key races, and the fact that a snapshot written once
 * is never re-derived from the catalogue.
 *
 * Everything seeded here is explicitly SYNTHETIC and LABELLED as a test
 * policy: a "Test metro" service area, a "Test HST" rate of 13% on
 * merchandise, and products named "Synthetic …". No fixture in this file
 * may ever be mistaken for a real business decision, and nothing in the
 * application ships with these values.
 *
 * The test policy's delivery fee is 700 cents and its tax is computed by
 * the same half-up integer formula the production pricing module uses, so a
 * wrong rounding or a wrong fee in `createOrder` fails here.
 */

/* ── test policy constants (mirrors the seeded configuration) ───────── */

const TEST_FEE_CENTS = 700;
const TEST_TAX_BPS = 1300;
const TEST_FSA = "M5H";

let mongod: MongoMemoryServer | null = null;

/** The documented half-up integer rounding, restated independently here. */
function policyTax(subtotalCents: number): number {
  return Math.floor((subtotalCents * TEST_TAX_BPS + 5_000) / 10_000);
}

function expectedTotal(subtotalCents: number, method: "delivery" | "pickup"): number {
  const fee = method === "delivery" ? TEST_FEE_CENTS : 0;
  return subtotalCents + fee + policyTax(subtotalCents);
}

/* ── fixtures ───────────────────────────────────────────────────────── */

const JOLOF_PRICE = 1_250;
const SUYA_PRICE = 800;
const SMALL_PRICE = 800;
const LARGE_PRICE = 1_400;

function key(): string {
  return randomBytes(32).toString("hex");
}

function reference(): string {
  return `PS-${randomBytes(5).toString("hex").toUpperCase()}`;
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

async function seedCatalogue(): Promise<void> {
  const category = await CategoryModel.create({ name: "Test Mains", slug: "test-mains" });
  await ProductModel.create([
    {
      name: "Synthetic Jollof",
      slug: "jollof-test",
      description: "Synthetic test product",
      categoryId: category._id,
      priceCents: JOLOF_PRICE,
      status: "published",
      availability: "available",
    },
    {
      name: "Synthetic Suya",
      slug: "suya-test",
      description: "Synthetic test product",
      categoryId: category._id,
      priceCents: SUYA_PRICE,
      status: "published",
      availability: "available",
    },
    {
      name: "Synthetic Portion Pack",
      slug: "portion-test",
      description: "Synthetic test product with options",
      categoryId: category._id,
      priceCents: null,
      variants: [
        { name: "Small", priceCents: SMALL_PRICE },
        { name: "Large", priceCents: LARGE_PRICE },
      ],
      status: "published",
      availability: "available",
    },
  ]);
}

/** The explicitly labelled synthetic policy every test starts from. */
async function seedReadyConfig(): Promise<void> {
  await StoreConfigModel.replaceOne(
    { _id: "checkout" },
    {
      _id: "checkout",
      orderIntakeEnabled: true,
      delivery: {
        enabled: true,
        serviceAreas: [
          {
            label: "Test metro",
            provinces: ["ON"],
            postalPrefixes: [TEST_FSA],
            feeCents: TEST_FEE_CENTS,
          },
        ],
      },
      pickup: { enabled: true, instructions: "Synthetic test counter opens at noon." },
      tax: { mode: "rate", rateBps: TEST_TAX_BPS, base: "merchandise", label: "Test HST" },
      customerNote: "Synthetic test policy",
    },
    { upsert: true },
  );
}

/* ── request builder ────────────────────────────────────────────────── */

function baseCustomer(): Record<string, unknown> {
  return {
    fullName: "Ada Obi",
    email: "ada.obi@example.com",
    phone: "416 555 0123",
    fulfillment: "delivery",
    addressLine1: "1 Test Way",
    addressLine2: "",
    city: "Toronto",
    province: "ON",
    postalCode: `${TEST_FSA} 2N2`,
    deliveryInstructions: "Test buzzer 12",
    notes: "Synthetic note",
  };
}

function makeRequest(overrides: Record<string, unknown> = {}): PlaceOrderRequest {
  const items = (overrides.items as unknown[]) ?? [{ slug: "jollof-test", variantName: null, quantity: 3 }];
  const customer = (overrides.customer as Record<string, unknown>) ?? baseCustomer();
  const method = (customer.fulfillment as "delivery" | "pickup") ?? "delivery";
  const subtotal = subtotalFor(items);

  return placeOrderRequestSchema.parse({
    idempotencyKey: key(),
    confirmationKey: key(),
    expectedTotalCents: expectedTotal(subtotal, method),
    items,
    customer,
    paymentMethod: "cash_on_arrival",
    ...overrides,
  });
}

/**
 * Local subtotal mirror of the catalogue prices seeded above. The server
 * must reach the SAME number independently; a drift between this file and
 * the real pipeline is exactly what the price-change tests look for.
 * Unknown slugs (deliberate "ghost" lines) contribute nothing, because the
 * server refuses them before any total is compared.
 */
function subtotalFor(items: unknown[]): number {
  const prices: Record<string, number | Record<string, number>> = {
    "jollof-test": JOLOF_PRICE,
    "suya-test": SUYA_PRICE,
    "portion-test": { Small: SMALL_PRICE, Large: LARGE_PRICE },
  };
  return (items as Array<{ slug: string; variantName: string | null; quantity: number }>).reduce(
    (sum, item) => {
      const price = prices[item.slug];
      const unit = typeof price === "number" ? price : price?.[item.variantName ?? ""];
      return unit === undefined ? sum : sum + unit * item.quantity;
    },
    0,
  );
}

/* ── lifecycle ──────────────────────────────────────────────────────── */

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  process.env.MONGODB_URI = mongod.getUri("pearl_orders_test");
  await connectDatabase();
  // `autoIndex` is off by design (the seed script builds indexes in real
  // deployments); these tests build them explicitly because the unique
  // indexes ARE the concurrency guarantees under test.
  await OrderModel.createIndexes();
  await NotificationOutboxModel.createIndexes();
});

afterAll(async () => {
  await OrderModel.deleteMany({});
  await mongoose.disconnect();
  await mongod?.stop();
  mongod = null;
});

beforeEach(async () => {
  await Promise.all([
    OrderModel.deleteMany({}),
    OrderAttemptModel.deleteMany({}),
    AuditLogModel.deleteMany({}),
    NotificationOutboxModel.deleteMany({}),
    ProductModel.deleteMany({}),
    CategoryModel.deleteMany({}),
  ]);
  await seedCatalogue();
  await seedReadyConfig();
});

/* ── notification enqueue (Milestone E wiring) ──────────────────────── */

describe("createOrder: notifications", () => {
  it("enqueues customer and admin outbox entries for the placed order", async () => {
    const response = await createOrder(makeRequest());
    expect(response.ok).toBe(true);
    if (!response.ok) return;
    const { reference } = response.order;

    const entries = await NotificationOutboxModel.find({ reference }).lean();
    expect(entries).toHaveLength(2);
    expect(entries.map((entry) => entry.key).sort()).toEqual(
      [`order.placed:${reference}:admin`, `order.placed:${reference}:customer`].sort(),
    );
    for (const entry of entries) {
      expect(entry.status).toBe("pending");
      expect(entry.attempts).toBe(0);
    }
    // The queue never stores the customer's address or name.
    const raw = JSON.stringify(entries);
    expect(raw).not.toContain("ada.obi@example.com");
    expect(raw).not.toContain("Ada Obi");
  });

  it("does not duplicate entries when an idempotent request is replayed", async () => {
    const request = makeRequest();
    const first = await createOrder(request);
    const second = await createOrder(request);
    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect(second.replayed).toBe(true);

    // The replay path returns the existing order without re-notifying.
    expect(await NotificationOutboxModel.countDocuments({})).toBe(2);
    expect(
      await NotificationOutboxModel.countDocuments({ key: `order.placed:${first.order.reference}:customer` }),
    ).toBe(1);
  });

  it("enqueues nothing when the order is rejected before insertion", async () => {
    // A total the customer did not agree to is a price change: no insert.
    const response = await createOrder(makeRequest({ expectedTotalCents: 1 }));
    expect(response.ok).toBe(false);
    expect(await OrderModel.countDocuments({})).toBe(0);
    expect(await NotificationOutboxModel.countDocuments({})).toBe(0);
  });
});

/* ── creation ───────────────────────────────────────────────────────── */

describe("createOrder: a placed order", () => {
  it("prices a delivery order entirely on the server, in integer cents", async () => {
    const response = await createOrder(makeRequest());

    expect(response.ok).toBe(true);
    if (!response.ok) return;

    const order = await OrderModel.findOne({ reference: response.order.reference }).lean();
    expect(order).not.toBeNull();
    // 3 × $12.50 = 3750; fee 700; 13% half-up = 488; total 4938.
    expect(order!.money).toMatchObject({
      currency: "CAD",
      subtotalCents: 3_750,
      deliveryFeeCents: TEST_FEE_CENTS,
      taxCents: 488,
      totalCents: 4_938,
    });
    expect(order!.money.subtotalCents + order!.money.deliveryFeeCents + order!.money.taxCents).toBe(
      order!.money.totalCents,
    );
    expect(response.order.totalCents).toBe(4_938);
    expect(Number.isInteger(order!.money.totalCents)).toBe(true);
  });

  it("snapshots the customer and the served delivery area", async () => {
    const response = await createOrder(makeRequest());
    expect(response.ok).toBe(true);
    if (!response.ok) return;

    const order = await OrderModel.findOne({ reference: response.order.reference }).lean();
    expect(order!.customer).toMatchObject({
      fullName: "Ada Obi",
      email: "ada.obi@example.com",
      phone: "+14165550123",
    });
    expect(order!.fulfillment.method).toBe("delivery");
    expect(order!.fulfillment.address).toMatchObject({
      line1: "1 Test Way",
      city: "Toronto",
      province: "ON",
      postalCode: `${TEST_FSA} 2N2`,
    });
    expect(order!.fulfillment.serviceAreaLabel).toBe("Test metro");
    expect(order!.fulfillment.instructions).toBe("Test buzzer 12");
    expect(order!.fulfillment.notes).toBe("Synthetic note");
  });

  it("normalises the postal code the customer typed into canonical form", async () => {
    const customer = { ...baseCustomer(), postalCode: "m5h2n2" };
    const response = await createOrder(makeRequest({ customer }));
    expect(response.ok).toBe(true);
    if (!response.ok) return;

    const order = await OrderModel.findOne({ reference: response.order.reference }).lean();
    expect(order!.fulfillment.address!.postalCode).toBe(`${TEST_FSA} 2N2`);
  });

  it("snapshots each item with its agreed unit price and line total", async () => {
    const items = [
      { slug: "jollof-test", variantName: null, quantity: 3 },
      { slug: "suya-test", variantName: null, quantity: 2 },
    ];
    const response = await createOrder(makeRequest({ items }));
    expect(response.ok).toBe(true);
    if (!response.ok) return;

    const order = await OrderModel.findOne({ reference: response.order.reference }).lean();
    expect(order!.items).toHaveLength(2);

    const jollof = order!.items.find((item) => item.slug === "jollof-test")!;
    expect(jollof).toMatchObject({
      name: "Synthetic Jollof",
      variantName: null,
      quantity: 3,
      unitPriceCents: JOLOF_PRICE,
      lineTotalCents: JOLOF_PRICE * 3,
    });
    expect(jollof.productId).toBeTruthy();

    const suya = order!.items.find((item) => item.slug === "suya-test")!;
    expect(suya.lineTotalCents).toBe(SUYA_PRICE * 2);
    expect(order!.money.subtotalCents).toBe(JOLOF_PRICE * 3 + SUYA_PRICE * 2);
  });

  it("starts at placed with the placement event at the head of the history", async () => {
    const response = await createOrder(makeRequest());
    expect(response.ok).toBe(true);
    if (!response.ok) return;

    const order = await OrderModel.findOne({ reference: response.order.reference }).lean();
    expect(order!.status).toBe("placed");
    expect(order!.version).toBe(1);
    expect(order!.statusHistory).toHaveLength(1);
    expect(order!.statusHistory[0]).toMatchObject({ from: null, to: "placed", adminId: null });
    expect(order!.cancellationReason).toBeNull();
    expect(order!.notes).toHaveLength(0);
  });

  it("records Cash on Arrival as chosen but NOT paid", async () => {
    const response = await createOrder(makeRequest());
    expect(response.ok).toBe(true);
    if (!response.ok) return;

    const order = await OrderModel.findOne({ reference: response.order.reference }).lean();
    expect(order!.payment).toMatchObject({
      method: "cash_on_arrival",
      status: "unpaid",
      paidAt: null,
      paidByAdminId: null,
    });
  });

  it("issues unique, unpredictably formatted public references", async () => {
    const first = await createOrder(makeRequest());
    const second = await createOrder(makeRequest());
    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) return;

    expect(first.order.reference).toMatch(/^PS-[0-9A-F]{10}$/);
    expect(second.order.reference).toMatch(/^PS-[0-9A-F]{10}$/);
    expect(first.order.reference).not.toBe(second.order.reference);
    expect(await OrderModel.countDocuments({})).toBe(2);
  });

  it("stores only the sha256 of the confirmation capability", async () => {
    const confirmationKey = key();
    const response = await createOrder(makeRequest({ confirmationKey }));
    expect(response.ok).toBe(true);
    if (!response.ok) return;

    const order = await OrderModel.findOne({ reference: response.order.reference }).lean();
    expect(order!.confirmationKeyHash).toBe(sha256(confirmationKey));
    expect(JSON.stringify(order)).not.toContain(confirmationKey);
  });

  it("prices pickup with no delivery fee and snapshots the pickup instructions", async () => {
    const customer = { ...baseCustomer(), fulfillment: "pickup" };
    const response = await createOrder(makeRequest({ customer }));
    expect(response.ok).toBe(true);
    if (!response.ok) return;

    const order = await OrderModel.findOne({ reference: response.order.reference }).lean();
    expect(order!.money).toMatchObject({
      subtotalCents: 3_750,
      deliveryFeeCents: 0,
      taxCents: 488,
      totalCents: 4_238,
    });
    expect(order!.fulfillment.address).toBeNull();
    expect(order!.fulfillment.serviceAreaLabel).toBeNull();
    expect(order!.fulfillment.pickupInstructions).toBe("Synthetic test counter opens at noon.");
  });

  it("honours an owner-stated zero-tax policy with no invented label", async () => {
    await StoreConfigModel.updateOne(
      { _id: "checkout" },
      { $set: { tax: { mode: "zero", rateBps: null, base: null, label: null } } },
    );

    const response = await createOrder(makeRequest({ expectedTotalCents: 3_750 + TEST_FEE_CENTS }));
    expect(response.ok).toBe(true);
    if (!response.ok) return;

    const order = await OrderModel.findOne({ reference: response.order.reference }).lean();
    expect(order!.money.taxCents).toBe(0);
    expect(order!.money.taxLabel).toBeNull();
    expect(order!.money.taxRateBps).toBeNull();
    expect(order!.money.totalCents).toBe(3_750 + TEST_FEE_CENTS);
  });

  it("applies the owner-attested rate with half-up integer rounding", async () => {
    // 3 × $12.50 = 3750 cents → 13% = 487.5 → half-up 488, never 487.
    const response = await createOrder(makeRequest());
    expect(response.ok).toBe(true);
    if (!response.ok) return;

    const order = await OrderModel.findOne({ reference: response.order.reference }).lean();
    expect(order!.money.taxCents).toBe(488);
    expect(order!.money.taxLabel).toBe("Test HST");
    expect(order!.money.taxRateBps).toBe(TEST_TAX_BPS);
  });

  it("orders a variant at its option price, not at any base price", async () => {
    const items = [{ slug: "portion-test", variantName: "Small", quantity: 2 }];
    const response = await createOrder(makeRequest({ items }));
    expect(response.ok).toBe(true);
    if (!response.ok) return;

    const order = await OrderModel.findOne({ reference: response.order.reference }).lean();
    expect(order!.items[0]).toMatchObject({
      variantName: "Small",
      unitPriceCents: SMALL_PRICE,
      lineTotalCents: SMALL_PRICE * 2,
    });
    expect(order!.money.subtotalCents).toBe(SMALL_PRICE * 2);
  });

  it("leaves historical orders intact when the product is later edited", async () => {
    const response = await createOrder(makeRequest());
    expect(response.ok).toBe(true);
    if (!response.ok) return;

    await ProductModel.updateOne(
      { slug: "jollof-test" },
      { $set: { name: "Renamed Jollof", priceCents: 9_999, status: "draft" } },
    );

    const order = await OrderModel.findOne({ reference: response.order.reference }).lean();
    expect(order!.items[0].name).toBe("Synthetic Jollof");
    expect(order!.items[0].unitPriceCents).toBe(JOLOF_PRICE);
    expect(order!.money.subtotalCents).toBe(3_750);
    expect(order!.money.totalCents).toBe(4_938);
  });

  it("records an order.placed audit event for the operator", async () => {
    const response = await createOrder(makeRequest());
    expect(response.ok).toBe(true);
    if (!response.ok) return;

    await vi.waitFor(async () => {
      const events = await AuditLogModel.find({ event: "order.placed" }).lean();
      expect(events).toHaveLength(1);
      expect(events[0].target.id).toBe(response.order.reference);
      expect(events[0].outcome).toBe("success");
    });
  });
});

/* ── refusal paths ──────────────────────────────────────────────────── */

describe("createOrder: refusing to submit", () => {
  it("rejects a stale reviewed total as a price change, creating nothing", async () => {
    const response = await createOrder(makeRequest({ expectedTotalCents: 1 }));

    expect(response.ok).toBe(false);
    if (response.ok) return;
    expect(response.reason).toBe("price_changed");
    if (response.reason !== "price_changed") return;
    // The server reports ITS totals for re-review; the client's number is
    // never stored anywhere.
    expect(response.totals).toEqual({
      subtotalCents: 3_750,
      deliveryFeeCents: TEST_FEE_CENTS,
      taxCents: 488,
      totalCents: 4_938,
    });
    expect(response.taxLabel).toBe("Test HST");
    expect(await OrderModel.countDocuments({})).toBe(0);
  });

  it("blocks while order intake is closed", async () => {
    await StoreConfigModel.updateOne({ _id: "checkout" }, { $set: { orderIntakeEnabled: false } });

    const response = await createOrder(makeRequest());
    expect(response).toMatchObject({ ok: false, reason: "blocked", blocker: "intake_closed" });
    expect(await OrderModel.countDocuments({})).toBe(0);
  });

  it("blocks when the store has never been configured", async () => {
    await StoreConfigModel.deleteMany({});

    const response = await createOrder(makeRequest());
    expect(response).toMatchObject({ ok: false, reason: "blocked", blocker: "intake_closed" });
    expect(await OrderModel.countDocuments({})).toBe(0);
  });

  it("blocks while the tax treatment is still unconfigured", async () => {
    await StoreConfigModel.updateOne(
      { _id: "checkout" },
      { $set: { tax: { mode: "unconfigured", rateBps: null, base: null, label: null } } },
    );

    const response = await createOrder(makeRequest());
    expect(response).toMatchObject({ ok: false, reason: "blocked", blocker: "tax_unconfigured" });
    expect(await OrderModel.countDocuments({})).toBe(0);
  });

  it("blocks a delivery method the owner has turned off", async () => {
    await StoreConfigModel.updateOne({ _id: "checkout" }, { $set: { "delivery.enabled": false } });

    const response = await createOrder(makeRequest());
    expect(response).toMatchObject({ ok: false, reason: "blocked", blocker: "method_unavailable" });
    expect(await OrderModel.countDocuments({})).toBe(0);
  });

  it("blocks delivery to an address outside every configured area", async () => {
    const customer = { ...baseCustomer(), postalCode: "K1A 0B1" };
    const response = await createOrder(makeRequest({ customer }));

    expect(response).toMatchObject({ ok: false, reason: "blocked", blocker: "area_unsupported" });
    expect(await OrderModel.countDocuments({})).toBe(0);
  });

  it("reports an unpublished product as a cart issue", async () => {
    await ProductModel.updateOne({ slug: "jollof-test" }, { $set: { status: "draft" } });

    const response = await createOrder(makeRequest());
    expect(response.ok).toBe(false);
    if (response.ok) return;
    expect(response.reason).toBe("cart_issue");
    if (response.reason !== "cart_issue") return;
    expect(response.issues).toEqual([
      { slug: "jollof-test", variantName: null, issue: "not_found" },
    ]);
    expect(await OrderModel.countDocuments({})).toBe(0);
  });

  it("reports a product that no longer exists without revealing that it ever did", async () => {
    const response = await createOrder(
      makeRequest({ items: [{ slug: "ghost-product", variantName: null, quantity: 1 }] }),
    );

    expect(response.ok).toBe(false);
    if (response.ok) return;
    expect(response.reason).toBe("cart_issue");
    if (response.reason !== "cart_issue") return;
    expect(response.issues[0].issue).toBe("not_found");
  });

  it("refuses a variant line whose option was never selected", async () => {
    const response = await createOrder(
      makeRequest({
        items: [{ slug: "portion-test", variantName: null, quantity: 1 }],
        expectedTotalCents: 1,
      }),
    );

    expect(response.ok).toBe(false);
    if (response.ok) return;
    expect(response.reason).toBe("cart_issue");
    if (response.reason !== "cart_issue") return;
    expect(response.issues[0].issue).toBe("variant_required");
  });

  it("never trusts a product that has become unpriced", async () => {
    await ProductModel.updateOne({ slug: "jollof-test" }, { $set: { priceCents: null } });

    const response = await createOrder(makeRequest());
    expect(response.ok).toBe(false);
    if (response.ok) return;
    expect(response.reason).toBe("cart_issue");
    if (response.reason !== "cart_issue") return;
    expect(response.issues[0].issue).toBe("unpriced");
    expect(await OrderModel.countDocuments({})).toBe(0);
  });
});

/* ── idempotency ────────────────────────────────────────────────────── */

describe("createOrder: idempotency", () => {
  it("replays the original order when the same intent is submitted again", async () => {
    const request = makeRequest();

    const first = await createOrder(request);
    const second = await createOrder(request);

    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect(first.replayed).toBe(false);
    expect(second.replayed).toBe(true);
    expect(second.order.reference).toBe(first.order.reference);
    expect(await OrderModel.countDocuments({})).toBe(1);
  });

  it("reports a conflict when one key is reused with a different intent", async () => {
    const keys = { idempotencyKey: key(), confirmationKey: key() };
    const first = await createOrder(makeRequest(keys));
    expect(first.ok).toBe(true);
    if (!first.ok) return;

    // Same key, a total that matches the new basket, different intent.
    const changed = makeRequest({
      ...keys,
      items: [{ slug: "jollof-test", variantName: null, quantity: 4 }],
      expectedTotalCents: expectedTotal(JOLOF_PRICE * 4, "delivery"),
    });

    const response = await createOrder(changed);
    expect(response).toMatchObject({ ok: false, reason: "conflict" });
    expect(await OrderModel.countDocuments({})).toBe(1);
  });

  it("collapses concurrent identical submissions into exactly one order", async () => {
    const request = makeRequest();

    const [a, b] = await Promise.all([createOrder(request), createOrder(request)]);

    expect(a.ok && b.ok).toBe(true);
    if (!a.ok || !b.ok) return;
    expect(a.order.reference).toBe(b.order.reference);
    // Exactly one caller performed the insert; the other recovered through
    // the duplicate-key replay path.
    expect([a, b].filter((response) => !response.replayed)).toHaveLength(1);
    expect(await OrderModel.countDocuments({})).toBe(1);
  });

  it("allows the same basket to be ordered again with a fresh key", async () => {
    const first = await createOrder(makeRequest());
    const second = await createOrder(makeRequest());

    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect(second.order.reference).not.toBe(first.order.reference);
    expect(await OrderModel.countDocuments({})).toBe(2);
  });

  it("replays by intent even when the catalogue price moved in between", async () => {
    const keys = { idempotencyKey: key(), confirmationKey: key() };
    const first = await createOrder(makeRequest(keys));
    expect(first.ok).toBe(true);
    if (!first.ok) return;

    // The owner raises the price, so a re-quote would now total differently.
    await ProductModel.updateOne({ slug: "jollof-test" }, { $set: { priceCents: 1_350 } });
    const repriced = makeRequest({
      ...keys,
      expectedTotalCents: expectedTotal(1_350 * 3, "delivery"),
    });

    const replayed = await createOrder(repriced);
    expect(replayed.ok).toBe(true);
    if (!replayed.ok) return;
    expect(replayed.replayed).toBe(true);
    expect(replayed.order.reference).toBe(first.order.reference);

    // The ORIGINAL agreement is what the replay returns: a replay can never
    // quietly restate an order at a new price.
    const order = await OrderModel.findOne({ reference: first.order.reference }).lean();
    expect(order!.money.totalCents).toBe(4_938);
    expect(await OrderModel.countDocuments({})).toBe(1);
  });

  it("keeps the same key usable after a price-change rejection", async () => {
    const keys = { idempotencyKey: key(), confirmationKey: key() };
    const stale = makeRequest({ ...keys, expectedTotalCents: 1 });

    const rejected = await createOrder(stale);
    expect(rejected).toMatchObject({ ok: false, reason: "price_changed" });

    const accepted = await makeRequest(keys);
    expect(accepted.expectedTotalCents).toBe(4_938);
    const response = await createOrder(accepted);
    expect(response.ok).toBe(true);
    if (!response.ok) return;
    expect(response.replayed).toBe(false);
    expect(await OrderModel.countDocuments({})).toBe(1);
  });

  it("enforces reference and idempotency key with unique database indexes", async () => {
    const indexes = await OrderModel.collection.indexes();
    expect(indexes.find((index) => index.name === "idempotencyKey_1")?.unique).toBe(true);
    expect(indexes.find((index) => index.name === "reference_1")?.unique).toBe(true);

    const response = await createOrder(makeRequest());
    expect(response.ok).toBe(true);
    if (!response.ok) return;

    const stored = (await OrderModel.findOne({}).lean()) as Record<string, unknown> | null;
    expect(stored).not.toBeNull();
    const { _id, createdAt, updatedAt, ...rest } = stored!;
    void _id;
    void createdAt;
    void updatedAt;

    // Same idempotency key, different reference: the idempotency index wins.
    await expect(OrderModel.create({ ...rest, reference: reference() })).rejects.toThrow(/duplicate key/i);
    // Same reference, different idempotency key: the reference index wins.
    await expect(OrderModel.create({ ...rest, idempotencyKey: key() })).rejects.toThrow(/duplicate key/i);
    expect(await OrderModel.countDocuments({})).toBe(1);
  });
});
