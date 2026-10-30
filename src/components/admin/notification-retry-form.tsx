"use client";

import { useActionState } from "react";
import { Loader2, RotateCw } from "lucide-react";
import {
  retryNotificationAction,
  type NotificationRetryResult,
} from "@/lib/actions/admin-notifications";
import { Button } from "@/components/ui/button";

/**
 * Retry control for one failed notification (Phase 7).
 *
 * The form carries the outbox id and nothing else, so the server action can
 * never be tricked into sending arbitrary content or to an arbitrary address.
 */

const INITIAL: NotificationRetryResult = { ok: false };

export function NotificationRetryForm({ id }: { id: string }) {
  const [state, action, pending] = useActionState(retryNotificationAction, INITIAL);

  return (
    <form action={action} className="flex flex-col items-start gap-1.5">
      <input type="hidden" name="id" value={id} />
      <Button type="submit" variant="outline" size="sm" disabled={pending}>
        {pending ? (
          <Loader2 className="size-4 animate-spin" aria-hidden="true" />
        ) : (
          <RotateCw className="size-4" aria-hidden="true" />
        )}
        {pending ? "Requeueing" : "Retry"}
      </Button>
      {state.error ? (
        <p role="alert" className="font-sans text-xs text-terracotta-700">
          {state.error}
        </p>
      ) : null}
      {state.message ? (
        <p className="font-sans text-xs text-leaf-700">{state.message}</p>
      ) : null}
    </form>
  );
}
