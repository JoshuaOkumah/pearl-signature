/**
 * PEARL Signature catalogue seed (Phase 2).
 *
 * Creates the three launch categories and the labelled preview products by
 * upserting with `$setOnInsert` ONLY: existing documents are never modified,
 * so re-running is safe and production data can never be overwritten by this
 * script. No customers, orders, or prices are ever created (preview products
 * insert with `priceCents: null`, which the UI shows as “Price to be
 * confirmed”).
 *
 * Usage:
 *   npm run seed -- --yes                 apply to the database in MONGODB_URI
 *   npm run seed -- --yes --force-production   required when NODE_ENV=production
 *
 * Configuration: MONGODB_URI is read from `.env.local` automatically (Next
 * loads it for the app; this script does the same for operators). Variables
 * already present in the environment are never overridden.
 *
 * Safety rules:
 *   - Requires an explicit `--yes` and prints the target host + database
 *     (never credentials) before connecting.
 *   - Refuses to run without MONGODB_URI.
 *   - Never drops collections or indexes; `createIndexes()` only adds what is
 *     missing (unique slug, listing indexes).
 *   - This script never runs automatically (not on build, not on startup).
 */
import mongoose from "mongoose";
import { CategoryModel } from "../src/models/category";
import { ProductModel } from "../src/models/product";
import { OrderModel } from "../src/models/order";
import { OrderAttemptModel } from "../src/models/order-attempt";
import { StoreConfigModel } from "../src/models/store-config";
import { categories } from "../src/data/categories";
import { products } from "../src/data/products";
import { loadEnvLocal } from "./load-env-local";

interface SeedArgs {
  yes: boolean;
  forceProduction: boolean;
}

export function parseArgs(argv: string[]): SeedArgs {
  return {
    yes: argv.includes("--yes"),
    forceProduction: argv.includes("--force-production"),
  };
}

/** Extract the target host + database from a connection string, no credentials. */
export function describeTarget(uri: string): { host: string; database: string } {
  try {
    const url = new URL(uri);
    const database = url.pathname.replace(/^\//, "").split("?")[0];
    return { host: url.hostname || "(unknown host)", database: database || "(no database selected)" };
  } catch {
    return { host: "(unparseable connection string)", database: "(unknown)" };
  }
}

async function seed(): Promise<void> {
  loadEnvLocal(); // .env.local matches what the docs tell operators to use
  const args = parseArgs(process.argv.slice(2));

  const uri = process.env.MONGODB_URI?.trim();
  if (!uri) {
    console.error(
      "[seed] MONGODB_URI is not configured. Set it in .env.local (see .env.example), then re-run.",
    );
    process.exitCode = 1;
    return;
  }

  const { host, database } = describeTarget(uri);
  console.log(`[seed] Target: ${host} / database "${database}"`);

  if (process.env.NODE_ENV === "production" && !args.forceProduction) {
    console.error(
      "[seed] NODE_ENV is production. Re-run with --force-production if you are certain this is intended.",
    );
    process.exitCode = 1;
    return;
  }

  if (!args.yes) {
    console.log("[seed] Dry run stopped before connecting. Re-run with --yes to apply:");
    console.log("       npm run seed -- --yes");
    return;
  }

  console.log("[seed] Connecting…");
  await mongoose.connect(uri, {
    serverSelectionTimeoutMS: 10_000,
    connectTimeoutMS: 10_000,
    autoIndex: false, // indexes are created explicitly below
  });

  try {
    let categoriesInserted = 0;
    for (const [index, category] of categories.entries()) {
      const result = await CategoryModel.updateOne(
        { slug: category.slug },
        {
          $setOnInsert: {
            name: category.name,
            slug: category.slug,
            description: category.description,
            sortOrder: index * 10,
            isActive: true,
            createdAt: new Date(),
            // `timestamps: false` disables BOTH auto-timestamps on upsert, so
            // updatedAt must be set explicitly. Without it, admin mappers
            // (which require schema-guaranteed timestamps) would reject these
            // records and the optimistic-concurrency filter would degrade.
            updatedAt: new Date(),
          },
        },
        { upsert: true, timestamps: false },
      );
      if (result.upsertedCount) categoriesInserted += 1;
    }

    const categoryIds = new Map<string, mongoose.Types.ObjectId>();
    for (const doc of await CategoryModel.find({ slug: { $in: categories.map((c) => c.slug) } }).lean()) {
      categoryIds.set(String(doc.slug), doc._id as mongoose.Types.ObjectId);
    }

    let productsInserted = 0;
    let productsSkipped = 0;
    for (const product of products) {
      const categoryId = categoryIds.get(product.category);
      if (!categoryId) {
        productsSkipped += 1;
        console.warn(`[seed] Skipped "${product.slug}": category "${product.category}" missing.`);
        continue;
      }
      const result = await ProductModel.updateOne(
        { slug: product.slug },
        {
          $setOnInsert: {
            name: product.name,
            slug: product.slug,
            shortDescription: product.shortDescription,
            description: product.description,
            categoryId,
            images: product.images,
            currency: "CAD",
            priceCents: product.priceCents, // null until the business confirms it
            variants: product.variants,
            status: product.status, // preview draft stays draft
            availability: product.availability,
            featured: product.featured,
            tags: product.tags,
            sortOrder: product.sortOrder,
            createdAt: new Date(),
            // See the category block above: `timestamps: false` means both
            // timestamps are insert-only fields we set ourselves.
            updatedAt: new Date(),
          },
        },
        { upsert: true, timestamps: false },
      );
      if (result.upsertedCount) productsInserted += 1;
    }

    // Add missing indexes only (never drops anything).
    await CategoryModel.createIndexes();
    await ProductModel.createIndexes();
    // Phase 5: orders (unique reference + idempotency key, listing indexes),
    // public order rate-limit buckets (unique key + TTL), and the singleton
    // checkout configuration.
    await OrderModel.createIndexes();
    await OrderAttemptModel.createIndexes();
    await StoreConfigModel.createIndexes();

    console.log(
      `[seed] Done. Categories: ${categories.length - categoriesInserted} existing, ` +
        `${categoriesInserted} inserted. Products: ${products.length - productsSkipped - productsInserted} existing, ` +
        `${productsInserted} inserted, ${productsSkipped} skipped.`,
    );
    console.log(`[seed] Safe to re-run: existing documents in "${database}" are left untouched.`);
  } finally {
    await mongoose.disconnect();
  }
}

seed().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  // The connection string itself never appears in mongoose's error messages,
  // but redact credentials defensively anyway.
  console.error(`[seed] Failed: ${message.replace(/\/\/[^\s/@]+@/g, "//<credentials>@")}`);
  process.exitCode = 1;
});
