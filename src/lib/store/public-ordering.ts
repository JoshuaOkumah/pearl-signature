import "server-only";
import { cache } from "react";
import { io } from "next/cache";
import { getCheckoutSettings } from "@/lib/store/config";
import { stripeReadiness } from "@/lib/payments/stripe";
import { orderingCopy, type OrderingCopy } from "@/lib/store/ordering-copy";

/**
 * Request-time ordering copy for the public storefront.
 *
 * The storefront renders this inside Suspense boundaries, so `io()` marks the
 * read as request-time work: no database access happens during the build, and
 * an owner who opens intake or enables delivery sees the change on the next
 * request without a redeploy.
 *
 * `cache()` deduplicates the read across every boundary on the same request
 * (hero facts, menu badge, ordering steps, FAQ), so the page performs one
 * store-config query rather than four.
 *
 * Online payment is only advertised when the Stripe gates actually pass, using
 * the same readiness check as checkout itself.
 */
export const getPublicOrderingCopy = cache(async (): Promise<OrderingCopy> => {
  await io();
  const settings = await getCheckoutSettings();
  return orderingCopy({
    ...settings,
    onlinePaymentsAvailable:
      settings.available && settings.onlinePaymentsEnabled && stripeReadiness().ready,
  });
});
