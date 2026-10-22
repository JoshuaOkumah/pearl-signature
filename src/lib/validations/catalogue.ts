import { z } from "zod";
import { isCloudinaryUrl } from "@/lib/images";

/**
 * Runtime validation for every catalogue boundary:
 *
 * - user-controlled URL parameters (`/menu?category=…&search=…&page=…`)
 * - repository output (database documents are parsed before reaching pages)
 *
 * Bounds are deliberate: pagination sizes are capped, search terms are
 * length-limited, and slugs are strictly patterned so unknown input can never
 * reach a query unescaped.
 */

/* ── shared constraints ─────────────────────────────────────────────── */

export const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const MAX_SLUG_LENGTH = 80;
export const MAX_SEARCH_LENGTH = 100;
export const MAX_PAGE = 1_000;
export const DEFAULT_PAGE_SIZE = 12;
export const MAX_PAGE_SIZE = 48;

export const slugSchema = z
  .string()
  .trim()
  .max(MAX_SLUG_LENGTH, "Slug is too long")
  .regex(SLUG_PATTERN, "Not a valid slug");

export const searchTermSchema = z.string().trim().max(MAX_SEARCH_LENGTH, "Search term is too long");

/* ── URL parameters (menu page) ─────────────────────────────────────── */

/** searchParams may deliver repeated keys as arrays; take the last value. */
const lastValue = (value: unknown): unknown => (Array.isArray(value) ? value[value.length - 1] : value);

export const menuSearchParamsSchema = z.object({
  category: z.preprocess(lastValue, slugSchema.optional().catch(undefined)),
  search: z.preprocess(lastValue, searchTermSchema.optional().catch(undefined)),
  page: z.preprocess(lastValue, z.coerce.number().int().min(1).max(MAX_PAGE).catch(1)),
  pageSize: z.preprocess(
    lastValue,
    z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).catch(DEFAULT_PAGE_SIZE),
  ),
});

export type MenuSearchParams = z.output<typeof menuSearchParamsSchema>;

/** Normalise an awaited `searchParams` record into validated menu parameters. */
export function parseMenuSearchParams(
  params: Record<string, string | string[] | undefined>,
): MenuSearchParams {
  return menuSearchParamsSchema.parse(params);
}

/* ── catalogue DTOs (repository output) ─────────────────────────────── */

export const productImageSchema = z.object({
  secureUrl: z.url("Image URL must be valid").refine(isCloudinaryUrl, "Image must be a Cloudinary delivery URL"),
  publicId: z.string().min(1).optional(),
  alt: z.string().min(1, "Images need alternative text").max(300),
  sortOrder: z.number().int().min(0),
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
});

export const productVariantSchema = z.object({
  name: z.string().min(1).max(80),
  priceCents: z.number().int().min(1).nullable(),
});

export const dishThemeSchema = z.object({
  deep: z.string().min(1),
  base: z.string().min(1),
  accent: z.string().min(1),
});

export const productDTOSchema = z.object({
  slug: slugSchema,
  name: z.string().min(1, "Product name is required").max(120),
  category: slugSchema,
  categoryName: z.string().min(1).max(80),
  description: z.string().min(1, "Product description is required").max(4_000),
  shortDescription: z.string().max(180).nullable(),
  featured: z.boolean(),
  theme: dishThemeSchema,
  status: z.enum(["draft", "published", "archived"]),
  availability: z.enum(["available", "unavailable"]),
  currency: z.literal("CAD"),
  // Minimum 1: a configured price is never zero, and unconfigured is null.
  priceCents: z.number().int().min(1, "Configured prices must be positive").nullable(),
  variants: z.array(productVariantSchema).max(20),
  images: z.array(productImageSchema).max(10),
  tags: z.array(z.string().min(1).max(40)).max(10),
  sortOrder: z.number().int(),
});

export const categoryDTOSchema = z.object({
  slug: slugSchema,
  name: z.string().min(1).max(80),
  description: z.string().max(400),
  sortOrder: z.number().int(),
});

export type ProductDTO = z.output<typeof productDTOSchema>;
export type CategoryDTO = z.output<typeof categoryDTOSchema>;
