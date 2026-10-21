import { describe, expect, it } from "vitest";
import { products } from "@/data/products";
import { ALL, countByCategory, filterProducts, isCategorySlug, parseMenuFilter } from "./filter";

describe("filterProducts", () => {
  it("returns every product when the filter is 'all'", () => {
    expect(filterProducts(products, ALL)).toHaveLength(products.length);
  });

  it("returns only products from the requested category", () => {
    const drinks = filterProducts(products, "drinks");
    expect(drinks.length).toBeGreaterThan(0);
    expect(drinks.every((product) => product.category === "drinks")).toBe(true);
  });

  it("returns an empty array when nothing matches", () => {
    const onlyDrinks = filterProducts(products, "drinks");
    expect(filterProducts(onlyDrinks, "traditional-foods")).toEqual([]);
  });
});

describe("parseMenuFilter", () => {
  it("keeps valid category slugs", () => {
    expect(parseMenuFilter("pastries-snacks")).toBe("pastries-snacks");
  });

  it("falls back to 'all' for unknown or malformed values", () => {
    expect(parseMenuFilter("desserts")).toBe(ALL);
    expect(parseMenuFilter(undefined)).toBe(ALL);
    expect(parseMenuFilter(["drinks"])).toBe(ALL);
    expect(parseMenuFilter(42)).toBe(ALL);
  });
});

describe("isCategorySlug", () => {
  it("accepts known slugs and rejects others", () => {
    expect(isCategorySlug("traditional-foods")).toBe(true);
    expect(isCategorySlug("burgers")).toBe(false);
  });
});

describe("countByCategory", () => {
  it("counts products per category", () => {
    expect(countByCategory(products, "traditional-foods")).toBe(4);
    expect(countByCategory(products, "pastries-snacks")).toBe(5);
    expect(countByCategory(products, "drinks")).toBe(2);
  });
});
