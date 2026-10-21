import { Schema, models, model, type InferSchemaType, type Model } from "mongoose";
import { SLUG_PATTERN } from "@/lib/validations/catalogue";
import { slugify } from "@/lib/utils";

/**
 * Category schema (Phase 2).
 *
 * Collection: `categories`. Slugs are unique, URL-safe and normalised at
 * write time; `isActive` hides a category from public surfaces without
 * deleting it (products keep their reference).
 *
 * Indexes are created by the seed script / operator (`autoIndex` is off in
 * the application connection).
 */

export const CategorySchema = new Schema(
  {
    name: {
      type: String,
      required: [true, "Category name is required"],
      trim: true,
      maxlength: [80, "Category name is too long"],
    },
    slug: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      // Normalise any input (e.g. "Traditional Foods") into a URL-safe slug.
      set: (value: unknown) => slugify(String(value)),
      match: [SLUG_PATTERN, "Category slug must be URL-safe"],
    },
    description: {
      type: String,
      default: "",
      maxlength: [400, "Category description is too long"],
    },
    sortOrder: {
      type: Number,
      default: 0,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
  },
  {
    timestamps: true,
    collection: "categories",
  },
);

CategorySchema.index({ isActive: 1, sortOrder: 1 });

export type CategoryRecord = InferSchemaType<typeof CategorySchema> & { _id: import("mongoose").Types.ObjectId };

export const CategoryModel: Model<CategoryRecord> =
  (models.Category as Model<CategoryRecord> | undefined) ?? model<CategoryRecord>("Category", CategorySchema);
