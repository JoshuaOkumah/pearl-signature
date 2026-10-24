import type { Metadata } from "next";
import { CheckoutBackLink, CheckoutClient, QuoteStatusAnnouncer } from "@/components/checkout/checkout-client";
import { Eyebrow, Section } from "@/components/ui/section";

export const metadata: Metadata = {
  title: "Checkout",
  description: "Review your PEARL Signature order and confirm your details.",
  // Personal review state is never indexed.
  robots: { index: false, follow: false },
};

/**
 * `/checkout` — the checkout review step (Phase 4 foundation).
 *
 * Like `/cart` this route is a static shell with no server-side customer
 * data. Prices are verified against the catalogue through the cart context's
 * quote, which runs in the browser after mount. There is deliberately no
 * order-submission action on this page yet.
 */
export default function CheckoutPage() {
  return (
    <Section>
      <QuoteStatusAnnouncer />

      <div className="mb-8 max-w-2xl md:mb-10">
        <CheckoutBackLink className="mb-5" />
        <Eyebrow>Review</Eyebrow>
        <h1 className="mt-4 font-display text-4xl font-semibold leading-[1.08] tracking-[-0.015em] text-navy sm:text-5xl">
          Checkout
        </h1>
        <p className="mt-3 text-base leading-relaxed text-ink-muted">
          Every price below is checked against the menu before you continue.
        </p>
      </div>

      <CheckoutClient />
    </Section>
  );
}
