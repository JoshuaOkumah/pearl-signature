import "server-only";
import { Types } from "mongoose";
import { connectDatabase, logDatabaseError } from "@/lib/db/mongoose";
import { CategoryModel, type CategoryRecord } from "@/models/category";
import { OrderModel, type OrderRecord } from "@/models/order";
import { ProductModel, type ProductRecord } from "@/models/product";
import { formatCadInput } from "@/lib/validations/admin";
import { escapeRegExp } from "@/lib/search";
import {
  ADMIN_DEFAULT_PAGE_SIZE,
  type AdminOrderQuery,
  type AdminProductQuery,
  type AdminSort,
} from "@/lib/validations/admin";
import {
  ORDER_REFERENCE_PATTERN,
  type OrderStatus,
  type PaymentStatus,
} from "@/lib/validations/order";
import type { FulfillmentMethod } from "@/lib/validations/checkout";
import type { ProductStatus } from "@/types";

/**
 * Admin-side reads (Phase 3).
 *
 * Deliberately separate from the public funnel in
 * `src/lib/repositories/catalogue.ts`: admin queries may include drafts,
 * archived items and disabled categories, and use plain operator search
 * (case-insensitive substring over names). Nothing here is ever called
 * from a public page — every caller sits behind `requirePageAdmin()` or
 * `requireActionAdmin()`.
 *
 * All shapes leaving this module are hand-picked plain objects (never raw
 * Mongoose documents, never `passwordHash` or session material).
 */

export interface AdminProductRow {
  id: string;
  name: string;
  slug: string;
  categoryId: string;
  categoryName: string;
  status: ProductStatus;
  availability: "available" | "unavailable";
  /** Pre-formatted for the table ("12.50") or "" when unconfigured. */
  priceInput: string;
  featured: boolean;
  imageCount: number;
  thumbnailUrl: string | null;
  updatedAt: string;
}

export interface AdminProductList {
  rows: AdminProductRow[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export interface AdminCategoryRow {
  id: string;
  name: string;
  slug: string;
  description: string;
  sortOrder: number;
  isActive: boolean;
  productCount: number;
}

export interface DashboardStats {
  totalProducts: number;
  publishedProducts: number;
  draftProducts: number;
  archivedProducts: number;
  unavailableProducts: number;
  totalCategories: number;
  activeCategories: number;
  recentProducts: Array<{
    id: string;
    name: string;
    status: ProductStatus;
    availability: "available" | "unavailable";
    updatedAt: string;
  }>;
  /**
   * Real order metrics (Phase 5), aggregated from `orders` records only.
   *
   * `collectedCents` counts ONLY orders whose payment status is `paid`:
   * an unpaid Cash on Arrival order is money the store has NOT received,
   * so it lives in `unpaidCents` (outstanding) and never in collected
   * revenue.
   */
  orders: {
    total: number;
    /** Placed → out for delivery (not yet completed or cancelled). */
    inProgress: number;
    awaitingPayment: number;
    unpaidCents: number;
    collectedCents: number;
  };
  recentOrders: Array<{
    reference: string;
    customerName: string;
    status: OrderStatus;
    paymentStatus: PaymentStatus;
    totalCents: number;
    placedAtIso: string;
  }>;
}

/** Parse an id defensively — invalid input becomes `null`, never a throw. */
export function parseObjectId(id: string): Types.ObjectId | null {
  if (!/^[0-9a-fA-F]{24}$/.test(id)) return null;
  try {
    return new Types.ObjectId(id);
  } catch {
    return null;
  }
}

function safe<T>(scope: string, fallback: T, run: () => Promise<T>): Promise<T> {
  return run().catch((error: unknown) => {
    logDatabaseError(scope, error);
    return fallback;
  });
}

function rowFromRecord(record: ProductRecord, categoryName: string): AdminProductRow {
  const primary = [...record.images].sort((a, b) => a.sortOrder - b.sortOrder)[0];
  return {
    id: String(record._id),
    name: record.name,
    slug: record.slug,
    categoryId: String(record.categoryId),
    categoryName,
    status: record.status,
    availability: record.availability,
    priceInput: formatCadInput(record.priceCents),
    featured: record.featured,
    imageCount: record.images.length,
    thumbnailUrl: primary?.secureUrl ?? null,
    // Non-null: the product model uses `timestamps: true`, so persisted
    // records always carry these. (No `?? new Date()` fallback: an
    // unstable value must never enter a prerender path.)
    updatedAt: record.updatedAt!.toISOString(),
  };
}

const sortSpec: Record<AdminSort, Record<string, 1 | -1>> = {
  updated: { updatedAt: -1, _id: -1 },
  created: { createdAt: -1, _id: -1 },
  name: { name: 1, _id: 1 },
  price: { priceCents: 1, _id: 1 },
};

/**
 * Paginated admin product list with search + filters. Pagination happens
 * in MongoDB after all criteria, so counts are true matches.
 */
export async function listAdminProducts(query: AdminProductQuery): Promise<AdminProductList | null> {
  return safe("admin-list-products", null, async () => {
    await connectDatabase();

    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? ADMIN_DEFAULT_PAGE_SIZE;

    const { categories, categoryMap } = await loadAdminCategoryMap();
    const filter: Record<string, unknown> = {};

    if (query.search) {
      const term = escapeRegExp(query.search.slice(0, 100));
      // Operator search: plain case-insensitive substring over the NAME.
      filter.name = new RegExp(term, "i");
    }
    if (query.status) filter.status = query.status;
    if (query.availability) filter.availability = query.availability;
    if (query.category) {
      const match = categories.find((category) => category.slug === query.category);
      if (!match) return { rows: [], total: 0, page: 1, pageSize, totalPages: 1 };
      filter.categoryId = new Types.ObjectId(match.id);
    }

    const sort = sortSpec[query.sort ?? "updated"];

    const [records, total] = await Promise.all([
      ProductModel.find(filter)
        .sort(sort)
        .skip((page - 1) * pageSize)
        .limit(pageSize)
        .lean(),
      ProductModel.countDocuments(filter),
    ]);

    const rows = records.map((record) =>
      rowFromRecord(record, categoryMap.get(String(record.categoryId)) ?? "Uncategorised"),
    );
    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    return { rows, total, page, pageSize, totalPages };
  });
}

/** Single product for the edit form (raw-ish but hand-picked fields). */
export interface AdminProductDetail extends AdminProductRow {
  shortDescription: string | null;
  description: string;
  priceCents: number | null;
  variants: Array<{ name: string; priceInput: string }>;
  images: Array<{
    secureUrl: string;
    publicId?: string;
    alt: string;
    sortOrder: number;
    width?: number;
    height?: number;
  }>;
  tags: string[];
  sortOrder: number;
  createdAt: string;
}

export async function getAdminProduct(id: string): Promise<AdminProductDetail | null> {
  const objectId = parseObjectId(id);
  if (!objectId) return null;

  return safe("admin-get-product", null, async () => {
    await connectDatabase();
    const record = await ProductModel.findById(objectId).lean();
    if (!record) return null;
    const { categoryMap } = await loadAdminCategoryMap();
    const base = rowFromRecord(record, categoryMap.get(String(record.categoryId)) ?? "Uncategorised");
    return {
      ...base,
      shortDescription: record.shortDescription ?? null,
      description: record.description,
      priceCents: record.priceCents ?? null,
      variants: record.variants.map((variant) => ({
        name: variant.name,
        priceInput: formatCadInput(variant.priceCents),
      })),
      images: record.images.map((image) => ({
        secureUrl: image.secureUrl,
        ...(image.publicId ? { publicId: image.publicId } : {}),
        alt: image.alt,
        sortOrder: image.sortOrder,
        ...(image.width ? { width: image.width } : {}),
        ...(image.height ? { height: image.height } : {}),
      })),
      tags: [...record.tags],
      sortOrder: record.sortOrder,
      createdAt: record.createdAt!.toISOString(),
    };
  });
}

/** Categories for admin selects and the category page (includes disabled). */
export async function listAdminCategories(): Promise<AdminCategoryRow[] | null> {
  return safe("admin-list-categories", null, async () => {
    await connectDatabase();
    const [categories, counts] = await Promise.all([
      CategoryModel.find().sort({ sortOrder: 1, name: 1 }).lean(),
      productCountsByCategory(),
    ]);
    return categories.map((category) => ({
      id: String(category._id),
      name: category.name,
      slug: category.slug,
      description: category.description,
      sortOrder: category.sortOrder,
      isActive: category.isActive,
      productCount: counts.get(String(category._id)) ?? 0,
    }));
  });
}

async function productCountsByCategory(): Promise<Map<string, number>> {
  const grouped = await ProductModel.aggregate<{ _id: Types.ObjectId; count: number }>([
    { $group: { _id: "$categoryId", count: { $sum: 1 } } },
  ]);
  return new Map(grouped.map((entry) => [String(entry._id), entry.count]));
}

async function loadAdminCategoryMap(): Promise<{
  categories: Array<{ id: string; slug: string; name: string; isActive: boolean }>;
  categoryMap: Map<string, string>;
}> {
  const categories: CategoryRecord[] = await CategoryModel.find()
    .sort({ sortOrder: 1, name: 1 })
    .lean();
  const rows = categories.map((category) => ({
    id: String(category._id),
    slug: category.slug,
    name: category.name,
    isActive: category.isActive,
  }));
  return {
    categories: rows,
    categoryMap: new Map(rows.map((row) => [row.id, row.name])),
  };
}

/** Category options for selects (create/edit forms). */
export async function listCategoryOptions(): Promise<
  Array<{ id: string; name: string; slug: string; isActive: boolean }> | null
> {
  return safe("admin-category-options", null, async () => {
    await connectDatabase();
    const categories = await CategoryModel.find().sort({ sortOrder: 1, name: 1 }).lean();
    return categories.map((category) => ({
      id: String(category._id),
      name: category.name,
      slug: category.slug,
      isActive: category.isActive,
    }));
  });
}

/** Real dashboard counters — no invented metrics of any kind. */
export async function getDashboardStats(): Promise<DashboardStats | null> {
  return safe("admin-stats", null, async () => {
    await connectDatabase();
    const [
      totalProducts,
      publishedProducts,
      draftProducts,
      archivedProducts,
      unavailableProducts,
      categories,
      recent,
      paymentGroups,
      ordersInProgress,
      recentOrders,
    ] = await Promise.all([
      ProductModel.countDocuments({}),
      ProductModel.countDocuments({ status: "published" }),
      ProductModel.countDocuments({ status: "draft" }),
      ProductModel.countDocuments({ status: "archived" }),
      ProductModel.countDocuments({ availability: "unavailable", status: { $ne: "archived" } }),
      CategoryModel.find().select({ _id: 1, isActive: 1 }).lean(),
      ProductModel.find()
        .sort({ updatedAt: -1 })
        .limit(5)
        .select({ name: 1, status: 1, availability: 1, updatedAt: 1 })
        .lean(),
      // Money totals grouped by PAYMENT state, so collected revenue can
      // never include an order the store has not been paid for.
      OrderModel.aggregate<{ _id: PaymentStatus; count: number; cents: number }>([
        { $group: { _id: "$payment.status", count: { $sum: 1 }, cents: { $sum: "$money.totalCents" } } },
      ]),
      OrderModel.countDocuments({ status: { $nin: ["completed", "cancelled"] } }),
      OrderModel.find()
        .sort({ createdAt: -1, _id: -1 })
        .limit(5)
        .select({
          reference: 1,
          "customer.fullName": 1,
          status: 1,
          "payment.status": 1,
          "money.totalCents": 1,
          createdAt: 1,
        })
        .lean(),
    ]);

    const paid = paymentGroups.find((group) => group._id === "paid");
    const unpaid = paymentGroups.find((group) => group._id === "unpaid");

    return {
      totalProducts,
      publishedProducts,
      draftProducts,
      archivedProducts,
      unavailableProducts,
      totalCategories: categories.length,
      activeCategories: categories.filter((category) => category.isActive).length,
      recentProducts: recent.map((record) => ({
        id: String(record._id),
        name: record.name,
        status: record.status,
        availability: record.availability,
        updatedAt: record.updatedAt!.toISOString(),
      })),
      orders: {
        total: (paid?.count ?? 0) + (unpaid?.count ?? 0),
        inProgress: ordersInProgress,
        awaitingPayment: unpaid?.count ?? 0,
        unpaidCents: unpaid?.cents ?? 0,
        collectedCents: paid?.cents ?? 0,
      },
      recentOrders: recentOrders.map((record) => ({
        reference: record.reference,
        customerName: record.customer.fullName,
        status: record.status,
        paymentStatus: record.payment.status,
        totalCents: record.money.totalCents,
        placedAtIso: new Date(record.createdAt).toISOString(),
      })),
    };
  });
}

/* ── orders (Phase 5) ───────────────────────────────────────────────── */

export interface AdminOrderRow {
  reference: string;
  customerName: string;
  customerEmail: string;
  method: FulfillmentMethod;
  status: OrderStatus;
  paymentStatus: PaymentStatus;
  totalCents: number;
  itemCount: number;
  placedAtIso: string;
}

export interface AdminOrderList {
  rows: AdminOrderRow[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export interface AdminOrderDetail extends AdminOrderRow {
  phone: string;
  address: {
    line1: string;
    line2: string | null;
    city: string;
    province: string;
    postalCode: string;
  } | null;
  instructions: string | null;
  customerNotes: string | null;
  serviceAreaLabel: string | null;
  pickupInstructions: string | null;
  items: Array<{
    name: string;
    variantName: string | null;
    quantity: number;
    unitPriceCents: number;
    lineTotalCents: number;
  }>;
  money: {
    currency: "CAD";
    subtotalCents: number;
    deliveryFeeCents: number;
    taxCents: number;
    totalCents: number;
    taxLabel: string | null;
    taxRateBps: number | null;
  };
  payment: {
    method: "cash_on_arrival";
    status: PaymentStatus;
    paidAtIso: string | null;
    paidByLabel: string | null;
  };
  statusHistory: Array<{
    from: OrderStatus | null;
    to: OrderStatus;
    atIso: string;
    note: string | null;
  }>;
  adminNotes: Array<{ body: string; atIso: string }>;
  cancellationReason: string | null;
  version: number;
  updatedAtIso: string;
}

function orderRowFromRecord(record: OrderRecord): AdminOrderRow {
  return {
    reference: record.reference,
    customerName: record.customer.fullName,
    customerEmail: record.customer.email,
    method: record.fulfillment.method,
    status: record.status,
    paymentStatus: record.payment.status,
    totalCents: record.money.totalCents,
    itemCount: record.items.length,
    placedAtIso: new Date(record.createdAt).toISOString(),
  };
}

/**
 * Paginated admin order list. Filtering happens in MongoDB (so the count
 * and pagination are true matches) and the operator's search term is
 * escaped before it becomes a regular expression — a reference search full
 * of metacharacters matches literally instead of throwing.
 */
export async function listAdminOrders(query: AdminOrderQuery): Promise<AdminOrderList | null> {
  return safe("admin-list-orders", null, async () => {
    await connectDatabase();

    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? ADMIN_DEFAULT_PAGE_SIZE;

    const filter: Record<string, unknown> = {};
    if (query.search) {
      const pattern = new RegExp(escapeRegExp(query.search.slice(0, 100)), "i");
      filter.$or = [
        { reference: pattern },
        { "customer.fullName": pattern },
        { "customer.email": pattern },
      ];
    }
    if (query.status) filter.status = query.status;
    if (query.payment) filter["payment.status"] = query.payment;

    const [records, total] = await Promise.all([
      OrderModel.find(filter)
        .sort({ createdAt: -1, _id: -1 })
        .skip((page - 1) * pageSize)
        .limit(pageSize)
        .lean(),
      OrderModel.countDocuments(filter),
    ]);

    const rows = records.map(orderRowFromRecord);
    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    return { rows, total, page, pageSize, totalPages };
  });
}

/** One order for the detail screen (everything it renders, nothing else). */
export async function getAdminOrder(reference: string): Promise<AdminOrderDetail | null> {
  const normalized = reference.trim().toUpperCase();
  // A malformed reference never reaches a query.
  if (!ORDER_REFERENCE_PATTERN.test(normalized)) return null;

  return safe("admin-get-order", null, async () => {
    await connectDatabase();
    const record = await OrderModel.findOne({ reference: normalized }).lean();
    if (!record) return null;
    return {
      ...orderRowFromRecord(record),
      phone: record.customer.phone,
      address: record.fulfillment.address
        ? {
            line1: record.fulfillment.address.line1,
            line2: record.fulfillment.address.line2 ?? null,
            city: record.fulfillment.address.city,
            province: record.fulfillment.address.province,
            postalCode: record.fulfillment.address.postalCode,
          }
        : null,
      instructions: record.fulfillment.instructions ?? null,
      customerNotes: record.fulfillment.notes ?? null,
      serviceAreaLabel: record.fulfillment.serviceAreaLabel ?? null,
      pickupInstructions: record.fulfillment.pickupInstructions ?? null,
      items: record.items.map((item) => ({
        name: item.name,
        variantName: item.variantName ?? null,
        quantity: item.quantity,
        unitPriceCents: item.unitPriceCents,
        lineTotalCents: item.lineTotalCents,
      })),
      money: {
        currency: "CAD",
        subtotalCents: record.money.subtotalCents,
        deliveryFeeCents: record.money.deliveryFeeCents,
        taxCents: record.money.taxCents,
        totalCents: record.money.totalCents,
        taxLabel: record.money.taxLabel ?? null,
        taxRateBps: record.money.taxRateBps ?? null,
      },
      payment: {
        method: record.payment.method,
        status: record.payment.status,
        paidAtIso: record.payment.paidAt ? new Date(record.payment.paidAt).toISOString() : null,
        paidByLabel: record.payment.paidByLabel ?? null,
      },
      statusHistory: record.statusHistory.map((event) => ({
        from: event.from ?? null,
        to: event.to,
        atIso: new Date(event.at).toISOString(),
        note: event.note ?? null,
      })),
      adminNotes: record.notes.map((note) => ({
        body: note.body,
        atIso: new Date(note.at).toISOString(),
      })),
      cancellationReason: record.cancellationReason ?? null,
      version: record.version,
      updatedAtIso: new Date(record.updatedAt).toISOString(),
    };
  });
}

/**
 * Visibility policy reference for the admin UI (also used by tests):
 * - published + active category → public listing/search/detail
 * - draft / archived → never public
 * - published but unavailable → public card with unavailable state
 *
 * The constant itself lives in `src/lib/admin-policy.ts`, which is safe for
 * client components to import (this repository module is server-only).
 */
export { CATEGORY_VISIBILITY_POLICY } from "@/lib/admin-policy";
