import type { Metadata } from "next";
import { CartPageClient } from "@/components/cart/cart-page-client";
import { Eyebrow, Section } from "@/components/ui/section";

export const metadata: Metadata = {
  title: "Your cart",
  description: "Review the dishes you have selected from the PEARL Signature menu.",
  // A cart is personal state, never a landing page.
  robots: { index: false, follow: true },
};

/**
 * `/cart` — the dedicated cart page.
 *
 * The page itself is a static shell: it reads no database and renders no
 * customer data, because the cart lives in the browser. All pricing comes
 * from the cart context's server quote at runtime, so this route stays fast
 * and cacheable while still showing live catalogue prices.
 */
export default function CartPage() {
  return (
    <Section>
      <div className="mb-8 max-w-2xl md:mb-10">
        <Eyebrow>Your selection</Eyebrow>
        <h1 className="mt-4 font-display text-4xl font-semibold leading-[1.08] tracking-[-0.015em] text-navy sm:text-5xl">
          Your cart
        </h1>
        <p className="mt-3 text-base leading-relaxed text-ink-muted">
          Quantities and prices are checked against the menu as you shop.
        </p>
      </div>

      <CartPageClient />
    </Section>
  );
}
