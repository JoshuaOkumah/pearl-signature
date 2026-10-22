import { describe, expect, it } from "vitest";
import {
  ADMIN_DEFAULT_PAGE_SIZE,
  categoryFormSchema,
  cloudinaryPublicIdSchema,
  formatCadInput,
  imageAltSchema,
  loginSchema,
  MAX_PRICE_CENTS,
  moneyInputSchema,
  parseCadInput,
  productFormSchema,
} from "./admin";

describe("parseCadInput", () => {
  it("parses human CAD entries into integer cents with integer arithmetic", () => {
    expect(parseCadInput("12.50")).toBe(1250);
    expect(parseCadInput("12.5")).toBe(1250);
    expect(parseCadInput("12")).toBe(1200);
    expect(parseCadInput("$12.50")).toBe(1250);
    expect(parseCadInput("  7.05  ")).toBe(705);
    expect(parseCadInput("0.01")).toBe(1);
  });

  it("returns null for an empty input (unconfigured price)", () => {
    expect(parseCadInput("")).toBeNull();
    expect(parseCadInput("   ")).toBeNull();
  });

  it("rejects malformed or out-of-range input", () => {
    expect(parseCadInput("abc")).toBeUndefined();
    expect(parseCadInput("-5")).toBeUndefined();
    expect(parseCadInput("1.234")).toBeUndefined(); // 3 decimals
    expect(parseCadInput("1,200")).toBeUndefined(); // no separators
    expect(parseCadInput("0")).toBeUndefined(); // zero is not a price
    expect(parseCadInput("0.00")).toBeUndefined();
    expect(parseCadInput("1000000")).toBeUndefined(); // 7 digits over the bound
  });

  it("caps at the supported maximum", () => {
    expect(parseCadInput("999999.99")).toBe(MAX_PRICE_CENTS);
    expect(parseCadInput("1000000.00")).toBeUndefined();
  });
});

describe("formatCadInput", () => {
  it("renders stored cents for the admin input", () => {
    expect(formatCadInput(1250)).toBe("12.50");
    expect(formatCadInput(100)).toBe("1.00");
    expect(formatCadInput(5)).toBe("0.05");
    expect(formatCadInput(99_999_999)).toBe("999999.99");
  });

  it("renders unconfigured or invalid values as an empty input", () => {
    expect(formatCadInput(null)).toBe("");
    expect(formatCadInput(undefined)).toBe("");
    expect(formatCadInput(0)).toBe("");
    expect(formatCadInput(-100)).toBe("");
    expect(formatCadInput(18.5)).toBe(""); // floats never round-trip
  });
});

describe("moneyInputSchema", () => {
  it("maps '' to null and valid text to cents", () => {
    expect(moneyInputSchema.parse("")).toBeNull();
    expect(moneyInputSchema.parse("12.50")).toBe(1250);
  });

  it("fails on malformed money", () => {
    expect(moneyInputSchema.safeParse("1.234").success).toBe(false);
    expect(moneyInputSchema.safeParse("-1").success).toBe(false);
    expect(moneyInputSchema.safeParse("0").success).toBe(false);
  });
});

describe("loginSchema", () => {
  it("normalises email and requires both fields", () => {
    const parsed = loginSchema.parse({ email: "  Owner@Example.COM ", password: "secret" });
    expect(parsed.email).toBe("owner@example.com");
    expect(loginSchema.safeParse({ email: "nope", password: "x" }).success).toBe(false);
    expect(loginSchema.safeParse({ email: "a@b.co", password: "" }).success).toBe(false);
  });
});

describe("productFormSchema", () => {
  const base = {
    name: "Jollof Rice",
    slug: "",
    categoryId: "507f1f77bcf86cd799439011",
    shortDescription: "",
    description: "Party jollof rice.",
    price: "12.50",
    variants: [],
    status: "draft",
    availability: "available",
    featured: false,
    sortOrder: "10",
    tags: " rice, party ,rice ",
  };

  it("accepts a complete draft and derives typed values", () => {
    const parsed = productFormSchema.safeParse(base);
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(parsed.data.price).toBe(1250);
    expect(parsed.data.sortOrder).toBe(10);
    expect(parsed.data.status).toBe("draft");
    // Blank slug stays blank (create derives it; edit keeps the current one).
    expect(parsed.data.slug).toBe("");
    // Tags are trimmed and deduplicated.
    expect(parsed.data.tags).toEqual(["rice", "party"]);
  });

  it("rejects invalid prices, statuses and object ids", () => {
    expect(productFormSchema.safeParse({ ...base, price: "free" }).success).toBe(false);
    expect(productFormSchema.safeParse({ ...base, status: "archived" }).success).toBe(false);
    expect(productFormSchema.safeParse({ ...base, categoryId: "not-an-id" }).success).toBe(false);
    expect(productFormSchema.safeParse({ ...base, description: "" }).success).toBe(false);
  });

  it("validates variant rows with individual prices", () => {
    const parsed = productFormSchema.safeParse({
      ...base,
      variants: [
        { name: "Small", price: "10" },
        { name: "Family", price: "" },
      ],
    });
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(parsed.data.variants).toEqual([
      { name: "Small", price: 1000 },
      { name: "Family", price: null },
    ]);
  });
});

describe("categoryFormSchema", () => {
  it("accepts a basic category and coerces the order", () => {
    const parsed = categoryFormSchema.safeParse({
      name: "Soups",
      slug: "",
      description: "",
      sortOrder: "5",
      isActive: true,
    });
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(parsed.data.sortOrder).toBe(5);
    expect(parsed.data.isActive).toBe(true);
  });

  it("requires a name", () => {
    expect(
      categoryFormSchema.safeParse({ name: "  ", slug: "", description: "", sortOrder: "0", isActive: true })
        .success,
    ).toBe(false);
  });
});

describe("image payload schemas", () => {
  it("requires alt text within bounds", () => {
    expect(imageAltSchema.safeParse("A bowl of soup").success).toBe(true);
    expect(imageAltSchema.safeParse("").success).toBe(false);
    expect(imageAltSchema.safeParse("x".repeat(301)).success).toBe(false);
  });

  it("accepts Cloudinary public ids with folders and rejects unsafe characters", () => {
    expect(cloudinaryPublicIdSchema.safeParse("pearl-signature/products/abc123").success).toBe(true);
    expect(cloudinaryPublicIdSchema.safeParse("pearl-signature/products/abc/def-x_1").success).toBe(true);
    expect(cloudinaryPublicIdSchema.safeParse("../etc/passwd").success).toBe(false);
    expect(cloudinaryPublicIdSchema.safeParse("a b").success).toBe(false);
  });
});

describe("admin list query schema", () => {
  it("falls back safely on unknown values", async () => {
    const { adminProductQuerySchema } = await import("./admin");
    const parsed = adminProductQuerySchema.parse({
      status: "nonsense",
      sort: "nonsense",
      page: "-4",
      pageSize: "9999",
    });
    expect(parsed.status).toBeUndefined();
    expect(parsed.sort).toBe("updated");
    expect(parsed.page).toBe(1);
    expect(parsed.pageSize).toBe(20); // out-of-range falls back to the default size
    expect(ADMIN_DEFAULT_PAGE_SIZE).toBe(20);
  });
});
