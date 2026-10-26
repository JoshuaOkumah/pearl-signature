// @vitest-environment node
import mongoose from "mongoose";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { MongoMemoryServer } from "mongodb-memory-server";
import { connectDatabase } from "@/lib/db/mongoose";
import { OrderAttemptModel } from "@/models/order-attempt";
import { consumeOrderRateLimit } from "./rate-limit";

let mongod: MongoMemoryServer | null = null;

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  process.env.MONGODB_URI = mongod.getUri("pearl_order_rate_limit_test");
  await connectDatabase();
  await OrderAttemptModel.createIndexes();
});

beforeEach(async () => {
  await OrderAttemptModel.deleteMany({});
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongod?.stop();
  mongod = null;
});

describe("payment initiation rate limit", () => {
  it("bounds checkout initialization attempts in a 15-minute bucket", async () => {
    const now = Date.UTC(2026, 9, 26, 12, 0, 0);
    for (let attempt = 0; attempt < 10; attempt += 1) {
      expect((await consumeOrderRateLimit("payment.create", "203.0.113.91", now)).allowed).toBe(true);
    }
    expect(await consumeOrderRateLimit("payment.create", "203.0.113.91", now)).toMatchObject({ allowed: false, remaining: 0 });
    expect(await OrderAttemptModel.countDocuments({})).toBe(1);
  });

  it("uses independent scope/address buckets and does not store the raw address", async () => {
    const now = Date.UTC(2026, 9, 26, 12, 0, 0);
    await consumeOrderRateLimit("payment.create", "203.0.113.92", now);
    await consumeOrderRateLimit("order.create", "203.0.113.92", now);
    await consumeOrderRateLimit("payment.create", "203.0.113.93", now);
    const rows = await OrderAttemptModel.find().lean();
    expect(rows).toHaveLength(3);
    expect(rows.map((row) => row.key).every((key) => !key.includes("203.0.113."))).toBe(true);
    expect(rows.map((row) => row.key).every((key) => key.startsWith("oa:"))).toBe(true);
  });
});
