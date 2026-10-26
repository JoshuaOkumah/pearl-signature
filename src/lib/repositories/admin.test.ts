import { Types } from "mongoose";
import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";

vi.mock("@/lib/db/mongoose", () => ({
  connectDatabase: vi.fn(async () => undefined),
  logDatabaseError: vi.fn(),
  isDatabaseConfigured: vi.fn(() => true),
  DatabaseUnavailableError: class DatabaseUnavailableError extends Error {},
}));

vi.mock("@/models/category", () => ({
  CategoryModel: { find: vi.fn() },
  CategoryRecord: {},
}));

vi.mock("@/models/product", () => ({
  ProductModel: { find: vi.fn(), findById: vi.fn(), countDocuments: vi.fn(), aggregate: vi.fn() },
  ProductRecord: {},
}));

vi.mock("@/models/order", () => ({
  OrderModel: { find: vi.fn(), countDocuments: vi.fn(), aggregate: vi.fn() },
  OrderRecord: {},
}));

import { connectDatabase, logDatabaseError } from "@/lib/db/mongoose";
import { CategoryModel } from "@/models/category";
import { OrderModel } from "@/models/order";
import { ProductModel } from "@/models/product";
import {
  CATEGORY_VISIBILITY_POLICY,
  getAdminProduct,
  getDashboardStats,
  listAdminCategories,
  listAdminProducts,
  listCategoryOptions,
  parseObjectId,
} from "./admin";

const CATEGORY_ID = "507f1f77bcf86cd799439011";
const SIDE_ID = "507f1f77bcf86cd799439012";
const PRODUCT_ID = "507f1f77bcf86cd799439022";

const CATEGORIES = [
  { _id: CATEGORY_ID, name: "Mains", slug: "mains", description: "Main dishes", sortOrder: 1, isActive: true },
  { _id: SIDE_ID, name: "Sides", slug: "sides", description: "", sortOrder: 2, isActive: false },
];

const PRODUCT = {
  _id: PRODUCT_ID,
  name: "Jollof Rice",
  slug: "jollof-rice",
  categoryId: CATEGORY_ID,
  status: "published",
  availability: "available",
  priceCents: 1250,
  featured: true,
  shortDescription: "Smoky party jollof",
  description: "Long-form description of the dish.",
  variants: [{ name: "Family tray", priceCents: 2000 }],
  // Deliberately stored out of order: the list thumbnail must pick the
  // lowest sortOrder regardless of array position.
  images: [
    { secureUrl: "https://res.example/b.jpg", publicId: "p/b", alt: "Second angle", sortOrder: 1 },
    { secureUrl: "https://res.example/a.jpg", publicId: "p/a", alt: "Primary angle", sortOrder: 0 },
  ],
  tags: ["spicy", "party"],
  sortOrder: 10,
  updatedAt: new Date("2026-10-01T10:00:00.000Z"),
  createdAt: new Date("2026-09-01T10:00:00.000Z"),
};

/** Hand-picked order projection as `getDashboardStats` reads it. */
const ORDER = {
  reference: "PS-1A2B3C4D5E",
  customer: { fullName: "Ada Obi" },
  status: "placed",
  payment: { status: "unpaid" },
  money: { totalCents: 4_938 },
  createdAt: new Date("2026-10-02T10:00:00.000Z"),
};

interface Chain {
  sort: Mock;
  skip: Mock;
  limit: Mock;
  select: Mock;
  lean: Mock;
}

/** Every chainable query the repository walks, recorded for assertions. */
const queries: Chain[] = [];

function chain(result: unknown): Chain {
  const q = {} as Chain;
  q.sort = vi.fn(() => q);
  q.skip = vi.fn(() => q);
  q.limit = vi.fn(() => q);
  q.select = vi.fn(() => q);
  q.lean = vi.fn(async () => result);
  queries.push(q);
  return q;
}

beforeEach(() => {
  vi.clearAllMocks();
  queries.length = 0;
  vi.mocked(CategoryModel.find).mockImplementation(() => chain(CATEGORIES) as never);
  vi.mocked(ProductModel.find).mockImplementation(() => chain([PRODUCT]) as never);
  vi.mocked(ProductModel.findById).mockReturnValue({ lean: async () => PRODUCT } as never);
  vi.mocked(ProductModel.countDocuments).mockResolvedValue(1 as never);
  vi.mocked(ProductModel.aggregate).mockResolvedValue([{ _id: CATEGORY_ID, count: 4 }] as never);
  vi.mocked(OrderModel.find).mockImplementation(() => chain([]) as never);
  vi.mocked(OrderModel.countDocuments).mockResolvedValue(0 as never);
  vi.mocked(OrderModel.aggregate).mockResolvedValue([] as never);
});

describe("parseObjectId", () => {
  it("accepts 24-hex ids and rejects everything else", () => {
    expect(parseObjectId(PRODUCT_ID)).toBeInstanceOf(Types.ObjectId);
    expect(String(parseObjectId(PRODUCT_ID))).toBe(PRODUCT_ID);

    expect(parseObjectId("nope")).toBeNull();
    expect(parseObjectId("507f1f77bcf86cd79943902")).toBeNull(); // too short
    expect(parseObjectId("507f1f77bcf86cd7994390zz")).toBeNull(); // non-hex
    expect(parseObjectId("")).toBeNull();
    expect(parseObjectId("507f1f77bcf86cd799439022extra")).toBeNull();
  });
});

describe("listAdminProducts", () => {
  it("returns true rows with category names, formatted prices and the primary thumbnail", async () => {
    vi.mocked(ProductModel.countDocuments).mockResolvedValue(45 as never);

    const result = await listAdminProducts({
      sort: "updated",
      page: 2,
      pageSize: 20,
    } as never);

    expect(result).not.toBeNull();
    expect(result!.total).toBe(45);
    expect(result!.totalPages).toBe(3); // ceil(45 / 20)
    expect(result!.page).toBe(2);

    const row = result!.rows[0];
    expect(row).toMatchObject({
      id: PRODUCT_ID,
      name: "Jollof Rice",
      slug: "jollof-rice",
      categoryName: "Mains",
      status: "published",
      availability: "available",
      priceInput: "12.50", // integer cents → CAD text
      featured: true,
      imageCount: 2,
      updatedAt: "2026-10-01T10:00:00.000Z",
    });
    // Thumbnail is the image with the LOWEST sortOrder, not array position.
    expect(row.thumbnailUrl).toBe("https://res.example/a.jpg");

    // Pagination happens in MongoDB: skip/limit applied after all criteria.
    const productChain = queries[1];
    expect(queries[0].sort).toHaveBeenCalledWith({ sortOrder: 1, name: 1 });
    expect(productChain.skip).toHaveBeenCalledWith(20);
    expect(productChain.limit).toHaveBeenCalledWith(20);
    expect(productChain.sort).toHaveBeenCalledWith({ updatedAt: -1, _id: -1 });
  });

  it("searches names with an escaped, case-insensitive substring", async () => {
    await listAdminProducts({ search: "jollof (rice)", sort: "name", pageSize: 20 } as never);

    const filter = vi.mocked(ProductModel.find).mock.calls[0][0] as unknown as Record<string, unknown>;
    expect(filter.name).toBeInstanceOf(RegExp);
    expect((filter.name as RegExp).flags).toContain("i");
    expect((filter.name as RegExp).test("Party Jollof (Rice)")).toBe(true);
    // Escaping matters: the parens must be literal, not a capture group.
    expect((filter.name as RegExp).test("jollof rice")).toBe(false);
    expect(queries[1].sort).toHaveBeenCalledWith({ name: 1, _id: 1 });
  });

  it("passes status, availability and category filters through to MongoDB", async () => {
    await listAdminProducts({
      status: "draft",
      availability: "unavailable",
      category: "mains",
      sort: "price",
      pageSize: 20,
    } as never);

    const filter = vi.mocked(ProductModel.find).mock.calls[0][0] as unknown as Record<string, unknown>;
    expect(filter.status).toBe("draft");
    expect(filter.availability).toBe("unavailable");
    expect(String(filter.categoryId)).toBe(CATEGORY_ID);
    expect(queries[1].sort).toHaveBeenCalledWith({ priceCents: 1, _id: 1 });

    // The count uses the SAME filter, so pagination totals are true matches.
    expect(ProductModel.countDocuments).toHaveBeenCalledWith(filter);
  });

  it("returns an honest empty page for an unknown category slug", async () => {
    const result = await listAdminProducts({ category: "ghost", pageSize: 20 } as never);
    expect(result).toEqual({ rows: [], total: 0, page: 1, pageSize: 20, totalPages: 1 });
    expect(ProductModel.find).not.toHaveBeenCalled();
    expect(ProductModel.countDocuments).not.toHaveBeenCalled();
  });

  it("labels products whose category no longer exists as Uncategorised", async () => {
    vi.mocked(ProductModel.find).mockImplementation(
      () => chain([{ ...PRODUCT, categoryId: "507f1f77bcf86cd799439099" }]) as never,
    );
    const result = await listAdminProducts({ pageSize: 20 } as never);
    expect(result!.rows[0].categoryName).toBe("Uncategorised");
  });

  it("degrades to null on infrastructure failure", async () => {
    vi.mocked(connectDatabase).mockRejectedValueOnce(new Error("down") as never);
    const result = await listAdminProducts({ pageSize: 20 } as never);
    expect(result).toBeNull();
    expect(logDatabaseError).toHaveBeenCalledWith("admin-list-products", expect.any(Error));
  });
});

describe("getAdminProduct", () => {
  it("returns null for malformed ids without touching the database", async () => {
    expect(await getAdminProduct("nope")).toBeNull();
    expect(connectDatabase).not.toHaveBeenCalled();
  });

  it("returns null for a missing product without logging an error", async () => {
    vi.mocked(ProductModel.findById).mockReturnValue({ lean: async () => null } as never);
    expect(await getAdminProduct(PRODUCT_ID)).toBeNull();
    expect(logDatabaseError).not.toHaveBeenCalled();
  });

  it("shapes the edit form payload from stored data only", async () => {
    const detail = await getAdminProduct(PRODUCT_ID);
    expect(detail).not.toBeNull();

    expect(detail!.categoryName).toBe("Mains");
    expect(detail!.priceCents).toBe(1250);
    expect(detail!.priceInput).toBe("12.50");
    expect(detail!.shortDescription).toBe("Smoky party jollof");
    expect(detail!.variants).toEqual([{ name: "Family tray", priceInput: "20.00" }]);
    expect(detail!.tags).toEqual(["spicy", "party"]);
    expect(detail!.createdAt).toBe("2026-09-01T10:00:00.000Z");
    expect(detail!.imageCount).toBe(2);
    expect(detail!.thumbnailUrl).toBe("https://res.example/a.jpg");

    // Hand-picked image fields: absent dimensions stay absent (no zeros).
    expect(detail!.images).toHaveLength(2);
    expect(detail!.images[0]).toMatchObject({ secureUrl: "https://res.example/b.jpg", alt: "Second angle", sortOrder: 1 });
    expect("width" in detail!.images[0]).toBe(false);
    expect("height" in detail!.images[0]).toBe(false);

    // Never leaks storage internals beyond the hand-picked shape.
    expect(Object.keys(detail!)).not.toContain("passwordHash");
  });

  it("degrades to null on infrastructure failure", async () => {
    vi.mocked(connectDatabase).mockRejectedValueOnce(new Error("down") as never);
    expect(await getAdminProduct(PRODUCT_ID)).toBeNull();
    expect(logDatabaseError).toHaveBeenCalledWith("admin-get-product", expect.any(Error));
  });
});

describe("listAdminCategories", () => {
  it("lists disabled categories too, with real product counts", async () => {
    const rows = await listAdminCategories();
    expect(rows).toHaveLength(2);

    expect(rows![0]).toEqual({
      id: CATEGORY_ID,
      name: "Mains",
      slug: "mains",
      description: "Main dishes",
      sortOrder: 1,
      isActive: true,
      productCount: 4, // from the $group aggregation
    });
    expect(rows![1]).toMatchObject({ id: SIDE_ID, name: "Sides", isActive: false, productCount: 0 });

    expect(ProductModel.aggregate).toHaveBeenCalledWith([
      { $group: { _id: "$categoryId", count: { $sum: 1 } } },
    ]);
    // Sorted for stable UI ordering.
    expect(queries[0].sort).toHaveBeenCalledWith({ sortOrder: 1, name: 1 });
  });

  it("degrades to null on infrastructure failure", async () => {
    vi.mocked(connectDatabase).mockRejectedValueOnce(new Error("down") as never);
    expect(await listAdminCategories()).toBeNull();
    expect(logDatabaseError).toHaveBeenCalledWith("admin-list-categories", expect.any(Error));
  });
});

describe("listCategoryOptions", () => {
  it("maps the select options including the active flag", async () => {
    const options = await listCategoryOptions();
    expect(options).toEqual([
      { id: CATEGORY_ID, name: "Mains", slug: "mains", isActive: true },
      { id: SIDE_ID, name: "Sides", slug: "sides", isActive: false },
    ]);
  });
});

describe("getDashboardStats", () => {
  it("reports only real counters derived from distinct count queries", async () => {
    vi.mocked(ProductModel.countDocuments).mockImplementation((async (filter: Record<string, unknown>) => {
      if (Object.keys(filter).length === 0) return 4;
      if (filter.status === "published") return 2;
      if (filter.status === "draft") return 1;
      if (filter.status === "archived") return 1;
      if (filter.availability === "unavailable") return 1;
      return 0;
    }) as never);

    // Order metrics: money grouped by PAYMENT state and a cancelled flag,
    // never by lifecycle alone.
    vi.mocked(OrderModel.aggregate).mockResolvedValue([
      { _id: { payment: "paid", cancelled: false }, count: 2, cents: 9_000 },
      { _id: { payment: "unpaid", cancelled: false }, count: 1, cents: 4_938 },
    ] as never);
    vi.mocked(OrderModel.countDocuments).mockResolvedValue(2 as never);
    vi.mocked(OrderModel.find).mockImplementation(() => chain([ORDER]) as never);

    const stats = await getDashboardStats();
    expect(stats).toEqual({
      totalProducts: 4,
      publishedProducts: 2,
      draftProducts: 1,
      archivedProducts: 1,
      unavailableProducts: 1,
      totalCategories: 2,
      activeCategories: 1, // the disabled category is counted separately
      recentProducts: [
        {
          id: PRODUCT_ID,
          name: "Jollof Rice",
          status: "published",
          availability: "available",
          updatedAt: "2026-10-01T10:00:00.000Z",
        },
      ],
      orders: {
        total: 3, // 2 paid + 1 unpaid, from the payment-status grouping
        inProgress: 2,
        awaitingPayment: 1,
        unpaidCents: 4_938, // outstanding Cash on Arrival
        collectedCents: 9_000, // paid ONLY
      },
      recentOrders: [
        {
          reference: "PS-1A2B3C4D5E",
          customerName: "Ada Obi",
          status: "placed",
          paymentStatus: "unpaid",
          totalCents: 4_938,
          placedAtIso: "2026-10-02T10:00:00.000Z",
        },
      ],
    });

    // One precise query per metric — no derived or invented numbers.
    const filters = vi.mocked(ProductModel.countDocuments).mock.calls.map((call) => call[0]);
    expect(filters).toEqual([
      {},
      { status: "published" },
      { status: "draft" },
      { status: "archived" },
      { availability: "unavailable", status: { $ne: "archived" } },
    ]);

    // Recent list: last five by update time, hand-picked fields only.
    expect(queries[1].sort).toHaveBeenCalledWith({ updatedAt: -1 });
    expect(queries[1].limit).toHaveBeenCalledWith(5);
    expect(queries[1].select).toHaveBeenCalledWith({
      name: 1,
      status: 1,
      availability: 1,
      updatedAt: 1,
    });
    expect(queries[0].select).toHaveBeenCalledWith({ _id: 1, isActive: 1 });
  });

  it("degrades to null on infrastructure failure", async () => {
    vi.mocked(connectDatabase).mockRejectedValueOnce(new Error("down") as never);
    expect(await getDashboardStats()).toBeNull();
    expect(logDatabaseError).toHaveBeenCalledWith("admin-stats", expect.any(Error));
  });
});

describe("CATEGORY_VISIBILITY_POLICY", () => {
  it("documents the disable-not-delete behaviour the UI relies on", () => {
    expect(CATEGORY_VISIBILITY_POLICY).toMatch(/Disabled categories are hidden/);
    expect(CATEGORY_VISIBILITY_POLICY).toMatch(/return when it is re-enabled/);
  });
});
