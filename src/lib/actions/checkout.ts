"use server";

import { getCheckoutSettings } from "@/lib/store/config";
import type { CheckoutSettings } from "@/lib/validations/store-config";
import { stripeReadiness } from "@/lib/payments/stripe";

/**
 * Public checkout settings (Phase 5).
 *
 * Read-only and intentionally tiny: the checkout client needs to know which
 * fulfilment methods exist, which areas are served with which fee, and how
 * tax is configured, in order to show a truthful price before submission.
 *
 * Everything returned is information the business publishes to customers
 * anyway (service areas and their prices). Nothing admin-private, no
 * database ids, no customer data. Server Actions are per-request POSTs, so
 * the response never enters a shared cache.
 */
export async function getCheckoutSettingsAction(): Promise<CheckoutSettings> {
  const settings = await getCheckoutSettings();
  return {
    ...settings,
    onlinePaymentsAvailable: settings.available && settings.onlinePaymentsEnabled && stripeReadiness().ready,
  };
}
