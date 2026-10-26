// @vitest-environment node
import { randomBytes } from "node:crypto";
import mongoose from "mongoose";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { MongoMemoryServer } from "mongodb-memory-server";
import { connectDatabase } from "@/lib/db/mongoose";
import { OrderModel, type OrderRecord } from "@/models/order";
import type { FulfillmentMethod } from "@/lib/validations/checkout";
import type { OrderStatus } from "@/lib/validations/order";

vi.mock("@/lib/auth/guard", () => ({
  requireActionAdmin: vi.fn(async () => ({ ok: true, admin: OWNER })),
  requirePageAdmin: vi.fn(),
}));

vi.mock("@/lib/auth/audit", () => ({
  recordAudit: vi.fn(async () => undefined),
}));

import { requireActionAdmin } from "@/lib/auth/guard";
import { recordAudit } from "@/lib/auth/audit";
import {
  addOrderNoteAction,
  changeOrderStatusAction,
  recordPaymentAction,
} from "./admin-orders";

/**
 * Admin order Server Action matrix (Phase 5, Milestones C/D) against a
 * REAL MongoDB, because the properties under test — the optimistic
 * concurrency filter, the subdocument payment update, the bounded note
 * list — only exist at the database level.
 *
 * Everything seeded here is explicitly synthetic: a "Test metro" delivery
 * snapshot, products named "Synthetic …", money that sums exactly
 * (3750 + 700 + 488 = 4938 cents).
 *
 * Covered, in order: independent authorization on every action, legal and
 * illegal lifecycle transitions (including the method-aware rules),
 * cancellation with reason, version conflicts, Cash on Arrival payment
 * recording (once only, never client-supplied), and operational notes.
 */

const OWNER = { _id: "64b0f00000000000000000aa", email: "owner@pearl-e2e.test", role: "owner", status: "active" };

let mongod: MongoMemoryServer | null = null;

function randomReference(): string {
  return `PS-${randomBytes(5).toString("hex").toUpperCase()}`;
}

function fulfillmentFor(method: FulfillmentMethod) {
  if (method === "pickup") {
    return {
      method,
      address: null,
      instructions: null,
      notes: null,
      serviceAreaLabel: null,
      pickupInstructions: "Synthetic test counter opens at noon.",
    };
  }
  return {
    method,
    address: { line1: "1 Test Way", line2: null, city: "Toronto", province: "ON", postalCode: "M5H 2N2" },
    instructions: null,
    notes: null,
    serviceAreaLabel: "Test metro",
    pickupInstructions: null,
  };
}

function orderPayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    reference: randomReference(),
    idempotencyKey: randomBytes(32).toString("hex"),
    idempotencyHash: randomBytes(32).toString("hex"),
    confirmationKeyHash: randomBytes(32).toString("hex"),
    customer: { fullName: "Ada Obi", email: "ada.obi@example.com", phone: "+14165550123" },
    fulfillment: fulfillmentFor("delivery"),
    items: [
      {
        productId: "prod_synthetic",
        slug: "jollof-test",
        name: "Synthetic Jollof",
        variantName: null,
        quantity: 3,
        unitPriceCents: 1250,
        lineTotalCents: 3750,
        image: null,
      },
    ],
    money: {
      currency: "CAD",
      subtotalCents: 3750,
      deliveryFeeCents: 700,
      taxCents: 488,
      totalCents: 4938,
      taxLabel: "Test HST",
      taxRateBps: 1300,
    },
    payment: { method: "cash_on_arrival", status: "unpaid", paidAt: null, paidByAdminId: null, paidByLabel: null },
    status: "placed",
    statusHistory: [{ from: null, to: "placed", at: new Date(), adminId: null, note: null }],
    cancellationReason: null,
    notes: [],
    version: 1,
    ...overrides,
  };
}

async function makeOrder(overrides: Record<string, unknown> = {}): Promise<OrderRecord> {
  return OrderModel.create(orderPayload(overrides));
}

/* ── form builders ──────────────────────────────────────────────────── */

function statusForm(
  reference: string,
  to: string,
  expectedVersion: string | number,
  reason?: string,
): FormData {
  const formData = new FormData();
  formData.set("reference", reference);
  formData.set("to", to);
  formData.set("expectedVersion", String(expectedVersion));
  if (reason !== undefined) formData.set("reason", reason);
  return formData;
}

function paymentForm(reference: string, expectedVersion: string | number): FormData {
  const formData = new FormData();
  formData.set("reference", reference);
  formData.set("expectedVersion", String(expectedVersion));
  return formData;
}

function noteForm(reference: string, body: string): FormData {
  const formData = new FormData();
  formData.set("reference", reference);
  formData.set("body", body);
  return formData;
}

async function freshOrder(reference: string): Promise<OrderRecord> {
  const order = await OrderModel.findOne({ reference }).lean();
  expect(order).not.toBeNull();
  return order as OrderRecord;
}

/* ── lifecycle ──────────────────────────────────────────────────────── */

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  process.env.MONGODB_URI = mongod.getUri("pearl_admin_orders_test");
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
  vi.clearAllMocks();
  vi.mocked(requireActionAdmin).mockResolvedValue({ ok: true, admin: OWNER } as never);
});

/* ── authorization ──────────────────────────────────────────────────── */

describe("authorization (every action, independently)", () => {
  it("rejects status change, payment and note without a valid session, writing nothing", async () => {
    vi.mocked(requireActionAdmin).mockResolvedValue({ ok: false, reason: "unauthorized" } as never);
    const order = await makeOrder();

    const status = await changeOrderStatusAction({ ok: false }, statusForm(order.reference, "confirmed", 1));
    expect(status).toEqual({ ok: false, error: "Your session has expired. Please sign in again." });

    const payment = await recordPaymentAction({ ok: false }, paymentForm(order.reference, 1));
    expect(payment).toEqual({ ok: false, error: "Your session has expired. Please sign in again." });

    const note = await addOrderNoteAction({ ok: false }, noteForm(order.reference, "sneaky note"));
    expect(note).toEqual({ ok: false, error: "Your session has expired. Please sign in again." });

    const stored = await freshOrder(order.reference);
    expect(stored.status).toBe("placed");
    expect(stored.payment.status).toBe("unpaid");
    expect(stored.notes).toHaveLength(0);
    expect(stored.version).toBe(1);
    expect(recordAudit).not.toHaveBeenCalled();
  });
});

/* ── lifecycle transitions ──────────────────────────────────────────── */

describe("changeOrderStatusAction: legal moves", () => {
  it("confirms a placed order and appends the event to the history", async () => {
    const order = await makeOrder();

    const result = await changeOrderStatusAction(
      { ok: false },
      statusForm(order.reference, "confirmed", 1),
    );

    expect(result).toMatchObject({ ok: true, status: "confirmed", version: 2 });
    const stored = await freshOrder(order.reference);
    expect(stored.status).toBe("confirmed");
    expect(stored.version).toBe(2);
    expect(stored.statusHistory).toHaveLength(2);
    expect(stored.statusHistory[1]).toMatchObject({ from: "placed", to: "confirmed", adminId: OWNER._id });
    expect(recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({ event: "order.status_changed", outcome: "success" }),
    );
  });

  it("walks a delivery order all the way to completed, bumping the version each step", async () => {
    const order = await makeOrder();
    let version = order.version;

    for (const to of ["confirmed", "preparing", "out_for_delivery", "completed"] as OrderStatus[]) {
      const result = await changeOrderStatusAction({ ok: false }, statusForm(order.reference, to, version));
      expect(result.ok).toBe(true);
      version = result.version!;
    }

    const stored = await freshOrder(order.reference);
    expect(stored.status).toBe("completed");
    expect(stored.version).toBe(5);
    expect(stored.statusHistory.map((event) => event.to)).toEqual([
      "placed",
      "confirmed",
      "preparing",
      "out_for_delivery",
      "completed",
    ]);
    // Completing fulfilment never touches payment.
    expect(stored.payment.status).toBe("unpaid");
  });

  it("walks a pickup order to completed via ready_for_pickup", async () => {
    const order = await makeOrder({ fulfillment: fulfillmentFor("pickup") });
    let version = order.version;

    for (const to of ["confirmed", "preparing", "ready_for_pickup", "completed"] as OrderStatus[]) {
      const result = await changeOrderStatusAction({ ok: false }, statusForm(order.reference, to, version));
      expect(result.ok).toBe(true);
      version = result.version!;
    }

    const stored = await freshOrder(order.reference);
    expect(stored.status).toBe("completed");
    expect(stored.statusHistory.map((event) => event.to)).toEqual([
      "placed",
      "confirmed",
      "preparing",
      "ready_for_pickup",
      "completed",
    ]);
  });

  it("records the reason on the history event when cancelling", async () => {
    const order = await makeOrder();

    const result = await changeOrderStatusAction(
      { ok: false },
      statusForm(order.reference, "cancelled", 1, "Customer called to postpone"),
    );

    expect(result.ok).toBe(true);
    const stored = await freshOrder(order.reference);
    expect(stored.status).toBe("cancelled");
    expect(stored.cancellationReason).toBe("Customer called to postpone");
    expect(stored.statusHistory[1]).toMatchObject({
      to: "cancelled",
      note: "Customer called to postpone",
    });
    // Cancelling an unpaid Cash on Arrival order records no payment.
    expect(stored.payment.status).toBe("unpaid");
  });
});

describe("changeOrderStatusAction: illegal moves", () => {
  it("refuses to skip a step", async () => {
    const order = await makeOrder();

    const result = await changeOrderStatusAction({ ok: false }, statusForm(order.reference, "preparing", 1));

    expect(result).toEqual({
      ok: false,
      error: "An order cannot go from Placed to Preparing.",
    });
    const stored = await freshOrder(order.reference);
    expect(stored.status).toBe("placed");
    expect(stored.version).toBe(1);
    expect(stored.statusHistory).toHaveLength(1);
    expect(recordAudit).not.toHaveBeenCalled();
  });

  it("refuses ready_for_pickup for a delivery order", async () => {
    const order = await makeOrder({ status: "preparing" });

    const result = await changeOrderStatusAction({ ok: false }, statusForm(order.reference, "ready_for_pickup", 1));

    expect(result).toEqual({
      ok: false,
      error: "Only pickup orders can be marked ready for pickup.",
    });
    expect((await freshOrder(order.reference)).status).toBe("preparing");
  });

  it("refuses out_for_delivery for a pickup order", async () => {
    const order = await makeOrder({ status: "preparing", fulfillment: fulfillmentFor("pickup") });

    const result = await changeOrderStatusAction({ ok: false }, statusForm(order.reference, "out_for_delivery", 1));

    expect(result).toEqual({
      ok: false,
      error: "Only delivery orders can be marked out for delivery.",
    });
    expect((await freshOrder(order.reference)).status).toBe("preparing");
  });

  it("refuses to reopen a completed order", async () => {
    const order = await makeOrder({ status: "completed" });

    const result = await changeOrderStatusAction({ ok: false }, statusForm(order.reference, "confirmed", 1));

    expect(result).toEqual({
      ok: false,
      error: "This order is already completed. Its status cannot change again.",
    });
    expect((await freshOrder(order.reference)).status).toBe("completed");
  });

  it("treats a no-op status as already in that state", async () => {
    const order = await makeOrder({ status: "confirmed", version: 2 });

    const result = await changeOrderStatusAction({ ok: false }, statusForm(order.reference, "confirmed", 2));

    expect(result).toEqual({ ok: false, error: "The order is already in that state." });
  });

  it("refuses to cancel an order that is out for delivery", async () => {
    const order = await makeOrder({ status: "out_for_delivery" });

    const result = await changeOrderStatusAction(
      { ok: false },
      statusForm(order.reference, "cancelled", 1, "Too late"),
    );

    expect(result).toEqual({
      ok: false,
      error: "An order cannot go from Out for delivery to Cancelled.",
    });
    expect((await freshOrder(order.reference)).status).toBe("out_for_delivery");
  });

  it("requires a reason before cancelling", async () => {
    const order = await makeOrder();

    const result = await changeOrderStatusAction({ ok: false }, statusForm(order.reference, "cancelled", 1));

    expect(result.ok).toBe(false);
    expect(result.fieldErrors).toEqual({ reason: "Add a reason for cancelling this order" });
    const stored = await freshOrder(order.reference);
    expect(stored.status).toBe("placed");
    expect(stored.cancellationReason).toBeNull();
  });

  it("bounds the cancellation reason", async () => {
    const order = await makeOrder();

    const result = await changeOrderStatusAction(
      { ok: false },
      statusForm(order.reference, "cancelled", 1, "x".repeat(301)),
    );

    expect(result.ok).toBe(false);
    expect(result.fieldErrors?.reason).toBe("The reason must be at most 300 characters");
    expect((await freshOrder(order.reference)).status).toBe("placed");
  });

  it("rejects an unknown target status from the allowlist", async () => {
    const order = await makeOrder();

    const result = await changeOrderStatusAction({ ok: false }, statusForm(order.reference, "refunded", 1));

    expect(result.ok).toBe(false);
    expect(result.fieldErrors?.to).toBe("Unknown order status");
  });
});

describe("changeOrderStatusAction: concurrency and identity", () => {
  it("detects a stale version as a conflict", async () => {
    const order = await makeOrder();

    const first = await changeOrderStatusAction({ ok: false }, statusForm(order.reference, "confirmed", 1));
    expect(first.ok).toBe(true);

    const second = await changeOrderStatusAction({ ok: false }, statusForm(order.reference, "preparing", 1));

    expect(second).toMatchObject({ ok: false, conflict: true });
    expect(second.error).toContain("changed while you were viewing it");
    // The loser's write did not land: no silent overwrite.
    const stored = await freshOrder(order.reference);
    expect(stored.status).toBe("confirmed");
    expect(stored.version).toBe(2);
    expect(stored.statusHistory).toHaveLength(2);
  });

  it("rejects a malformed reference before any query", async () => {
    const order = await makeOrder();

    const result = await changeOrderStatusAction({ ok: false }, statusForm("not a reference", "confirmed", 1));

    expect(result.ok).toBe(false);
    expect(result.fieldErrors?.reference).toBe("Not a valid order reference");
    expect(recordAudit).not.toHaveBeenCalled();
    expect((await freshOrder(order.reference)).status).toBe("placed");
  });

  it("returns a neutral not-found for a well-formed but unknown reference", async () => {
    const result = await changeOrderStatusAction({ ok: false }, statusForm(randomReference(), "confirmed", 1));

    expect(result).toEqual({
      ok: false,
      error: "That order could not be found. Reload the page and try again.",
    });
  });

  it("rejects a non-numeric version token", async () => {
    const order = await makeOrder();

    const result = await changeOrderStatusAction({ ok: false }, statusForm(order.reference, "confirmed", "abc"));

    expect(result.ok).toBe(false);
    expect(result.fieldErrors?.expectedVersion).toBe("Reload the order to get a current version");
    expect((await freshOrder(order.reference)).version).toBe(1);
  });
});

/* ── Cash on Arrival payment ────────────────────────────────────────── */

describe("recordPaymentAction (Cash on Arrival)", () => {
  it("records the payment against the stored total, with the acting admin", async () => {
    const order = await makeOrder();

    const result = await recordPaymentAction({ ok: false }, paymentForm(order.reference, 1));

    expect(result).toMatchObject({ ok: true, paymentStatus: "paid", version: 2 });
    const stored = await freshOrder(order.reference);
    expect(stored.payment).toMatchObject({
      method: "cash_on_arrival",
      status: "paid",
      paidByAdminId: OWNER._id,
      paidByLabel: OWNER.email,
    });
    expect(stored.payment.paidAt).toBeInstanceOf(Date);
    // Payment is a separate axis: recording it changes no lifecycle state.
    expect(stored.status).toBe("placed");
    expect(stored.statusHistory).toHaveLength(1);
    expect(recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        event: "order.payment_recorded",
        detail: expect.stringContaining("4938 cents"),
      }),
    );
  });

  it("refuses to record the same payment twice", async () => {
    const order = await makeOrder();
    const first = await recordPaymentAction({ ok: false }, paymentForm(order.reference, 1));
    expect(first.ok).toBe(true);

    // The second operator holds the pre-payment version AND a fresh one:
    // both paths must refuse.
    const stale = await recordPaymentAction({ ok: false }, paymentForm(order.reference, 1));
    expect(stale).toMatchObject({ ok: false, conflict: true });

    const fresh = await recordPaymentAction({ ok: false }, paymentForm(order.reference, 2));
    expect(fresh).toMatchObject({ ok: false, conflict: true });
    expect(fresh.error).toBe("Payment has already been recorded for this order.");

    const stored = await freshOrder(order.reference);
    expect(stored.payment.status).toBe("paid");
    expect(stored.version).toBe(2);
    expect(recordAudit).toHaveBeenCalledTimes(1);
  });

  it("accepts no payment amount from the client", async () => {
    const order = await makeOrder();
    const formData = paymentForm(order.reference, 1);
    formData.set("amountCents", "1");
    formData.set("status", "paid");
    formData.set("paidAt", "2020-01-01T00:00:00Z");

    const result = await recordPaymentAction({ ok: false }, formData);
    expect(result.ok).toBe(true);

    const stored = await freshOrder(order.reference);
    // The stored total is untouched: the form carries no money at all.
    expect(stored.money.totalCents).toBe(4938);
    expect(stored.payment.paidAt!.getFullYear()).not.toBe(2020);
  });

  it("rejects an unknown order", async () => {
    const result = await recordPaymentAction({ ok: false }, paymentForm(randomReference(), 1));
    expect(result).toEqual({
      ok: false,
      error: "That order could not be found. Reload the page and try again.",
    });
  });
});

/* ── operational notes ──────────────────────────────────────────────── */

describe("addOrderNoteAction", () => {
  it("appends a note without touching the version or the lifecycle", async () => {
    const order = await makeOrder();

    const result = await addOrderNoteAction({ ok: false }, noteForm(order.reference, "Customer asked for a later pickup"));

    expect(result).toMatchObject({ ok: true, version: 1 });
    const stored = await freshOrder(order.reference);
    expect(stored.notes).toHaveLength(1);
    expect(stored.notes[0]).toMatchObject({
      body: "Customer asked for a later pickup",
      adminId: OWNER._id,
    });
    expect(stored.version).toBe(1);
    expect(stored.status).toBe("placed");
    expect(recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({ event: "order.note_added", outcome: "success" }),
    );
  });

  it("rejects an empty or oversized note", async () => {
    const order = await makeOrder();

    const empty = await addOrderNoteAction({ ok: false }, noteForm(order.reference, "   "));
    expect(empty.ok).toBe(false);
    expect(empty.fieldErrors?.body).toBe("The note cannot be empty");

    const oversized = await addOrderNoteAction({ ok: false }, noteForm(order.reference, "x".repeat(501)));
    expect(oversized.ok).toBe(false);
    expect(oversized.fieldErrors?.body).toBe("The note must be at most 500 characters");

    expect((await freshOrder(order.reference)).notes).toHaveLength(0);
  });

  it("enforces the per-order note cap", async () => {
    const order = await makeOrder();
    await OrderModel.updateOne(
      { _id: order._id },
      {
        $set: {
          notes: Array.from({ length: 20 }, (_unused, index) => ({
            body: `note ${index}`,
            at: new Date(),
            adminId: OWNER._id,
          })),
        },
      },
    );

    const result = await addOrderNoteAction({ ok: false }, noteForm(order.reference, "one too many"));

    expect(result).toEqual({
      ok: false,
      error: "This order already has the maximum of 20 notes.",
    });
    expect((await freshOrder(order.reference)).notes).toHaveLength(20);
  });

  it("adds a note to a cancelled order", async () => {
    const order = await makeOrder({ status: "cancelled", cancellationReason: "Customer postponed" });

    const result = await addOrderNoteAction({ ok: false }, noteForm(order.reference, "Rebooked for next week"));

    expect(result.ok).toBe(true);
    expect((await freshOrder(order.reference)).notes).toHaveLength(1);
  });
});
