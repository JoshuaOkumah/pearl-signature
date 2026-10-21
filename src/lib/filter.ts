import { categories } from "@/data/categories";
import type { CategorySlug, Product } from "@/types";

/** "all" shows every product; otherwise a category slug. */
export const ALL = "all" as const;
export type MenuFilter = CategorySlug | typeof ALL;

export function isCategorySlug(value: unknown): value is CategorySlug {
  return typeof value === "string" && categories.some((category) => category.slug === value);
}

/** Safely normalise an unknown value (e.g. a URL search param) into a MenuFilter. */
export function parseMenuFilter(value: unknown): MenuFilter {
  return isCategorySlug(value) ? value : ALL;
}

export function filterProducts(products: Product[], filter: MenuFilter): Product[] {
  if (filter === ALL) return products;
  return products.filter((product) => product.category === filter);
}

export function countByCategory(products: Product[], slug: CategorySlug): number {
  return products.filter((product) => product.category === slug).length;
}
