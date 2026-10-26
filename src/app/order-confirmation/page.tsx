import type { Metadata } from "next";
import { Suspense } from "react";
import { Eyebrow, Section } from "@/components/ui/section";
import { OrderConfirmationClient } from "@/components/checkout/order-confirmation";

export const metadata: Metadata = {
  title: "Order confirmation",
  description: "Your PEARL Signature order confirmation.",
  // Order confirmations are personal: never index, never follow.
  robots: { index: false, follow: false },
};

/**
 * `/order-confirmation` (Phase 5).
 *
 * The server renders only an inert shell. The order itself is fetched by the
 * client with a capability that lives in this tab's sessionStorage, so no
 * customer-specific data is ever rendered on the server, printed into an RSC
 * payload or written into a shared cache. The reference in the URL alone
 * grants nothing.
 *
 * Wrapped in Suspense because `useSearchParams` must be resolvable during
 * the static shell render.
 */
export default function OrderConfirmationPage() {
  return (
    <Section>
      <div className="mb-8 max-w-2xl">
        <Eyebrow>Confirmation</Eyebrow>
        <h1 className="mt-4 font-display text-4xl font-semibold text-navy sm:text-5xl">
          Your order
        </h1>
      </div>
      <Suspense
        fallback={
          <div className="rounded-3xl border border-border bg-surface p-6 text-sm text-ink-muted">
            Loading your confirmation…
          </div>
        }
      >
        <OrderConfirmationClient />
      </Suspense>
    </Section>
  );
}
