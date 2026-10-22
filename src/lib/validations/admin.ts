import { z } from "zod";
import { SLUG_PATTERN, MAX_SLUG_LENGTH } from "@/lib/validations/catalogue";
import { slugify } from "@/lib/utils";

/**
 * Admin-side validation (Phase 3).
 *
 * Every Server Action parses its payload with a schema from this file
 * BEFORE touching the database, and the parsed output is the complete
 * allowlist of writable fields — nothing else from the request body is
 * ever spread into a mutation (mass-assignment protection).
 *
 * Admin search deliberately differs from the public title-first search:
 * operators need plain case-insensitive substring matching over names,
 * which is only ever applied to the admin list (never to public reads).
 */

/* ── money: CAD strings ⇄ integer cents, no floating point ──────────── */

export const MAX_PRICE_CENTS = 99_999_999; // $999,999.99

/** Strict money shape: optional $, whole digits, max 2 decimals. */
const CAD_PATTERN = /^\$?\d{1,6}(\.\d{1,2})?$/;

/**
 * Parse a human CAD entry ("12", "12.5", "$12.50") into integer cents
 * using integer arithmetic only. Returns `null` for an empty input
 * (unconfigured price) and `undefined` for malformed input.
 */
export function parseCadInput(raw: string): number | null | undefined {
  const value = raw.trim();
  if (value === "") return null;
  if (!CAD_PATTERN.test(value)) return undefined;
  const [whole, fraction = ""] = value.replace(/^\$/, "").split(".");
  const cents = Number(whole) * 100 + Number(`${fraction}00`.slice(0, 2));
  if (!Number.isSafeInteger(cents) || cents < 1 || cents > MAX_PRICE_CENTS) return undefined;
  return cents;
}

/** Render stored cents back into the admin input format ("1250" → "12.50"). */
export function formatCadInput(cents: number | null | undefined): string {
  if (typeof cents !== "number" || !Number.isInteger(cents) || cents < 1) return "";
  const dollars = Math.floor(cents / 100);
  const remainder = String(cents % 100).padStart(2, "0");
  return `${dollars}.${remainder}`;
}

/** Money input field: "" → null (unconfigured); validated text → integer cents. */
export const moneyInputSchema = z
  .string()
  .trim()
  .max(16, "Price is too long")
  .refine((value) => value === "" || CAD_PATTERN.test(value), {
    message: "Enter a price like 12.50 (up to two decimal places)",
  })
  .transform((value) => (value === "" ? null : parseCadInput(value)))
  .refine(
    (cents) =>
      cents === null ||
      (typeof cents === "number" && Number.isInteger(cents) && cents >= 1 && cents <= MAX_PRICE_CENTS),
    { message: "Price must be between $0.01 and $999,999.99" },
  );

/* ── shared primitives ──────────────────────────────────────────────── */

const OBJECT_ID_PATTERN = /^[0-9a-fA-F]{24}$/;
export const objectIdSchema = z
  .string()
  .trim()
  .regex(OBJECT_ID_PATTERN, "Not a valid identifier");

const adminSlugSchema = z
  .string()
  .trim()
  .max(MAX_SLUG_LENGTH, "Slug is too long")
  .regex(SLUG_PATTERN, "Slug must contain only lowercase letters, numbers and hyphens");

/** Normalise optional text: empty → null. */
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `Must be at most ${max} characters`)
    .transform((value) => (value === "" ? null : value));

/* ── authentication ─────────────────────────────────────────────────── */

export const loginSchema = z.object({
  email: z
    .string()
    .trim()
    .toLowerCase()
    .min(1, "Email is required")
    .max(160, "Email is too long")
    .refine((value) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value), "Enter a valid email"),
  password: z.string().min(1, "Password is required").max(200, "Password is too long"),
});

export type LoginInput = z.output<typeof loginSchema>;

/* ── product form ───────────────────────────────────────────────────── */

export const variantInputSchema = z.object({
  name: z.string().trim().min(1, "Variant name is required").max(80, "Variant name is too long"),
  price: moneyInputSchema,
});

/** Comma-separated tags string → trimmed, deduplicated tag list. */
const tagsInput = z
  .string()
  .trim()
  .max(600, "Tags are too long")
  .transform((value) =>
    value === ""
      ? []
      : [...new Set(value.split(",").map((tag) => tag.trim()).filter(Boolean))],
  )
  .refine((tags) => tags.length <= 10, "Use at most 10 tags")
  .refine((tags) => tags.every((tag) => tag.length <= 40), "Tags must be 40 characters or fewer");

export const productFormSchema = z.object({
  name: z.string().trim().min(1, "Product name is required").max(120, "Name is too long"),
  /** Blank → derived from the name; otherwise normalised and checked. */
  slug: z
    .string()
    .trim()
    .max(MAX_SLUG_LENGTH, "Slug is too long")
    .optional()
    .transform((value) => (value ? slugify(value) : ""))
    .refine((value) => value === "" || SLUG_PATTERN.test(value), "Slug must be URL-safe"),
  categoryId: objectIdSchema,
  shortDescription: optionalText(180),
  description: z.string().trim().min(1, "Description is required").max(4_000, "Description is too long"),
  price: moneyInputSchema,
  variants: z.array(variantInputSchema).max(20, "At most 20 variants"),
  status: z.enum(["draft", "published"], {
    message: "Status must be draft or published",
  }),
  availability: z.enum(["available", "unavailable"]),
  featured: z.boolean(),
  sortOrder: z.coerce
    .number({ message: "Display order must be a number" })
    .int("Display order must be a whole number")
    .min(-10_000)
    .max(10_000),
  tags: tagsInput,
  /** Optimistic-concurrency token: the updatedAt the editor loaded. */
  expectedUpdatedAt: z.string().trim().max(40).optional().catch(undefined),
});

export type ProductFormInput = z.output<typeof productFormSchema>;

/* ── category form ──────────────────────────────────────────────────── */

export const categoryFormSchema = z.object({
  name: z.string().trim().min(1, "Category name is required").max(80, "Name is too long"),
  /** Empty on create (derived); on edit, blank keeps the existing slug. */
  slug: adminSlugSchema.optional().or(z.literal("")).catch(""),
  description: z.string().trim().max(400, "Description is too long"),
  sortOrder: z.coerce
    .number({ message: "Display order must be a number" })
    .int("Display order must be a whole number")
    .min(-10_000)
    .max(10_000),
  isActive: z.boolean(),
});

export type CategoryFormInput = z.output<typeof categoryFormSchema>;

/* ── admin product list query ───────────────────────────────────────── */

export const ADMIN_PAGE_SIZES = [10, 20, 50] as const;
export const ADMIN_DEFAULT_PAGE_SIZE = 20;
export const ADMIN_SORTS = ["updated", "created", "name", "price"] as const;
export type AdminSort = (typeof ADMIN_SORTS)[number];

export const adminProductQuerySchema = z.object({
  search: z.string().trim().max(100).optional().catch(undefined),
  category: z.string().trim().max(120).optional().catch(undefined),
  status: z.enum(["draft", "published", "archived"]).optional().catch(undefined),
  availability: z.enum(["available", "unavailable"]).optional().catch(undefined),
  sort: z.enum(ADMIN_SORTS).optional().catch("updated"),
  page: z.coerce.number().int().min(1).max(10_000).optional().catch(1),
  pageSize: z.coerce.number().int().min(1).max(50).optional().catch(ADMIN_DEFAULT_PAGE_SIZE),
});

export type AdminProductQuery = z.output<typeof adminProductQuerySchema>;

/* ── image association payloads (after Cloudinary verification) ─────── */

export const imageAltSchema = z.string().trim().min(1, "Alt text is required").max(300);

/** Public id accepted for verification — strict charset (folders/slashes ok). */
export const cloudinaryPublicIdSchema = z
  .string()
  .trim()
  .min(3)
  .max(250)
  .regex(/^[a-z0-9][a-z0-9/_\-.]*$/i, "Invalid image identifier");
