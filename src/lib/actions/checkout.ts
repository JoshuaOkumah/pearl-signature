"use server";

import { getCheckoutSettings } from "@/lib/store/config";
import { guestVerificationReadiness } from "@/lib/guest/readiness";
import type { CheckoutSettingsWithVerification } from "@/lib/validations/guest";
import { stripeReadiness } from "@/lib/payments/stripe";

/**
 * Public checkout settings (Phase 5, extended in Phase 7B).
 *
 * Read-only and intentionally tiny: the checkout client needs to know which
 * fulfilment methods exist, which areas are served with which fee, how tax is
 * configured, and whether a verification code can actually be delivered before
 * it shows an order form that cannot be completed.
 *
 * Everything returned is information the business publishes to customers
 * anyway (service areas and their prices). Nothing admin-private, no database
 * ids, no customer data. Server Actions are per-request POSTs, so the response
 * never enters a shared cache.
 */
export async function getCheckoutSettingsAction(): Promise<CheckoutSettingsWithVerification> {
  const settings = await getCheckoutSettings();
  return {
    ...settings,
    onlinePaymentsAvailable: settings.available && settings.onlinePaymentsEnabled && stripeReadiness().ready,
    emailVerificationAvailable: guestVerificationReadiness().ready,
  };
}
