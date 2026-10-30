"use server";

import { revalidatePath } from "next/cache";
import { recordAudit } from "@/lib/auth/audit";
import { requireActionAdmin } from "@/lib/auth/guard";
import { retryNotificationById } from "@/lib/notifications/dispatch";

/**
 * Operator retry for a failed or uncertain notification (Phase 7).
 *
 * The form accepts ONE field: the outbox entry id. The original event, order
 * and recipient role are preserved, so an operator can never inject a
 * recipient, a subject or a body. Only `failed` and `uncertain` entries are
 * eligible; the dispatcher re-checks that server-side.
 *
 * Requeueing is the whole action. Delivery still happens through the processor
 * (scheduled or `npm run notifications:process`), which keeps the admin action
 * fast and keeps sending out of the request path.
 */

export interface NotificationRetryResult {
  ok: boolean;
  error?: string;
  message?: string;
}

const OBJECT_ID = /^[a-f0-9]{24}$/i;

export async function retryNotificationAction(
  _previous: NotificationRetryResult,
  formData: FormData,
): Promise<NotificationRetryResult> {
  const guard = await requireActionAdmin();
  if (!guard.ok) return { ok: false, error: "Your session has expired. Sign in again." };

  const id = String(formData.get("id") ?? "").trim();
  if (!OBJECT_ID.test(id)) {
    return { ok: false, error: "This notification could not be found." };
  }

  try {
    const outcome = await retryNotificationById(id);
    if (outcome === "requeued") {
      await recordAudit({
        event: "notification.retried",
        outcome: "success",
        adminId: String(guard.admin._id),
        email: guard.admin.email,
        target: { type: "notification", id, label: "Notification" },
        detail: "Failed notification returned to the delivery queue",
      });
      revalidatePath("/admin/notifications");
      return {
        ok: true,
        message: "The notification is back in the queue. The processor will attempt it on its next run.",
      };
    }
    return {
      ok: false,
      error:
        outcome === "not_eligible"
          ? "Only failed or uncertain notifications can be retried."
          : "This notification could not be found.",
    };
  } catch {
    return { ok: false, error: "The retry could not be saved. Try again." };
  }
}
