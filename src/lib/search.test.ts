import { describe, expect, it } from "vitest";
import {
  MIN_SUBSTRING_LENGTH,
  compareSearchRelevance,
  escapeRegExp,
  nameMatchTier,
  normalizeSearchTerm,
  searchCandidateRegex,
} from "./search";

describe("normalizeSearchTerm", () => {
  it("trims, collapses internal whitespace and case-folds", () => {
    expect(normalizeSearchTerm("  Meat   Pie  ")).toBe("meat pie");
    expect(normalizeSearchTerm("\tEGUSI\n")).toBe("egusi");
  });

  it("returns null for empty and whitespace-only input", () => {
    expect(normalizeSearchTerm("")).toBeNull();
    expect(normalizeSearchTerm("   ")).toBeNull();
    expect(normalizeSearchTerm(undefined)).toBeNull();
    expect(normalizeSearchTerm(null)).toBeNull();
  });

  it("bounds the term length", () => {
    const long = "a".repeat(500);
    expect(normalizeSearchTerm(long)?.length).toBe(100);
  });
});

describe("nameMatchTier", () => {
  it("single character: matches only names beginning with it", () => {
    expect(nameMatchTier("Fried Rice", "f")).toBe(1);
    expect(nameMatchTier("Egusi Soup", "f")).toBe(0); // "favourite" lives in the description
    expect(nameMatchTier("Pepper Soup", "f")).toBe(0);
  });

  it("single character: zero when no name begins with it", () => {
    for (const name of ["Egusi Soup", "Meat Pie", "Zobo", "Soya Milk"]) {
      expect(nameMatchTier(name, "f")).toBe(0);
    }
  });

  it("two characters: name prefix is tier 1, word prefix is tier 2", () => {
    expect(nameMatchTier("Egusi Soup", "eg")).toBe(1);
    expect(nameMatchTier("Egg Roll", "eg")).toBe(1);
    expect(nameMatchTier("Meat Pie", "me")).toBe(1);
    expect(nameMatchTier("Meat Pie", "pie")).toBe(2);
    expect(nameMatchTier("Chicken Pie", "pie")).toBe(2);
    expect(nameMatchTier("Turkey Pie", "pie")).toBe(2);
    expect(nameMatchTier("Egusi Soup", "sou")).toBe(2);
    // Two-character terms never use the substring tier.
    expect(nameMatchTier("Big Deal", "ig")).toBe(0); // "ig" only appears mid-word
  });

  it("three or more characters: substring matches rank below prefixes", () => {
    expect(nameMatchTier("Egusi Soup", "egusi")).toBe(1);
    expect(nameMatchTier("Egusi Soup", "soup")).toBe(2);
    // Substrings inside a word: only for 3+ character terms.
    expect(nameMatchTier("Egusi Soup", "gus")).toBe(3); // inside "egusi"
    expect(nameMatchTier("Bus Ticket", "ust")).toBe(0); // no "ust" run (space breaks it)
    expect(nameMatchTier("Robust Platter", "ust")).toBe(3); // inside "robust"
    expect(nameMatchTier("Egusi Soup", "gu")).toBe(0); // 2-char terms never use the substring tier
    expect(MIN_SUBSTRING_LENGTH).toBe(3);
  });

  it("is case-insensitive", () => {
    expect(nameMatchTier("Meat Pie", "PIE")).toBe(2);
    expect(nameMatchTier("meat pie", "MEAT")).toBe(1);
  });

  it("treats hyphens and apostrophes as word boundaries (regex \\b parity)", () => {
    expect(nameMatchTier("Suya Kebab", "keb")).toBe(2);
    expect(nameMatchTier("Mama's Pie", "pie")).toBe(2);
  });

  it("returns zero for special characters and non-matching input", () => {
    expect(nameMatchTier("Egusi Soup", ".*")).toBe(0);
    expect(nameMatchTier("Egusi Soup", "([")).toBe(0);
    expect(nameMatchTier("Egusi Soup", "zzz")).toBe(0);
  });
});

describe("searchCandidateRegex", () => {
  it("anchors single characters to the start of the name", () => {
    const pattern = searchCandidateRegex("f");
    expect(pattern.flags).toBe("i");
    expect(pattern.source).toBe("^f");
    expect(pattern.test("Fried Rice")).toBe(true);
    expect(pattern.test("Egusi Soup")).toBe(false);
  });

  it("accepts name or word prefixes for two characters", () => {
    const two = searchCandidateRegex("eg");
    expect(two.source).toBe("(?:^|\\b)eg");
    expect(two.test("Egusi Soup")).toBe(true);
    expect(two.test("Big Egg Roll")).toBe(true);
    expect(two.test("Keg Party")).toBe(false); // no word boundary before "eg"
  });

  it("uses an unanchored literal for 3+ characters", () => {
    const pattern = searchCandidateRegex("sou");
    expect(pattern.test("Egusi Soup")).toBe(true);
    expect(pattern.test("Souk Kitchen")).toBe(true);
    expect(searchCandidateRegex("pie").test("Meat Pie")).toBe(true);
  });

  it("escapes every regular-expression metacharacter", () => {
    const pattern = searchCandidateRegex("a.*b(c");
    expect(pattern.source).toBe("a\\.\\*b\\(c");
    expect(pattern.test("a.*b(c")).toBe(true);
    expect(pattern.test("axxbzc")).toBe(false);
    expect(escapeRegExp("[a-z]+")).toBe("\\[a-z\\]\\+");
  });
});

describe("compareSearchRelevance", () => {
  it("orders by tier first, then sortOrder, then slug (deterministic)", () => {
    const tier1 = { name: "Plantain Chips", sortOrder: 9, slug: "plantain-chips" };
    const tier2a = { name: "Chicken Pie", sortOrder: 0, slug: "chicken-pie" };
    const tier2b = { name: "Meat Pie", sortOrder: 5, slug: "meat-pie" };
    const term = "p";

    const sorted = [tier2a, tier1, tier2b].sort((a, b) => compareSearchRelevance(a, b, term));
    expect(sorted.map((entry) => entry.slug)).toEqual([
      "plantain-chips", // tier 1 wins despite the highest sortOrder
      "chicken-pie", // tier 2, lower sortOrder first
      "meat-pie",
    ]);
  });

  it("breaks complete ties by slug so pages can never overlap", () => {
    const a = { name: "Pie", sortOrder: 1, slug: "alpha-pie" };
    const b = { name: "Pie", sortOrder: 1, slug: "beta-pie" };
    expect(compareSearchRelevance(a, b, "pie")).toBeLessThan(0);
    expect(compareSearchRelevance(b, a, "pie")).toBeGreaterThan(0);
  });
});
