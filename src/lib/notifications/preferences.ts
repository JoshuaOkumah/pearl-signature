import "server-only";
import { connectDatabase, logDatabaseError } from "@/lib/db/mongoose";
import { StoreConfigModel } from "@/models/store-config";

/**
 * Customer-email preferences (Phase 7).
 *
 * Only the nonessential `preparing` update can be muted. Every essential
 * message (order received, confirmed, ready, out for delivery, completed,
 * cancelled and all payment messages) is always sent, so this reader can never
 * silently suppress a critical notification.
 *
 * A database read failure returns the safe default (`true`): a preference that
 * cannot be read must not turn a status email into a silent drop.
 */
export async function preparingUpdateEnabled(): Promise<boolean> {
  try {
    await connectDatabase();
    const record = await StoreConfigModel.findById("checkout")
      .select({ "notifications.preparingUpdateEnabled": 1 })
      .lean();
    return record?.notifications?.preparingUpdateEnabled !== false;
  } catch (error) {
    logDatabaseError("notification-preferences", error);
    return true;
  }
}
