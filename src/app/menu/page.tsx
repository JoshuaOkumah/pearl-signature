import type { Metadata } from "next";
import { Clock } from "lucide-react";
import { Suspense } from "react";
import { categories } from "@/data/categories";
import { products } from "@/data/products";
import { parseMenuFilter } from "@/lib/filter";
import { MenuExplorer } from "@/components/menu/menu-explorer";
import { MenuExplorerSkeleton } from "@/components/menu/menu-explorer-skeleton";
import { Badge } from "@/components/ui/badge";
import { Eyebrow, Section } from "@/components/ui/section";
import { Reveal } from "@/components/ui/reveal";

export const metadata: Metadata = {
  title: "Menu",
  description:
    "Browse the PEARL Signature menu, with traditional Nigerian soups and classics, pastries, snacks and drinks. Ordering opens soon.",
};

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default function MenuPage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <>
      <Section padding="flush" className="pb-10 pt-14 md:pt-20">
        <Reveal>
          <Eyebrow>The menu</Eyebrow>
          <div className="mt-4 flex flex-wrap items-end justify-between gap-x-8 gap-y-5">
            <h1 className="max-w-xl font-display text-4xl font-semibold leading-[1.08] tracking-[-0.01em] text-balance text-navy md:text-5xl">
              Explore the PEARL Signature menu
            </h1>
            <Badge tone="gold" className="mb-1.5">
              <Clock className="h-3.5 w-3.5" aria-hidden="true" />
              Ordering opens soon · browse freely
            </Badge>
          </div>
          <p className="mt-5 max-w-2xl text-base leading-relaxed text-ink-muted md:text-lg">
            Traditional soups and classics, golden pastries and refreshing drinks, every dish prepared to order with
            authentic recipes. Final pricing will be published when ordering opens.
          </p>
        </Reveal>
      </Section>

      <Section padding="flush-top">
        {/* searchParams is a runtime API — the explorer streams in behind a
            skeleton so the rest of the page stays in the static shell. */}
        <Suspense fallback={<MenuExplorerSkeleton />}>
          <MenuResults searchParams={searchParams} />
        </Suspense>
      </Section>
    </>
  );
}

async function MenuResults({ searchParams }: { searchParams: SearchParams }) {
  const { category } = await searchParams;
  return <MenuExplorer initialFilter={parseMenuFilter(category)} products={products} categories={categories} />;
}
