/**
 * Core domain types for PEARL Signature.
 *
 * These are the PUBLIC data-transfer shapes: pages and components only ever
 * receive these types (never raw Mongoose documents or ObjectIds). The Phase 2
 * catalogue layer (src/lib/repositories) produces them from MongoDB or, in
 * development/test, from the labelled preview fixtures in src/data.
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

/**
 * Marketing copy and placeholder palettes for the three launch categories.
 * Category FACTS (name, slug, description, ordering) are database-driven;
 * these extras are presentation only and fall back gracefully for unknown slugs.
 */
export interface Category {
  slug: CategorySlug;
  name: string;
  shortName: string;
  tagline: string;
  description: string;
  theme: DishTheme;
}

/** Category as served to the catalogue surface (menu chips, breadcrumbs). */
export interface CatalogueCategory {
  slug: string;
  name: string;
  description: string;
  sortOrder: number;
}

/** Publication status: draft products are never publicly readable. */
export type ProductStatus = "draft" | "published";

/**
 * Availability indicator. Distinct from publication: a product can be
 * published for browsing while being unavailable for preparation.
 */
export type ProductAvailability = "available" | "unavailable";

/** A single image reference. The binary lives on Cloudinary, never in MongoDB. */
export interface ProductImage {
  /** HTTPS Cloudinary delivery URL (validated by Zod and again at render). */
  secureUrl: string;
  /** Cloudinary public ID — kept for future admin transformations (Phase 3). */
  publicId?: string;
  /** Alternative text describing the food shown. */
  alt: string;
  /** Display order (0 = primary image). */
  sortOrder: number;
  /** Optional intrinsic dimensions — used to reserve layout space (no CLS). */
  width?: number;
  height?: number;
}

/**
 * Optional portion/size variation. `priceCents` is null until the business
 * configures it; unconfigured variants must never be presented as orderable.
 */
export interface ProductVariant {
  name: string;
  priceCents: number | null;
}

export interface Product {
  slug: string;
  name: string;
  /** Category slug (database-driven). */
  category: string;
  /** Category display name at read time, denormalised for presentational use. */
  categoryName: string;
  description: string;
  shortDescription: string | null;
  /** Shown in the curated “Signature Favourites” showcase. */
  featured: boolean;
  /** Placeholder palette — used only while the product has no image. */
  theme: DishTheme;
  status: ProductStatus;
  availability: ProductAvailability;
  /** Locked to CAD for the Canadian storefront. */
  currency: "CAD";
  /**
   * Canonical price in integer Canadian cents. Null until the business
   * configures it — there is no zero-dollar placeholder price.
   */
  priceCents: number | null;
  /** Optional portion/size variations (informational until cart exists). */
  variants: ProductVariant[];
  images: ProductImage[];
  tags: string[];
  sortOrder: number;
}

export interface FaqItem {
  question: string;
  answer: string;
}

export interface NavItem {
  label: string;
  href: string;
}
