import type { Category, CategorySlug } from "@/types";

/**
 * Menu categories.
 * The architecture supports adding more categories in the future —
 * extend CategorySlug in src/types and add an entry here.
 */
export const categories: Category[] = [
  {
    slug: "traditional-foods",
    name: "Traditional Foods",
    shortName: "Traditional",
    tagline: "Soups & classics",
    description:
      "Slow-simmered soups and beloved Nigerian classics, prepared with authentic recipes and patience.",
    theme: { deep: "#2F4630", base: "#5C7A58", accent: "#D4AF37" },
  },
  {
    slug: "pastries-snacks",
    name: "Pastries & Snacks",
    shortName: "Pastries",
    tagline: "Baked & fried favourites",
    description:
      "Golden, flaky pastries and satisfying snacks, perfect for gatherings, gifts, or a quiet treat.",
    theme: { deep: "#7A4E22", base: "#C98F45", accent: "#5C7A58" },
  },
  {
    slug: "drinks",
    name: "Drinks",
    shortName: "Drinks",
    tagline: "Traditional refreshments",
    description: "Refreshing homemade drinks, brewed the traditional way and served chilled.",
    theme: { deep: "#571C2A", base: "#93324A", accent: "#D4AF37" },
  },
];

export const categoryMap: Record<CategorySlug, Category> = Object.fromEntries(
  categories.map((category) => [category.slug, category]),
) as Record<CategorySlug, Category>;

export function getCategory(slug: CategorySlug): Category {
  return categoryMap[slug];
}
