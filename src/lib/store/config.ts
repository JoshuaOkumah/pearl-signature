import "server-only";
import { connectDatabase, logDatabaseError } from "@/lib/db/mongoose";
import { StoreConfigModel, type StoreConfigRecord } from "@/models/store-config";
import {
  EMPTY_CHECKOUT_SETTINGS,
  UNAVAILABLE_CHECKOUT_SETTINGS,
  normalizeCheckoutSettings,
  type CheckoutSettings,
} from "@/lib/validations/store-config";

/**
 * Store configuration reads (Phase 5).
 *
 * Three outcomes, all honest:
 *
 *  1. The document exists → its sanitised public projection.
 *  2. No document yet (fresh deployment) → `EMPTY_CHECKOUT_SETTINGS`:
 *     readable, but intake closed and every business decision still pending.
 *  3. The database cannot be reached → `UNAVAILABLE_CHECKOUT_SETTINGS`,
 *     which blocks checkout with a "temporarily unavailable" reason rather
 *     than pretending the business has configured anything.
 *
 * A malformed record degrades inside `normalizeCheckoutSettings` — a broken
 * tax block becomes `unconfigured` (blocking), never a silent zero.
 */

export async function getCheckoutSettings(): Promise<CheckoutSettings> {
  try {
    await connectDatabase();
    const record = await StoreConfigModel.findById("checkout").lean();
    if (!record) return EMPTY_CHECKOUT_SETTINGS;
    return normalizeCheckoutSettings(record);
  } catch (error) {
    logDatabaseError("store-config", error);
    return UNAVAILABLE_CHECKOUT_SETTINGS;
  }
}

/**
 * Raw record for the admin settings form, with the optimistic-concurrency
 * token. Returns `null` when the database cannot be reached (the caller
 * shows the error state) and a fresh empty value when nothing is configured
 * yet (the caller shows the defaults).
 */
export async function getStoreConfigRecord(): Promise<
  { record: Partial<StoreConfigRecord>; updatedAt: string | null } | { error: true }
> {
  try {
    await connectDatabase();
    const record = await StoreConfigModel.findById("checkout").lean();
    if (!record) return { record: {}, updatedAt: null };
    return { record, updatedAt: record.updatedAt?.toISOString() ?? null };
  } catch (error) {
    logDatabaseError("store-config-admin", error);
    return { error: true };
  }
}
