import type { Metadata } from "next";
import { Suspense } from "react";
import { Eyebrow, Section } from "@/components/ui/section";
import { OrderTrackingClient } from "@/components/tracking/order-tracking";

export const metadata: Metadata = {
  title: "Track your order",
  description: "Check the progress of your PEARL Signature order.",
  // Order tracking is personal: never index, never follow.
  robots: { index: false, follow: false },
};

/**
 * `/track` (Phase 7).
 *
 * The server renders an inert shell only. Order facts are fetched by the
 * client after it proves access: either the Phase 5 confirmation capability
 * already in this tab's sessionStorage, or a scoped grant obtained by verifying
 * a one-time code sent to the email address on the order.
 *
 * The reference in `?ref=` is not a secret and grants nothing on its own, so a
 * shared link cannot expose an order. `Suspense` is required because
 * `useSearchParams` must be resolvable during the static shell render.
 */
export default function TrackPage() {
  return (
    <Section>
      <div className="mb-8 max-w-2xl">
        <Eyebrow>Order tracking</Eyebrow>
        <h1 className="mt-4 font-display text-4xl font-semibold text-navy sm:text-5xl">
          Track your order
        </h1>
        <p className="mt-4 font-sans text-base leading-relaxed text-ink-muted">
          See where your order is and what happens next. Details are private: this page only opens on the
          device that placed the order, or after the email address on the order is verified.
        </p>
      </div>
      <Suspense
        fallback={
          <div className="rounded-3xl border border-border bg-surface p-6 font-sans text-sm text-ink-muted">
            Loading your order…
          </div>
        }
      >
        <OrderTrackingClient />
      </Suspense>
    </Section>
  );
}
