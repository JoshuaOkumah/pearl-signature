/**
 * Core domain types for PEARL Signature.
 *
 * Phase 1: these types describe the preview data model.
 * Later phases will map them onto Mongoose schemas (MongoDB) without
 * changing the presentation layer.
 */

export type CategorySlug = "traditional-foods" | "pastries-snacks" | "drinks";

/**
 * Colour theme used by the temporary FoodMedia illustration component.
 * Once real photography (Cloudinary) replaces the illustrations, themes
 * can be dropped from the data model.
 */
export interface DishTheme {
  /** Deepest tone — base of the dish illustration. */
  deep: string;
  /** Primary tone of the dish. */
  base: string;
  /** Highlight / garnish tone. */
  accent: string;
}

export interface Category {
  slug: CategorySlug;
  name: string;
  shortName: string;
  tagline: string;
  description: string;
  theme: DishTheme;
}

export interface Product {
  slug: string;
  name: string;
  category: CategorySlug;
  description: string;
  /** Shown in the curated “Signature Favourites” showcase. */
  featured: boolean;
  theme: DishTheme;
  /*
   * Pricing is intentionally absent in Phase 1 — it has not been supplied
   * by the business. A `price` field (in CAD cents) will be added with the
   * MongoDB integration in a later phase.
   */
}

export interface FaqItem {
  question: string;
  answer: string;
}

export interface NavItem {
  label: string;
  href: string;
}
