import type { Metadata } from "next";
import { connection } from "next/server";
import { readGuestSessionState } from "@/lib/guest/state";
import { Eyebrow, Section } from "@/components/ui/section";
import { MyOrdersClient } from "@/components/tracking/my-orders";

/**
 * `/my-orders` (Phase 7B).
 *
 * The page reads the remembered-device cookie on the server so a returning
 * customer sees their history immediately, without a flash of the recovery
 * form. Nothing private is rendered from the URL: the list itself still comes
 * from a Server Action that re-checks the live session and derives the orders
 * from its verified email.
 *
 * `instant = false` opts this segment out of static-shell prerendering: the
 * response is per-request because it depends on a cookie, and a shared or
 * prerendered shell would be wrong here.
 */
export const instant = false;

export const metadata: Metadata = {
  title: "My orders",
  description: "Your CLIVS order history.",
  // Order history is personal: never index, never follow.
  robots: { index: false, follow: false },
};

export default async function MyOrdersPage() {
  // Stop prerendering here: the session is per-request and the page must never
  // be captured as a shared shell.
  await connection();
  const session = await readGuestSessionState();

  return (
    <Section>
      <div className="mb-8 max-w-2xl">
        <Eyebrow>Your orders</Eyebrow>
        <h1 className="mt-4 font-display text-4xl font-semibold leading-[1.08] tracking-[-0.015em] text-navy sm:text-5xl">
          My Orders
        </h1>
        <p className="mt-3 font-sans text-base leading-relaxed text-ink-muted">
          Every order placed with your verified email address, with its progress and payment details. No
          account or password is needed.
        </p>
      </div>

      <MyOrdersClient initialSession={session} />
    </Section>
  );
}
