import { ArrowRight } from "lucide-react";
import { Suspense } from "react";
import { loadHomepageShowcase } from "@/lib/server/catalogue-page";
import { Section, SectionHeading } from "@/components/ui/section";
import { ButtonLink } from "@/components/ui/button";
import { Reveal } from "@/components/ui/reveal";
import { Skeleton } from "@/components/ui/skeleton";
import { SignatureFavouritesShowcase } from "./signature-favourites-showcase";

/**
 * Editorial showcase of representative dishes.
 * These are kitchen favourites chosen by the team for presentation —
 * not sales-ranked “bestsellers”.
 *
 * The heading is static (ships in the PPR shell); the grid streams from
 * MongoDB behind Suspense. `loadHomepageShowcase` calls `io()` first, so no
 * database work happens during build, and every reader sees current
 * publication state without a redeploy.
 */
export function SignatureFavourites() {
  return (
    <Section>
      <div className="flex flex-wrap items-end justify-between gap-6">
        <Reveal>
          <SectionHeading
            eyebrow="Signature favourites"
            title="A taste of what we’re known for"
            description="A small, lovingly curated selection of the dishes our kitchen is built around."
          />
        </Reveal>
        <Reveal delay={0.1}>
          <ButtonLink href="/menu" variant="outline" className="hidden sm:inline-flex">
            View the full menu
            <ArrowRight className="h-4 w-4" aria-hidden="true" />
          </ButtonLink>
        </Reveal>
      </div>

      <Suspense fallback={<FavouritesGridSkeleton />}>
        <FavouritesGrid />
      </Suspense>
    </Section>
  );
}

async function FavouritesGrid() {
  const showcase = await loadHomepageShowcase();
  if (!showcase.ok) {
    return <SignatureFavouritesShowcase featured={[]} total={null} state="error" />;
  }
  return (
    <SignatureFavouritesShowcase
      featured={showcase.data.featured}
      total={showcase.data.total}
      state="ok"
    />
  );
}

function FavouritesGridSkeleton() {
  return (
    <div className="mt-12 grid gap-6 sm:grid-cols-2 lg:grid-cols-4" aria-hidden="true">
      <Skeleton className="aspect-[16/10] rounded-3xl sm:col-span-2" />
      <Skeleton className="aspect-[4/3] rounded-3xl" />
      <Skeleton className="aspect-[4/3] rounded-3xl" />
      <Skeleton className="aspect-[4/3] rounded-3xl" />
      <Skeleton className="aspect-[4/3] rounded-3xl sm:col-span-2" />
    </div>
  );
}
