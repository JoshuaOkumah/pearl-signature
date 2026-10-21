import { describe, expect, it } from "vitest";
import { excerpt, formatCad } from "./format";

describe("formatCad", () => {
  it("formats integer cents as Canadian currency with the CAD marker", () => {
    expect(formatCad(1800)).toBe("$18.00 CAD");
    expect(formatCad(1)).toBe("$0.01 CAD");
    expect(formatCad(123456)).toBe("$1,234.56 CAD");
    expect(formatCad(500000)).toBe("$5,000.00 CAD");
  });

  it("returns null for unconfigured prices (never a fabricated amount)", () => {
    expect(formatCad(null)).toBeNull();
    expect(formatCad(undefined)).toBeNull();
  });

  it("returns null for malformed values", () => {
    expect(formatCad(-100)).toBeNull();
    expect(formatCad(10.5)).toBeNull();
    expect(formatCad(Number.NaN)).toBeNull();
    expect(formatCad(Number.POSITIVE_INFINITY)).toBeNull();
  });
});

describe("excerpt", () => {
  it("keeps short text unchanged", () => {
    expect(excerpt("A short description.")).toBe("A short description.");
  });

  it("trims at a word boundary and adds an ellipsis", () => {
    const long =
      "Ground melon seeds cooked into a rich, nutty soup with leafy greens, a beloved favourite at the Nigerian table and beyond.";
    const result = excerpt(long, 60);
    expect(result.length).toBeLessThanOrEqual(61);
    expect(result.endsWith("…")).toBe(true);
    expect(result).not.toContain("  ");
    // No mid-word cut: the final visible word must be whole.
    const withoutEllipsis = result.slice(0, -1);
    expect(long.startsWith(withoutEllipsis)).toBe(true);
    expect(withoutEllipsis.endsWith(" ")).toBe(false);
  });

  it("normalises whitespace", () => {
    expect(excerpt("  Spaced   out   text  ")).toBe("Spaced out text");
  });
});
