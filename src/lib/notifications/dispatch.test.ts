// @vitest-environment node
import mongoose from "mongoose";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { MongoMemoryServer } from "mongodb-memory-server";
import { connectDatabase } from "@/lib/db/mongoose";
import { AdminModel } from "@/models/admin";
import {
  MAX_NOTIFICATION_ATTEMPTS,
  NotificationOutboxModel,
  type NotificationOutboxRecord,
} from "@/models/notification-outbox";
import { OrderModel } from "@/models/order";
import type { FulfillmentMethod } from "@/lib/validations/checkout";
import type { OrderStatus } from "@/lib/validations/order";
import {
  NOTIFICATION_EVENT_ROLES,
  buildNotification,
  notificationKey,
} from "./templates";
import {
  NOT_CONFIGURED_REASON,
  NotificationDeliveryError,
  resolveNotificationProvider,
  type NotificationMessagePayload,
  type NotificationProvider,
} from "./provider";
import {
  NOTIFICATION_BATCH_LIMIT,
  NOT_CONFIGURED_RETRY_MS,
  attemptDueNotifications,
  enqueueOrderNotifications,
  nextAttemptDelayMs,
  notifyOrderEvent,
  retryNotificationById,
} from "./dispatch";

/**
 * Notification dispatch matrix (Phase 5, Milestone E) against a REAL
 * MongoDB, because the properties under test exist only at the database
 * level: the unique idempotency key, the `{status, nextAttemptAt}` scan,
 * the failure counters and the guarantee that no personal data is ever
 * written to the queue.
 *
 * Everything seeded here is synthetic ("Ada Obi", `PS-…` references, the
 * fixed test money 3750 + 700 + 488 = 4938 cents).
 *
 * The one environmental rule the whole file depends on: NO provider is
 * configured (`NOTIFICATION_PROVIDER` blank), which is the honest Phase 5
 * default. Tests that need delivery pass a fake provider explicitly.
 */

const REFERENCE = "PS-1A2B3C4D5E";
const CUSTOMER_EMAIL = "ada.obi@example.com";

let mongod: MongoMemoryServer | null = null;

/* ── helpers ────────────────────────────────────────────────────────── */

interface SeedOrderOptions {
  reference?: string;
  email?: string;
  status?: OrderStatus;
  method?: FulfillmentMethod;
}

async function seedOrder(options: SeedOrderOptions = {}): Promise<void> {
  const method = options.method ?? "delivery";
  const money =
    method === "delivery"
      ? { subtotalCents: 3750, deliveryFeeCents: 700, taxCents: 488, totalCents: 4938 }
      : { subtotalCents: 3750, deliveryFeeCents: 0, taxCents: 0, totalCents: 3750 };

  await OrderModel.create({
    reference: options.reference ?? REFERENCE,
    idempotencyKey: `${Math.random().toString(16).slice(2)}${Date.now()}`.padEnd(32, "0").slice(0, 64),
    idempotencyHash: "a".repeat(64),
    confirmationKeyHash: "b".repeat(64),
    customer: {
      fullName: "Ada Obi",
      email: options.email === undefined ? CUSTOMER_EMAIL : options.email,
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
            pickupInstructions: "Synthetic test counter.",
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
        unitPriceCents: 3750,
        lineTotalCents: 3750,
        image: null,
      },
    ],
    money: { currency: "CAD", taxLabel: "Test HST", taxRateBps: 1300, ...money },
    payment: { method: "cash_on_arrival", status: "unpaid" },
    status: options.status ?? "placed",
    statusHistory: [{ from: null, to: "placed", at: new Date(), adminId: null, note: null }],
    version: 1,
  });
}

async function seedEntry(
  overrides: Partial<SeedEntryFields> = {},
): Promise<NotificationOutboxRecord> {
  const now = Date.now();
  return NotificationOutboxModel.create({
    key: notificationKey("order.placed", REFERENCE, "customer"),
    event: "order.placed",
    reference: REFERENCE,
    transition: null,
    recipientRole: "customer",
    status: "pending",
    attempts: 0,
    ambiguousAttempts: 0,
    lastReason: null,
    nextAttemptAt: new Date(now - 1_000), // due by default
    lastAttemptAt: null,
    sentAt: null,
    leaseToken: null,
    leaseExpiresAt: null,
    providerId: null,
    providerStatus: null,
    providerStatusAt: null,
    ...overrides,
  });
}

interface SeedEntryFields {
  key: string;
  event: NotificationOutboxRecord["event"];
  reference: string;
  transition: OrderStatus | null;
  recipientRole: "customer" | "admin";
  status: "pending" | "processing" | "sent" | "failed" | "uncertain";
  attempts: number;
  ambiguousAttempts: number;
  lastReason: string | null;
  nextAttemptAt: Date;
  lastAttemptAt: Date | null;
  sentAt: Date | null;
  leaseToken: string | null;
  leaseExpiresAt: Date | null;
  providerId: string | null;
  providerStatus: NotificationOutboxRecord["providerStatus"];
  providerStatusAt: Date | null;
}

async function readEntry(key: string): Promise<NotificationOutboxRecord> {
  const entry = await NotificationOutboxModel.findOne({ key }).lean();
  expect(entry).not.toBeNull();
  return entry as NotificationOutboxRecord;
}

/** A configured provider that records every message it is handed. */
function fakeProvider(
  onSend?: (message: NotificationMessagePayload) => void,
): NotificationProvider & { sent: NotificationMessagePayload[] } {
  const sent: NotificationMessagePayload[] = [];
  return {
    id: "fake",
    configured: true,
    reason: null,
    sent,
    send: async (message) => {
      sent.push(message);
      onSend?.(message);
      return { providerMessageId: `fake_${sent.length}`, status: "accepted" };
    },
  };
}

beforeAll(async () => {
  delete process.env.NOTIFICATION_PROVIDER;
  mongod = await MongoMemoryServer.create();
  process.env.MONGODB_URI = mongod.getUri("pearl_notifications_test");
  await connectDatabase();
  await Promise.all([
    OrderModel.createIndexes(),
    AdminModel.createIndexes(),
    NotificationOutboxModel.createIndexes(),
  ]);
});

afterAll(async () => {
  await NotificationOutboxModel.deleteMany({});
  await OrderModel.deleteMany({});
  await AdminModel.deleteMany({});
  await mongoose.disconnect();
  await mongod?.stop();
  mongod = null;
});

beforeEach(async () => {
  delete process.env.NOTIFICATION_PROVIDER;
  await Promise.all([
    NotificationOutboxModel.deleteMany({}),
    OrderModel.deleteMany({}),
    AdminModel.deleteMany({}),
  ]);
});

/* ── templates ──────────────────────────────────────────────────────── */

describe("templates", () => {
  const richFacts = {
    reference: REFERENCE,
    status: "placed" as const,
    method: "delivery" as const,
    totalCents: 4938,
    customerName: "Ada Obi",
    paymentMethod: "cash_on_arrival" as const,
    paymentStatus: "unpaid" as const,
    items: [
      {
        name: "Synthetic Jollof",
        variantName: "Large",
        quantity: 3,
        unitPriceCents: 3750,
        lineTotalCents: 3750,
      },
    ],
    money: {
      currency: "CAD" as const,
      subtotalCents: 3750,
      deliveryFeeCents: 700,
      taxCents: 488,
      totalCents: 4938,
      taxLabel: "Test HST",
    },
    siteUrl: "https://pearl.example",
  };

  it("builds the customer order-placed message with factual copy and a text alternative", () => {
    const message = buildNotification("order.placed", "customer", richFacts);

    expect(message.subject).toBe(`Order ${REFERENCE} received`);
    expect(message.text).toContain(`Hello Ada Obi, we have received order ${REFERENCE}.`);
    expect(message.text).toContain("Total: $49.38 CAD");
    expect(message.text).toContain("Subtotal: $37.50 CAD");
    expect(message.text).toContain("Test HST: $4.88 CAD");
    expect(message.text).toContain("Payment: Cash on arrival");
    expect(message.text).toContain(`https://pearl.example/track?ref=${REFERENCE}`);
    expect(message.text).toContain("3 x Synthetic Jollof (Large)");
    expect(message.html).toContain("<!doctype html>");
    expect(message.html).toContain("Synthetic Jollof");
    expect(message.html).toContain("$49.38 CAD");
    expect(message.html).toContain("Cash on arrival");
    // No em dashes, no promised timeframes, no invented contact details.
    expect(message.text).not.toMatch(/[—–]/);
    expect(message.html).not.toMatch(/[—–]/);
    expect(message.text.toLowerCase()).not.toMatch(/as soon as|fastest|best/);
    // No capability token or provider secret can appear in a message.
    expect(message.text).not.toMatch(/[0-9a-f]{64}/);
    expect(message.html).not.toMatch(/[0-9a-f]{64}/);
  });

  it("builds the store-facing order-placed message with an authenticated admin link", () => {
    const message = buildNotification("order.placed", "admin", richFacts);

    expect(message.subject).toBe(`New order ${REFERENCE}`);
    expect(message.text).toContain("Order: PS-1A2B3C4D5E");
    expect(message.text).toContain("Customer: Ada Obi");
    expect(message.text).toContain("Total: $49.38 CAD");
    expect(message.text).toContain("Payment method: Cash on arrival");
    expect(message.html).toContain(`https://pearl.example/admin/orders/${REFERENCE}`);
    // The alert carries no customer contact details or address.
    expect(message.html).not.toContain("ada.obi@example.com");
    expect(message.html).not.toContain("1 Test Way");
    expect(message.html).not.toContain("+1416");
  });

  it("builds a pickup status message with the shared status label", () => {
    const message = buildNotification("order.ready_for_pickup", "customer", {
      ...richFacts,
      status: "ready_for_pickup",
      method: "pickup",
      paymentMethod: "cash_on_arrival",
      paymentStatus: "unpaid",
      pickupInstructions: "Collect at the labelled test counter.",
    });

    expect(message.subject).toBe(`Order ${REFERENCE} is ready for pickup`);
    expect(message.text).toContain("Status: Ready for pickup");
    expect(message.text).toContain("Total: $49.38 CAD");
    expect(message.text).toContain("Pickup: Collect at the labelled test counter.");
    expect(message.html).toContain("Ready for pickup");
  });

  it("never calls an unpaid Cash on Arrival order paid", () => {
    const message = buildNotification("order.placed", "customer", richFacts);
    expect(message.text).not.toMatch(/paid online|payment received/i);
    expect(message.html).not.toMatch(/paid online|payment received/i);
    expect(message.text).toContain("Payment of $49.38 CAD is due");
  });

  it("describes a cancelled online-paid order as refund-pending, not refunded", () => {
    const message = buildNotification("order.cancelled", "customer", {
      ...richFacts,
      status: "cancelled",
      paymentMethod: "stripe",
      paymentStatus: "paid",
    });
    expect(message.subject).toBe(`Order ${REFERENCE} cancelled`);
    expect(message.text).toContain("A refund has not been confirmed yet.");
    expect(message.text).not.toMatch(/refunded in full|money has been returned/i);
  });

  it("escapes dynamic text so a customer name cannot inject markup", () => {
    const message = buildNotification("order.placed", "customer", {
      ...richFacts,
      customerName: '<script>alert("x")</script>',
    });
    expect(message.html).toContain("&lt;script&gt;");
    expect(message.html).not.toContain("<script>alert");
  });

  it("keys entries per event, order and role, and only allows known event/role pairs", () => {
    expect(notificationKey("order.placed", REFERENCE, "customer")).toBe(
      `order.placed:${REFERENCE}:customer`,
    );
    expect(NOTIFICATION_EVENT_ROLES["order.placed"]).toEqual(["customer", "admin"]);
    expect(NOTIFICATION_EVENT_ROLES["order.status_changed"]).toEqual(["customer"]);
    expect(NOTIFICATION_EVENT_ROLES["order.preparing"]).toEqual(["customer"]);
    expect(NOTIFICATION_EVENT_ROLES["payment.collected"]).toEqual(["customer"]);
    expect(NOTIFICATION_EVENT_ROLES["payment.requires_attention"]).toEqual(["admin"]);
  });
});

describe("nextAttemptDelayMs", () => {
  it("follows 1m, 2m, 4m, 8m and caps at one hour", () => {
    expect(nextAttemptDelayMs(1)).toBe(60_000);
    expect(nextAttemptDelayMs(2)).toBe(120_000);
    expect(nextAttemptDelayMs(3)).toBe(240_000);
    expect(nextAttemptDelayMs(4)).toBe(480_000);
    expect(nextAttemptDelayMs(5)).toBe(960_000);
    expect(nextAttemptDelayMs(99)).toBe(60 * 60_000);
    expect(Number.isFinite(nextAttemptDelayMs(1_000_000))).toBe(true);
  });
});

/* ── enqueue (idempotent, PII-free) ─────────────────────────────────── */

describe("enqueueOrderNotifications", () => {
  it("enqueues a customer and an admin entry for order.placed", async () => {
    await seedOrder();
    await enqueueOrderNotifications("order.placed", REFERENCE);

    const entries = await NotificationOutboxModel.find().lean();
    expect(entries).toHaveLength(2);
    expect(entries.map((entry) => entry.key).sort()).toEqual(
      [
        notificationKey("order.placed", REFERENCE, "admin"),
        notificationKey("order.placed", REFERENCE, "customer"),
      ].sort(),
    );
    for (const entry of entries) {
      expect(entry.status).toBe("pending");
      expect(entry.attempts).toBe(0);
      expect(entry.lastReason).toBeNull();
      expect(entry.nextAttemptAt).toBeInstanceOf(Date);
    }
  });

  it("enqueues only the customer entry for a status change", async () => {
    await seedOrder();
    await enqueueOrderNotifications("order.status_changed", REFERENCE);

    const entries = await NotificationOutboxModel.find().lean();
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      event: "order.status_changed",
      recipientRole: "customer",
      status: "pending",
    });
  });

  it("is idempotent: replaying the same event never duplicates an entry", async () => {
    await seedOrder();
    await enqueueOrderNotifications("order.placed", REFERENCE);
    await enqueueOrderNotifications("order.placed", REFERENCE);
    await enqueueOrderNotifications("order.placed", REFERENCE);

    expect(await NotificationOutboxModel.countDocuments({})).toBe(2);
    const distinctKeys = await NotificationOutboxModel.distinct("key");
    expect(distinctKeys).toHaveLength(2);
  });

  it("stores no personal data in the queue at all", async () => {
    await seedOrder();
    await enqueueOrderNotifications("order.placed", REFERENCE);
    await enqueueOrderNotifications("order.status_changed", REFERENCE);

    const raw = JSON.stringify(await NotificationOutboxModel.find().lean());
    expect(raw).not.toContain(CUSTOMER_EMAIL);
    expect(raw).not.toContain("Ada");
    expect(raw).not.toContain("+1416");
    expect(raw).not.toContain("Test Way");
    expect(raw).not.toContain("b".repeat(64)); // confirmation capability hash
  });

  it("notifyOrderEvent enqueues before returning and never rejects", async () => {
    await seedOrder();
    await expect(notifyOrderEvent("order.placed", REFERENCE)).resolves.toBeUndefined();

    const entries = await NotificationOutboxModel.find().lean();
    expect(entries).toHaveLength(2);
    expect(entries.every((entry) => entry.status === "pending")).toBe(true);
    expect(entries.every((entry) => entry.attempts === 0)).toBe(true);
  });
});

/* ── not configured (the honest Phase 5 default) ────────────────────── */

describe("provider not configured", () => {
  it("resolves to a non-sending provider when the env var is blank", () => {
    const provider = resolveNotificationProvider();
    expect(provider.configured).toBe(false);
    expect(provider.id).toBe("not-configured");
    expect(resolveNotificationProvider("   ")).toBe(provider);
  });

  it("keeps due entries pending with zero attempts and a stated reason", async () => {
    await seedOrder();
    const entry = await seedEntry();

    const result = await attemptDueNotifications();

    expect(result).toMatchObject({ processed: 0, sent: 0, failed: 0, deferred: 1 });
    const stored = await readEntry(entry.key);
    expect(stored.status).toBe("pending");
    expect(stored.attempts).toBe(0); // an unconfigured store never burns retries
    expect(stored.lastReason).toBe(NOT_CONFIGURED_REASON);
    expect(stored.sentAt).toBeNull();
    // Pushed to the future so the next scan skips it quickly.
    expect(stored.nextAttemptAt.getTime()).toBeGreaterThanOrEqual(
      Date.now() + NOT_CONFIGURED_RETRY_MS - 5_000,
    );
  });

  it("leaves entries that are not yet due completely untouched", async () => {
    await seedOrder();
    const future = await seedEntry({
      key: notificationKey("order.placed", REFERENCE, "admin"),
      recipientRole: "admin",
      nextAttemptAt: new Date(Date.now() + 60 * 60_000),
    });

    await attemptDueNotifications();

    const stored = await readEntry(future.key);
    expect(stored.lastReason).toBeNull();
    expect(stored.nextAttemptAt.getTime()).toBe(future.nextAttemptAt.getTime());
  });
});

/* ── configured delivery ────────────────────────────────────────────── */

describe("delivery with a configured provider", () => {
  it("sends to the customer's address and marks the entry sent", async () => {
    await seedOrder();
    const entry = await seedEntry();
    const provider = fakeProvider();

    const result = await attemptDueNotifications(provider);

    expect(result).toMatchObject({ processed: 1, sent: 1, failed: 0, deferred: 0 });
    expect(provider.sent).toHaveLength(1);
    expect(provider.sent[0].to).toBe(CUSTOMER_EMAIL);
    expect(provider.sent[0].subject).toBe(`Order ${REFERENCE} received`);

    const stored = await readEntry(entry.key);
    expect(stored.status).toBe("sent");
    expect(stored.lastReason).toBeNull();
    expect(stored.sentAt).toBeInstanceOf(Date);
    expect(stored.attempts).toBe(0);
  });

  it("resolves the admin recipient from the active owner admin", async () => {
    await seedOrder();
    await AdminModel.create({
      email: "owner@pearl-e2e.test",
      passwordHash: "x".repeat(40),
      role: "owner",
      status: "active",
    });
    const entry = await seedEntry({
      key: notificationKey("order.placed", REFERENCE, "admin"),
      recipientRole: "admin",
    });
    const provider = fakeProvider();

    const result = await attemptDueNotifications(provider);

    expect(result.sent).toBe(1);
    expect(provider.sent[0].to).toBe("owner@pearl-e2e.test");
    expect(provider.sent[0].subject).toBe(`New order ${REFERENCE}`);
    expect((await readEntry(entry.key)).status).toBe("sent");
  });

  it("skips a disabled admin and fails the admin entry honestly", async () => {
    await seedOrder();
    await AdminModel.create({
      email: "disabled@pearl-e2e.test",
      passwordHash: "x".repeat(40),
      role: "owner",
      status: "disabled",
    });
    const entry = await seedEntry({
      key: notificationKey("order.placed", REFERENCE, "admin"),
      recipientRole: "admin",
    });

    const result = await attemptDueNotifications(fakeProvider());

    expect(result).toMatchObject({ processed: 1, sent: 0, failed: 1 });
    const stored = await readEntry(entry.key);
    expect(stored.status).toBe("failed");
    expect(stored.lastReason).toBe("No owner notification recipient is configured");
  });

  it(`processes at most ${NOTIFICATION_BATCH_LIMIT} entries per scan`, async () => {
    await seedOrder();
    await AdminModel.create({
      email: "owner@pearl-e2e.test",
      passwordHash: "x".repeat(40),
      role: "owner",
      status: "active",
    });
    for (let index = 0; index < NOTIFICATION_BATCH_LIMIT + 2; index += 1) {
      await seedEntry({
        key: notificationKey("order.placed", REFERENCE, "admin") + `:${index}`,
        recipientRole: "admin",
      });
    }
    const provider = fakeProvider();

    const result = await attemptDueNotifications(provider);

    expect(result.processed).toBe(NOTIFICATION_BATCH_LIMIT);
    expect(result.sent).toBe(NOTIFICATION_BATCH_LIMIT);
    expect(provider.sent).toHaveLength(NOTIFICATION_BATCH_LIMIT);
    expect(await NotificationOutboxModel.countDocuments({ status: "pending" })).toBe(2);
  });

  it("does not touch entries whose next attempt is still in the future", async () => {
    await seedOrder();
    await seedEntry({ nextAttemptAt: new Date(Date.now() + 60_000) });

    const result = await attemptDueNotifications(fakeProvider());

    expect(result).toMatchObject({ processed: 0, sent: 0, failed: 0, deferred: 0 });
    expect(await NotificationOutboxModel.countDocuments({ status: "pending" })).toBe(1);
  });
});

/* ── retries, backoff and terminal failures ─────────────────────────── */

describe("retryable failures", () => {
  it("counts a failure, sanitises the reason and schedules 1m later", async () => {
    await seedOrder();
    const entry = await seedEntry();
    const provider = fakeProvider(() => {
      throw new Error("boom with ada.obi@example.com inside");
    });

    const result = await attemptDueNotifications(provider);

    expect(result).toMatchObject({ processed: 1, deferred: 1, sent: 0, failed: 0 });
    const stored = await readEntry(entry.key);
    expect(stored.status).toBe("pending");
    expect(stored.attempts).toBe(1);
    // Fixed sentence: the raw provider error (which may embed the
    // recipient address) is never written anywhere.
    expect(stored.lastReason).toBe("The notification provider failed to send the message");
    expect(stored.lastReason).not.toContain("ada.obi");
    expect(stored.nextAttemptAt.getTime()).toBeGreaterThanOrEqual(Date.now() + 55_000);
    expect(stored.nextAttemptAt.getTime()).toBeLessThanOrEqual(Date.now() + 70_000);
  });

  it("backs off 2m on the second failure", async () => {
    await seedOrder();
    const entry = await seedEntry({ attempts: 1 });

    await attemptDueNotifications(
      fakeProvider(() => {
        throw new Error("still down");
      }),
    );

    const stored = await readEntry(entry.key);
    expect(stored.attempts).toBe(2);
    expect(stored.nextAttemptAt.getTime()).toBeGreaterThanOrEqual(Date.now() + 115_000);
    expect(stored.nextAttemptAt.getTime()).toBeLessThanOrEqual(Date.now() + 130_000);
  });

  it("treats an explicit retryable delivery error as a retry", async () => {
    await seedOrder();
    const entry = await seedEntry();

    await attemptDueNotifications(
      fakeProvider(() => {
        throw new NotificationDeliveryError("Provider timeout", { retryable: true });
      }),
    );

    const stored = await readEntry(entry.key);
    expect(stored.status).toBe("pending");
    expect(stored.attempts).toBe(1);
    expect(stored.lastReason).toBe("Provider timeout");
  });

  it(`fails permanently when attempts reach ${MAX_NOTIFICATION_ATTEMPTS}`, async () => {
    await seedOrder();
    const entry = await seedEntry({ attempts: MAX_NOTIFICATION_ATTEMPTS - 1 });

    const result = await attemptDueNotifications(
      fakeProvider(() => {
        throw new Error("down again");
      }),
    );

    expect(result).toMatchObject({ failed: 1, deferred: 0 });
    const stored = await readEntry(entry.key);
    expect(stored.status).toBe("failed");
    expect(stored.attempts).toBe(MAX_NOTIFICATION_ATTEMPTS);
    expect(stored.lastReason).toBe("The notification provider failed to send the message");
  });

  it("fails immediately on a non-retryable delivery error", async () => {
    await seedOrder();
    const entry = await seedEntry();

    const result = await attemptDueNotifications(
      fakeProvider(() => {
        throw new NotificationDeliveryError("Recipient address rejected");
      }),
    );

    expect(result).toMatchObject({ failed: 1, deferred: 0 });
    const stored = await readEntry(entry.key);
    expect(stored.status).toBe("failed");
    expect(stored.attempts).toBe(1);
    expect(stored.lastReason).toBe("Recipient address rejected");
  });

  it("fails honestly when the configured provider name is unsupported", async () => {
    await seedOrder();
    const entry = await seedEntry();
    const provider = resolveNotificationProvider("smtp-legacy");
    expect(provider.configured).toBe(true);

    const result = await attemptDueNotifications(provider);

    expect(result).toMatchObject({ failed: 1, sent: 0 });
    const stored = await readEntry(entry.key);
    expect(stored.status).toBe("failed");
    expect(stored.attempts).toBe(1);
    expect(stored.lastReason).toContain("smtp-legacy");
    expect(stored.lastReason).toContain("not supported in this build");
  });
});

/* ── recipient resolution failures ──────────────────────────────────── */

describe("missing recipients", () => {
  it("fails an entry whose order no longer exists", async () => {
    const entry = await seedEntry({ reference: "PS-0000000000" });

    const result = await attemptDueNotifications(fakeProvider());

    expect(result).toMatchObject({ failed: 1, sent: 0 });
    const stored = await readEntry(entry.key);
    expect(stored.status).toBe("failed");
    expect(stored.lastReason).toBe("The order for this notification no longer exists");
  });

  it("fails the customer entry when the order has no email address", async () => {
    await seedOrder();
    // Update validators do not run here, so the snapshot can hold an empty
    // address the way a future import might.
    await OrderModel.updateOne({ reference: REFERENCE }, { $set: { "customer.email": "" } });
    const entry = await seedEntry();

    const result = await attemptDueNotifications(fakeProvider());

    expect(result).toMatchObject({ failed: 1, sent: 0 });
    const stored = await readEntry(entry.key);
    expect(stored.status).toBe("failed");
    expect(stored.lastReason).toBe("The order has no customer email address");
  });

  it("leaves an entry pending when reading the order fails, without consuming a retry", async () => {
    await seedOrder();
    const entry = await seedEntry();
    const findOne = vi.spyOn(OrderModel, "findOne").mockRejectedValueOnce(new Error("read failed") as never);

    const result = await attemptDueNotifications(fakeProvider());

    expect(result).toMatchObject({ processed: 1, sent: 0, failed: 0, deferred: 1 });
    findOne.mockRestore();

    const stored = await readEntry(entry.key);
    expect(stored.status).toBe("pending");
    expect(stored.attempts).toBe(0);
    expect(stored.lastReason).toBeNull();
  });
});

/* -- Phase 7: claims, leases, ambiguity, quota and operator retry ----- */

describe("claims and leases", () => {
  it("lets only one concurrent processor send an entry", async () => {
    await seedOrder();
    await seedEntry();
    const first = fakeProvider();
    const second = fakeProvider();

    await Promise.all([attemptDueNotifications(first), attemptDueNotifications(second)]);

    expect(first.sent.length + second.sent.length).toBe(1);
    expect(await NotificationOutboxModel.countDocuments({ status: "sent" })).toBe(1);
  });

  it("records provider acceptance and the provider message id", async () => {
    await seedOrder();
    const entry = await seedEntry();

    await attemptDueNotifications(fakeProvider());

    const stored = await readEntry(entry.key);
    expect(stored.status).toBe("sent");
    expect(stored.providerId).toBe("fake_1");
    expect(stored.providerStatus).toBe("accepted");
    expect(stored.providerStatusAt).toBeInstanceOf(Date);
    expect(stored.leaseToken).toBeNull();
    expect(stored.leaseExpiresAt).toBeNull();
  });

  it("recovers an expired processing lease and delivers it", async () => {
    await seedOrder();
    const entry = await seedEntry({
      status: "processing",
      leaseToken: "stale-token",
      leaseExpiresAt: new Date(Date.now() - 60_000),
    });
    const provider = fakeProvider();

    const result = await attemptDueNotifications(provider);

    expect(result.recovered).toBe(1);
    expect(result.sent).toBe(1);
    const stored = await readEntry(entry.key);
    expect(stored.status).toBe("sent");
    expect(stored.attempts).toBe(1); // the interrupted attempt is counted
  });

  it("never settles an entry with a lease token it does not hold", async () => {
    await seedOrder();
    const entry = await seedEntry({
      status: "processing",
      leaseToken: "another-processor",
      leaseExpiresAt: new Date(Date.now() + 60_000),
    });

    const result = await attemptDueNotifications(fakeProvider());

    expect(result.processed).toBe(0);
    expect((await readEntry(entry.key)).status).toBe("processing");
  });
});

describe("ambiguous provider outcomes", () => {
  it("retries once with the same idempotency key, then parks as uncertain", async () => {
    await seedOrder();
    const entry = await seedEntry();
    const keys: string[] = [];
    const provider = fakeProvider((message) => {
      keys.push(message.idempotencyKey);
      throw new NotificationDeliveryError("The email provider did not confirm the request", {
        kind: "ambiguous",
      });
    });

    await attemptDueNotifications(provider);
    let stored = await readEntry(entry.key);
    expect(stored.status).toBe("pending");
    expect(stored.ambiguousAttempts).toBe(1);

    await NotificationOutboxModel.updateOne(
      { key: entry.key },
      { $set: { nextAttemptAt: new Date(Date.now() - 1_000) } },
    );
    const result = await attemptDueNotifications(provider);

    expect(result.uncertain).toBe(1);
    stored = await readEntry(entry.key);
    expect(stored.status).toBe("uncertain");
    expect(stored.ambiguousAttempts).toBe(2);
    expect(stored.providerId).toBeNull();
    expect(keys).toHaveLength(2);
    expect(keys[0]).toBe(entry.key);
    expect(keys[1]).toBe(entry.key);
  });

  it("defers a rate-limited entry without consuming a retry and honours Retry-After", async () => {
    await seedOrder();
    const entry = await seedEntry();

    await attemptDueNotifications(
      fakeProvider(() => {
        throw new NotificationDeliveryError("The email provider is rate limiting requests", {
          kind: "rate_limited",
          retryAfterMs: 120_000,
        });
      }),
    );

    const stored = await readEntry(entry.key);
    expect(stored.status).toBe("pending");
    expect(stored.attempts).toBe(0);
    expect(stored.lastReason).toBe("The email provider is rate limiting requests");
    expect(stored.nextAttemptAt.getTime()).toBeGreaterThanOrEqual(Date.now() + 115_000);
  });
});

describe("quota", () => {
  it("defers due work when the configured send limit is exhausted", async () => {
    await seedOrder();
    const entry = await seedEntry();
    await seedEntry({
      key: `${notificationKey("order.placed", REFERENCE, "customer")}:sent`,
      status: "sent",
      sentAt: new Date(),
    });
    vi.stubEnv("NOTIFICATION_MONTHLY_LIMIT", "1");
    vi.stubEnv("NOTIFICATION_DAILY_LIMIT", "100");

    try {
      const result = await attemptDueNotifications(fakeProvider());
      expect(result.quotaBlocked).toBe(true);
      const stored = await readEntry(entry.key);
      expect(stored.status).toBe("pending");
      expect(stored.lastReason).toContain("sending limit");
    } finally {
      vi.unstubAllEnvs();
    }
  });
});

describe("operator retry", () => {
  it("requeues a failed entry with a fresh budget and keeps its identity", async () => {
    await seedOrder();
    const entry = await seedEntry({
      status: "failed",
      attempts: MAX_NOTIFICATION_ATTEMPTS,
      lastReason: "The email provider rejected the message",
    });

    const outcome = await retryNotificationById(String(entry._id));

    expect(outcome).toBe("requeued");
    const stored = await readEntry(entry.key);
    expect(stored.status).toBe("pending");
    expect(stored.attempts).toBe(0);
    expect(stored.ambiguousAttempts).toBe(0);
    expect(stored.lastReason).toBeNull();
    expect(stored.key).toBe(entry.key);
  });

  it("refuses to requeue an entry that is not failed or uncertain", async () => {
    await seedOrder();
    const entry = await seedEntry({ status: "sent", sentAt: new Date() });

    expect(await retryNotificationById(String(entry._id))).toBe("not_eligible");
    expect(await retryNotificationById("PS-NOT-AN-ID")).toBe("not_found");
  });
});
