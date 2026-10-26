// @vitest-environment node
import { randomBytes } from "node:crypto";
import mongoose from "mongoose";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { MongoMemoryServer } from "mongodb-memory-server";
import { connectDatabase } from "@/lib/db/mongoose";
import { OrderModel, type OrderRecord } from "@/models/order";
import { adminOrderQuerySchema } from "@/lib/validations/admin";
import type { FulfillmentMethod } from "@/lib/validations/checkout";
import type { OrderStatus, PaymentStatus } from "@/lib/validations/order";
import { getAdminOrder, getDashboardStats, listAdminOrders } from "./admin";

/**
 * Admin order query tests (Phase 5, Milestone D) against a REAL MongoDB.
 *
 * These cover the read side of order management: server-side search,
 * status/payment filtering, true counts for pagination, the detail
 * projection, and the dashboard aggregates — in particular that collected
 * revenue never includes an unpaid Cash on Arrival order.
 */

let mongod: MongoMemoryServer | null = null;

function randomReference(): string {
  return `PS-${randomBytes(5).toString("hex").toUpperCase()}`;
}

interface SeedOptions {
  reference?: string;
  status?: OrderStatus;
  paymentStatus?: PaymentStatus;
  totalCents?: number;
  method?: FulfillmentMethod;
  name?: string;
  email?: string;
}

async function seedOrder(options: SeedOptions = {}): Promise<OrderRecord> {
  const method = options.method ?? "delivery";
  const total = options.totalCents ?? 4_938;
  // Keep the stored money consistent with the schema's sum validator:
  // subtotal + delivery fee + tax must equal the total exactly.
  const subtotal = method === "delivery" ? total - 700 : total;
  return OrderModel.create({
    reference: options.reference ?? randomReference(),
    idempotencyKey: randomBytes(32).toString("hex"),
    idempotencyHash: randomBytes(32).toString("hex"),
    confirmationKeyHash: randomBytes(32).toString("hex"),
    customer: {
      fullName: options.name ?? "Ada Obi",
      email: options.email ?? "ada.obi@example.com",
      phone: "+14165550123",
    },
    fulfillment:
      method === "pickup"
        ? {
            method,
            address: null,
            instructions: null,
            notes: null,
            serviceAreaLabel: null,
            pickupInstructions: "Synthetic test counter opens at noon.",
          }
        : {
            method,
            address: { line1: "1 Test Way", line2: null, city: "Toronto", province: "ON", postalCode: "M5H 2N2" },
            instructions: null,
            notes: null,
            serviceAreaLabel: "Test metro",
            pickupInstructions: null,
          },
    items: [
      {
        productId: "prod_synthetic",
        slug: "jollof-test",
        name: "Synthetic Jollof",
        variantName: null,
        quantity: 3,
        unitPriceCents: subtotal,
        lineTotalCents: subtotal,
        image: null,
      },
    ],
    // Money must satisfy the sum validator: subtotal + fee + tax = total.
    money: {
      currency: "CAD",
      subtotalCents: subtotal,
      deliveryFeeCents: method === "delivery" ? 700 : 0,
      taxCents: method === "delivery" ? 0 : 0,
      totalCents: total,
      taxLabel: null,
      taxRateBps: null,
    },
    payment: {
      method: "cash_on_arrival",
      status: options.paymentStatus ?? "unpaid",
      paidAt: options.paymentStatus === "paid" ? new Date() : null,
      paidByAdminId: options.paymentStatus === "paid" ? "64b0f00000000000000000aa" : null,
      paidByLabel: options.paymentStatus === "paid" ? "owner@pearl-e2e.test" : null,
    },
    status: options.status ?? "placed",
    statusHistory: [{ from: null, to: "placed", at: new Date(), adminId: null, note: null }],
    cancellationReason: null,
    notes: [],
    version: 1,
  });
}

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  process.env.MONGODB_URI = mongod.getUri("pearl_admin_order_queries_test");
  await connectDatabase();
  await OrderModel.createIndexes();
});

afterAll(async () => {
  await OrderModel.deleteMany({});
  await mongoose.disconnect();
  await mongod?.stop();
  mongod = null;
});

beforeEach(async () => {
  await OrderModel.deleteMany({});
});

/* ── list + search + filters + pagination ───────────────────────────── */

describe("listAdminOrders", () => {
  it("returns rows newest first with the fields the list renders", async () => {
    const older = await seedOrder({ name: "Ada Obi" });
    const newer = await seedOrder({ name: "Chidi Eze", method: "pickup" });

    const list = await listAdminOrders(adminOrderQuerySchema.parse({}));
    expect(list).not.toBeNull();
    expect(list!.total).toBe(2);

    const references = list!.rows.map((row) => row.reference);
    expect(references).toContain(older.reference);
    expect(references).toContain(newer.reference);

    const row = list!.rows.find((entry) => entry.reference === newer.reference)!;
    expect(row).toMatchObject({
      customerName: "Chidi Eze",
      customerEmail: "ada.obi@example.com",
      method: "pickup",
      status: "placed",
      paymentStatus: "unpaid",
      totalCents: 4_938,
      itemCount: 1,
    });
    expect(Number.isNaN(Date.parse(row.placedAtIso))).toBe(false);
  });

  it("searches by reference, customer name and email", async () => {
    await seedOrder({ reference: "PS-AAAAAAAAAA", name: "Ada Obi", email: "ada.obi@example.com" });
    await seedOrder({ reference: "PS-BBBBBBBBBB", name: "Chidi Eze", email: "chidi@example.com" });

    const byReference = await listAdminOrders(adminOrderQuerySchema.parse({ search: "ps-aaaa" }));
    expect(byReference!.rows.map((row) => row.reference)).toEqual(["PS-AAAAAAAAAA"]);

    const byName = await listAdminOrders(adminOrderQuerySchema.parse({ search: "chidi" }));
    expect(byName!.rows.map((row) => row.reference)).toEqual(["PS-BBBBBBBBBB"]);

    const byEmail = await listAdminOrders(adminOrderQuerySchema.parse({ search: "ada.obi@" }));
    expect(byEmail!.rows.map((row) => row.reference)).toEqual(["PS-AAAAAAAAAA"]);
  });

  it("treats regular-expression metacharacters as literal text", async () => {
    await seedOrder({ reference: "PS-AAAAAAAAAA" });

    // "(" is a broken expression on its own: it must not throw, and it
    // must not degenerate into "match everything".
    const result = await listAdminOrders(adminOrderQuerySchema.parse({ search: "(" }));
    expect(result).not.toBeNull();
    expect(result!.rows).toHaveLength(0);
    expect(result!.total).toBe(0);

    const wildcard = await listAdminOrders(adminOrderQuerySchema.parse({ search: ".*" }));
    expect(wildcard!.total).toBe(0);
  });

  it("filters by lifecycle status and by payment state, server-side", async () => {
    await seedOrder({ status: "placed" });
    await seedOrder({ status: "preparing" });
    await seedOrder({ status: "completed", paymentStatus: "paid" });

    const preparing = await listAdminOrders(adminOrderQuerySchema.parse({ status: "preparing" }));
    expect(preparing!.total).toBe(1);
    expect(preparing!.rows[0].status).toBe("preparing");

    const unpaid = await listAdminOrders(adminOrderQuerySchema.parse({ payment: "unpaid" }));
    expect(unpaid!.total).toBe(2);

    const paidAndDone = await listAdminOrders(
      adminOrderQuerySchema.parse({ status: "completed", payment: "paid" }),
    );
    expect(paidAndDone!.total).toBe(1);
  });

  it("combines search with filters and reports true counts", async () => {
    await seedOrder({ name: "Ada Obi", email: "ada@example.com", status: "placed" });
    await seedOrder({ name: "Ada Obi", email: "ada@example.com", status: "confirmed" });
    await seedOrder({ name: "Chidi Eze", email: "chidi@example.com", status: "placed" });

    const result = await listAdminOrders(
      adminOrderQuerySchema.parse({ search: "ada", status: "placed" }),
    );
    expect(result!.total).toBe(1);
    expect(result!.rows[0].customerName).toBe("Ada Obi");
  });

  it("paginates over the filtered set with true page counts", async () => {
    for (let index = 0; index < 25; index += 1) {
      await seedOrder({ status: index % 2 === 0 ? "placed" : "confirmed" });
    }

    const firstPage = await listAdminOrders(adminOrderQuerySchema.parse({}));
    expect(firstPage!.total).toBe(25);
    expect(firstPage!.rows).toHaveLength(20);
    expect(firstPage!.totalPages).toBe(2);
    expect(firstPage!.page).toBe(1);

    const secondPage = await listAdminOrders(adminOrderQuerySchema.parse({ page: "2" }));
    expect(secondPage!.rows).toHaveLength(5);
    expect(secondPage!.page).toBe(2);

    // Filtering halves the set: 13 placed (pages of 20 → one page).
    const placed = await listAdminOrders(adminOrderQuerySchema.parse({ status: "placed" }));
    expect(placed!.total).toBe(13);
    expect(placed!.totalPages).toBe(1);
    expect(placed!.rows).toHaveLength(13);
  });

  it("returns an empty page rather than an error when nothing matches", async () => {
    const result = await listAdminOrders(adminOrderQuerySchema.parse({ search: "PS-0000000000" }));
    expect(result).toEqual({
      rows: [],
      total: 0,
      page: 1,
      pageSize: 20,
      totalPages: 1,
    });
  });

  it("clamps an out-of-range page instead of failing", async () => {
    await seedOrder();
    // `99999` exceeds the schema bound, so it falls back to page 1 — the
    // list stays usable rather than erroring.
    const result = await listAdminOrders(adminOrderQuerySchema.parse({ page: "99999" }));
    expect(result).not.toBeNull();
    expect(result!.page).toBe(1);
    expect(result!.rows).toHaveLength(1);
    expect(result!.total).toBe(1);
  });
});

/* ── detail projection ──────────────────────────────────────────────── */

describe("getAdminOrder", () => {
  it("returns everything the detail screen renders, for a delivery order", async () => {
    const order = await seedOrder({ reference: "PS-CCCCCCCCCC", totalCents: 4_938, paymentStatus: "paid" });
    await OrderModel.updateOne(
      { _id: order._id },
      { $push: { statusHistory: { from: "placed", to: "confirmed", at: new Date(), adminId: "64b0f00000000000000000aa", note: "Called the customer" } } },
    );

    const detail = await getAdminOrder("PS-CCCCCCCCCC");
    expect(detail).not.toBeNull();
    expect(detail).toMatchObject({
      reference: "PS-CCCCCCCCCC",
      customerName: "Ada Obi",
      method: "delivery",
      status: "placed",
      paymentStatus: "paid",
      totalCents: 4_938,
      version: 1,
      cancellationReason: null,
    });
    expect(detail!.address).toMatchObject({ city: "Toronto", province: "ON", postalCode: "M5H 2N2" });
    expect(detail!.serviceAreaLabel).toBe("Test metro");
    expect(detail!.items).toHaveLength(1);
    expect(detail!.money).toMatchObject({ currency: "CAD", totalCents: 4_938 });
    expect(detail!.statusHistory).toHaveLength(2);
    expect(detail!.statusHistory[1].note).toBe("Called the customer");
    expect(detail!.payment.paidAtIso).not.toBeNull();
    expect(detail!.payment.paidByLabel).toBe("owner@pearl-e2e.test");
  });

  it("normalises a lower-case reference before matching", async () => {
    await seedOrder({ reference: "PS-DDDDDDDDDD" });
    const detail = await getAdminOrder("  ps-dddddddddd ");
    expect(detail?.reference).toBe("PS-DDDDDDDDDD");
  });

  it("returns null for a malformed reference without querying", async () => {
    for (const reference of ["not a reference", "PS-short", "'; DROP TABLE orders;--", ""]) {
      expect(await getAdminOrder(reference)).toBeNull();
    }
  });

  it("returns null for a well-formed but unknown reference", async () => {
    expect(await getAdminOrder("PS-EEEEEEEEEE")).toBeNull();
  });

  it("returns null for a pickup order's non-existent address", async () => {
    await seedOrder({ reference: "PS-FFFFFFFF00", method: "pickup" });
    const detail = await getAdminOrder("PS-FFFFFFFF00");
    expect(detail!.address).toBeNull();
    expect(detail!.pickupInstructions).toContain("Synthetic test counter");
    expect(detail!.serviceAreaLabel).toBeNull();
  });
});

/* ── dashboard aggregates ───────────────────────────────────────────── */

describe("getDashboardStats order metrics", () => {
  it("counts unpaid Cash on Arrival as outstanding, never as collected", async () => {
    // Unpaid: 1000 + 2000 + 3000 cents outstanding, all in progress.
    await seedOrder({ status: "placed", paymentStatus: "unpaid", totalCents: 1_000 });
    await seedOrder({ status: "confirmed", paymentStatus: "unpaid", totalCents: 2_000 });
    await seedOrder({ status: "preparing", paymentStatus: "unpaid", totalCents: 3_000 });
    // Paid: one still in progress, one finished.
    await seedOrder({ status: "out_for_delivery", paymentStatus: "paid", totalCents: 5_000 });
    await seedOrder({ status: "completed", paymentStatus: "paid", totalCents: 4_000 });

    const stats = await getDashboardStats();
    expect(stats).not.toBeNull();
    expect(stats!.orders).toEqual({
      total: 5,
      inProgress: 4, // everything except the completed one
      awaitingPayment: 3,
      unpaidCents: 6_000,
      collectedCents: 9_000, // paid ONLY: the 6000 in unpaid orders is absent
    });
    expect(stats!.orders.unpaidCents + stats!.orders.collectedCents).toBe(15_000);
  });

  it("never lists a cancelled order as outstanding money", async () => {
    // One live unpaid order (1413) and one live paid order (3525)…
    await seedOrder({ status: "ready_for_pickup", paymentStatus: "unpaid", totalCents: 1_413 });
    await seedOrder({ status: "completed", paymentStatus: "paid", totalCents: 3_525 });
    // …plus a cancelled order nobody will ever pay, and one that was paid
    // before it was cancelled (the money WAS received, so it stays).
    await seedOrder({ status: "cancelled", paymentStatus: "unpaid", totalCents: 7_000 });
    await seedOrder({ status: "cancelled", paymentStatus: "paid", totalCents: 900 });

    const stats = await getDashboardStats();
    expect(stats!.orders).toEqual({
      total: 4, // all four are still orders, all time
      inProgress: 1, // only the unpaid pickup order is still open
      awaitingPayment: 1, // the cancelled unpaid order is not awaiting anything
      unpaidCents: 1_413, // the 7000 cancelled total is NOT outstanding
      collectedCents: 4_425, // paid includes the paid-then-cancelled 900
    });
  });

  it("reports real zeros on an empty store instead of a placeholder", async () => {
    const stats = await getDashboardStats();
    expect(stats!.orders).toEqual({
      total: 0,
      inProgress: 0,
      awaitingPayment: 0,
      unpaidCents: 0,
      collectedCents: 0,
    });
    expect(stats!.recentOrders).toHaveLength(0);
  });

  it("lists the five most recent orders, newest first", async () => {
    const references: string[] = [];
    for (let index = 0; index < 6; index += 1) {
      const order = await seedOrder({ name: `Customer ${index}` });
      references.push(order.reference);
    }

    const stats = await getDashboardStats();
    expect(stats!.recentOrders).toHaveLength(5);
    // The sixth (newest) order leads; the very first one has dropped off.
    expect(stats!.recentOrders[0].reference).toBe(references[5]);
    expect(stats!.recentOrders.map((order) => order.reference)).not.toContain(references[0]);
    expect(stats!.recentOrders[0].customerName).toBe("Customer 5");
  });
});
