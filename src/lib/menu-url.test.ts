import { describe, expect, it } from "vitest";
import { DEFAULT_PAGE_SIZE } from "@/lib/validations/catalogue";
import { menuUrl } from "./menu-url";

describe("menuUrl", () => {
  it("returns the clean URL for the default view", () => {
    expect(menuUrl()).toBe("/menu");
    expect(menuUrl({})).toBe("/menu");
    expect(menuUrl({ category: null, search: "", page: 1, pageSize: DEFAULT_PAGE_SIZE })).toBe("/menu");
  });

  it("builds shareable category and search URLs", () => {
    expect(menuUrl({ category: "drinks" })).toBe("/menu?category=drinks");
    expect(menuUrl({ search: "egusi" })).toBe("/menu?search=egusi");
    expect(menuUrl({ category: "drinks", search: "zobo drink" })).toBe(
      "/menu?category=drinks&search=zobo+drink",
    );
  });

  it("omits page 1 but includes later pages", () => {
    expect(menuUrl({ page: 2 })).toBe("/menu?page=2");
    expect(menuUrl({ category: "drinks", page: 3 })).toBe("/menu?category=drinks&page=3");
  });

  it("includes only non-default page sizes", () => {
    expect(menuUrl({ pageSize: DEFAULT_PAGE_SIZE })).toBe("/menu");
    expect(menuUrl({ pageSize: 4 })).toBe("/menu?pageSize=4");
  });

  it("trims surrounding whitespace instead of emitting blank parameters", () => {
    expect(menuUrl({ category: "  drinks ", search: "  " })).toBe("/menu?category=drinks");
  });
});
