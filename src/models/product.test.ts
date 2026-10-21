import { describe, expect, it } from "vitest";
import { CategoryModel } from "./category";
import { ProductModel, ProductSchema } from "./product";

/** All assertions run offline: document validation never needs a connection. */

const baseInput = {
  name: "Egusi Soup",
  slug: "egusi-soup",
  description: "Ground melon seeds cooked into a rich soup.",
  categoryId: "656f00000000000000000001",
};

function newProduct(overrides: Record<string, unknown> = {}) {
  return new ProductModel({ ...baseInput, ...overrides });
}

describe("ProductSchema", () => {
  it("applies safe defaults (draft, unconfigured price, CAD)", () => {
    const product = newProduct();
    expect(product.status).toBe("draft"); // nothing is public by accident
    expect(product.priceCents).toBeNull(); // no fake $0 placeholder
    expect(product.currency).toBe("CAD");
    expect(product.availability).toBe("available");
    expect(product.featured).toBe(false);
    expect(product.images).toEqual([]);
    expect(product.variants).toEqual([]);
    expect(product.stock).toMatchObject({ tracked: false, quantity: null });
    expect(product.validateSync()).toBeUndefined();
  });

  it("requires the core fields", () => {
    const product = new ProductModel();
    const error = product.validateSync();
    expect(error?.errors.name).toBeDefined();
    expect(error?.errors.slug).toBeDefined();
    expect(error?.errors.description).toBeDefined();
    expect(error?.errors.categoryId).toBeDefined();
  });

  it("normalises slugs to URL-safe form", () => {
    const product = newProduct({ slug: "Egusi Soup (Premium)" });
    expect(product.slug).toBe("egusi-soup-premium");
    expect(product.validateSync()).toBeUndefined();
  });

  it("rejects slugs that cannot be normalised into URL-safe form", () => {
    // The setter sanitises ordinary punctuation away; only values with no
    // URL-safe characters at all remain invalid.
    expect(newProduct({ slug: "!!!" }).validateSync()).toBeDefined();
  });

  it("accepts only positive integer prices or null", () => {
    expect(newProduct({ priceCents: 1800 }).validateSync()).toBeUndefined();
    expect(newProduct({ priceCents: null }).validateSync()).toBeUndefined();
    expect(newProduct({ priceCents: 0 }).validateSync()).toBeDefined(); // no $0 placeholder
    expect(newProduct({ priceCents: 18.5 }).validateSync()).toBeDefined(); // no floats
    expect(newProduct({ priceCents: -100 }).validateSync()).toBeDefined();
  });

  it("enforces status and availability vocabularies", () => {
    expect(newProduct({ status: "published" }).validateSync()).toBeUndefined();
    expect(newProduct({ status: "archived" }).validateSync()).toBeDefined();
    expect(newProduct({ availability: "unavailable" }).validateSync()).toBeUndefined();
    expect(newProduct({ availability: "resting" }).validateSync()).toBeDefined();
    expect(newProduct({ currency: "USD" }).validateSync()).toBeDefined();
  });

  it("validates embedded image metadata (HTTPS + alt text + bounds)", () => {
    const ok = newProduct({
      images: [{ secureUrl: "https://res.cloudinary.com/demo/image/upload/a.jpg", alt: "A bowl of soup", sortOrder: 0 }],
    });
    expect(ok.validateSync()).toBeUndefined();

    const noAlt = newProduct({ images: [{ secureUrl: "https://res.cloudinary.com/x/a.jpg", sortOrder: 0 }] });
    expect(noAlt.validateSync()).toBeDefined();

    const insecure = newProduct({
      images: [{ secureUrl: "http://insecure.example/a.jpg", alt: "x", sortOrder: 0 }],
    });
    expect(insecure.validateSync()).toBeDefined();

    const tooMany = newProduct({
      images: Array.from({ length: 11 }, (_, index) => ({
        secureUrl: `https://res.cloudinary.com/x/a-${index}.jpg`,
        alt: `image ${index}`,
        sortOrder: index,
      })),
    });
    expect(tooMany.validateSync()).toBeDefined();
  });

  it("validates variant pricing the same way as product pricing", () => {
    expect(newProduct({ variants: [{ name: "Family", priceCents: 2400 }] }).validateSync()).toBeUndefined();
    expect(newProduct({ variants: [{ name: "Family", priceCents: null }] }).validateSync()).toBeUndefined();
    expect(newProduct({ variants: [{ name: "Family", priceCents: 0 }] }).validateSync()).toBeDefined();
    expect(newProduct({ variants: [{ name: "", priceCents: null }] }).validateSync()).toBeDefined();
  });

  it("declares the expected indexes", () => {
    const indexes = ProductSchema.indexes();
    const shapes = indexes.map(([fields, options]) => ({ fields, options }));

    expect(shapes.some(({ fields, options }) => fields.slug === 1 && options.unique === true)).toBe(true);
    expect(shapes.some(({ fields }) => fields.status === 1 && fields.sortOrder === 1)).toBe(true);
    expect(
      shapes.some(({ fields }) => fields.status === 1 && fields.categoryId === 1 && fields.sortOrder === 1),
    ).toBe(true);
    expect(
      shapes.some(({ fields }) => fields.status === 1 && fields.featured === 1 && fields.sortOrder === 1),
    ).toBe(true);
  });

  it("keeps timestamps enabled for future admin workflows", () => {
    expect(ProductSchema.options.timestamps).toBe(true);
    expect(ProductSchema.get("collection")).toBe("products");
  });
});

describe("CategoryModel", () => {
  it("applies defaults and validates required fields", () => {
    const category = new CategoryModel({ name: "Drinks", slug: "drinks" });
    expect(category.isActive).toBe(true);
    expect(category.sortOrder).toBe(0);
    expect(category.description).toBe("");
    expect(category.validateSync()).toBeUndefined();

    const invalid = new CategoryModel();
    const error = invalid.validateSync();
    expect(error?.errors.name).toBeDefined();
    expect(error?.errors.slug).toBeDefined();
  });

  it("normalises and requires unique URL-safe slugs", () => {
    const category = new CategoryModel({ name: "Pastries & Snacks", slug: "Pastries & Snacks" });
    expect(category.slug).toBe("pastries-snacks");
    expect(category.validateSync()).toBeUndefined();

    expect(new CategoryModel({ name: "Bad", slug: "###" }).validateSync()).toBeDefined();

    const [fields, options] = CategorySchema_indexes();
    expect(fields).toEqual({ slug: 1 });
    expect(options.unique).toBe(true);
  });
});

function CategorySchema_indexes(): [Record<string, number>, { unique?: boolean }] {
  const [entry] = CategoryModel.schema.indexes();
  return [entry[0] as Record<string, number>, entry[1] as { unique?: boolean }];
}
