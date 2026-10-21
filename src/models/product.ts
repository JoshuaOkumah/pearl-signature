import { Schema, models, model, type InferSchemaType, type Model, type Types } from "mongoose";
import { SLUG_PATTERN } from "@/lib/validations/catalogue";
import { slugify } from "@/lib/utils";

/**
 * Product schema (Phase 2).
 *
 * - Money: integer `priceCents` in CAD; `null` until the business configures
 *   it (never a fake zero). Variant prices follow the same rule.
 * - Images: Cloudinary REFERENCES only (URL + metadata). Binaries never live
 *   in MongoDB.
 * - Visibility: `status` separates draft from published; public repositories
 *   query `status: "published"` exclusively.
 * - Relationships: `categoryId` references the category document, so admin
 *   edits to names/slugs later never break existing products.
 * - Extensible for Phase 3: `stock` scaffolding exists but is unused.
 *
 * Indexes are created by the seed script / operator (`autoIndex` off).
 */

const ProductImageSchema = new Schema(
  {
    secureUrl: {
      type: String,
      required: [true, "Image URL is required"],
      trim: true,
      match: [/^https:\/\//, "Images must use HTTPS"],
    },
    publicId: {
      type: String,
      trim: true,
      default: undefined,
    },
    alt: {
      type: String,
      required: [true, "Image alternative text is required"],
      trim: true,
      maxlength: [300, "Image alt text is too long"],
    },
    sortOrder: {
      type: Number,
      default: 0,
      min: 0,
    },
    width: {
      type: Number,
      min: 1,
      default: undefined,
    },
    height: {
      type: Number,
      min: 1,
      default: undefined,
    },
  },
  { _id: false },
);

const ProductVariantSchema = new Schema(
  {
    name: {
      type: String,
      required: [true, "Variant name is required"],
      trim: true,
      maxlength: [80, "Variant name is too long"],
    },
    priceCents: {
      type: Number,
      default: null,
      // A configured price must be a real amount; unconfigured stays null.
      min: [1, "A configured price must be at least 1 cent"],
      validate: {
        validator: (value: number | null) => value === null || Number.isInteger(value),
        message: "Variant prices must be whole Canadian cents",
      },
    },
  },
  { _id: false },
);

export const ProductSchema = new Schema(
  {
    name: {
      type: String,
      required: [true, "Product name is required"],
      trim: true,
      maxlength: [120, "Product name is too long"],
    },
    slug: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      set: (value: unknown) => slugify(String(value)),
      match: [SLUG_PATTERN, "Product slug must be URL-safe"],
    },
    shortDescription: {
      type: String,
      default: null,
      trim: true,
      maxlength: [180, "Short description is too long"],
    },
    description: {
      type: String,
      required: [true, "Product description is required"],
      trim: true,
      maxlength: [4_000, "Product description is too long"],
    },
    categoryId: {
      type: Schema.Types.ObjectId,
      ref: "Category",
      required: [true, "Product category is required"],
    },
    images: {
      type: [ProductImageSchema],
      default: [],
      validate: {
        validator: (value: unknown[]) => value.length <= 10,
        message: "A product can have at most 10 images",
      },
    },
    currency: {
      type: String,
      enum: {
        values: ["CAD"],
        message: "Only CAD prices are supported",
      },
      default: "CAD",
    },
    priceCents: {
      type: Number,
      default: null,
      // No zero-dollar placeholder: configured prices are real amounts.
      min: [1, "A configured price must be at least 1 cent"],
      // Integer CAD cents only — floats never reach the storefront.
      validate: {
        validator: (value: number | null) => value === null || Number.isInteger(value),
        message: "Prices must be whole Canadian cents",
      },
    },
    variants: {
      type: [ProductVariantSchema],
      default: [],
      validate: {
        validator: (value: unknown[]) => value.length <= 20,
        message: "A product can have at most 20 variants",
      },
    },
    status: {
      type: String,
      enum: ["draft", "published"],
      default: "draft",
    },
    availability: {
      type: String,
      enum: ["available", "unavailable"],
      default: "available",
    },
    stock: {
      type: new Schema(
        {
          tracked: { type: Boolean, default: false },
          quantity: { type: Number, default: null },
        },
        { _id: false },
      ),
      default: () => ({}),
    },
    featured: {
      type: Boolean,
      default: false,
    },
    tags: {
      type: [String],
      default: [],
      validate: {
        validator: (value: string[]) => value.length <= 10 && value.every((tag) => tag.length <= 40),
        message: "Tags are limited to 10 entries of 40 characters",
      },
    },
    sortOrder: {
      type: Number,
      default: 0,
    },
  },
  {
    timestamps: true,
    collection: "products",
  },
);

/* Listing indexes (published products, by category, featured) */
ProductSchema.index({ status: 1, sortOrder: 1 });
ProductSchema.index({ status: 1, categoryId: 1, sortOrder: 1 });
ProductSchema.index({ status: 1, featured: 1, sortOrder: 1 });

export type ProductRecord = InferSchemaType<typeof ProductSchema> & {
  _id: Types.ObjectId;
  categoryId: Types.ObjectId;
  createdAt?: Date;
  updatedAt?: Date;
};

export const ProductModel: Model<ProductRecord> =
  (models.Product as Model<ProductRecord> | undefined) ?? model<ProductRecord>("Product", ProductSchema);
