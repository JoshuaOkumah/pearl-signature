import { categoryMap } from "@/data/categories";
import type { DishTheme } from "@/types";

/**
 * Placeholder illustration palettes for products that have no image yet.
 *
 * Presentation only: keyed by category slug, with a warm default for any
 * category created later in the database. This is not catalogue data — real
 * imagery comes from Cloudinary, and the palette simply keeps the honest
 * placeholder art on-brand.
 */

const DEFAULT_THEME: DishTheme = { deep: "#6E5320", base: "#C9A24B", accent: "#5C7A58" };

export function placeholderThemeFor(categorySlug: string): DishTheme {
  const known = (categoryMap as Record<string, { theme: DishTheme } | undefined>)[categorySlug];
  return known?.theme ?? DEFAULT_THEME;
}
