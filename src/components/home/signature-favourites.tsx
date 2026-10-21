import { ArrowRight } from "lucide-react";
import { featuredProducts, products } from "@/data/products";
import { Section, SectionHeading } from "@/components/ui/section";
import { ButtonLink } from "@/components/ui/button";
import { Reveal } from "@/components/ui/reveal";
import { ProductCard } from "@/components/shared/product-card";

/**
 * Editorial showcase of representative dishes.
 * These are kitchen favourites chosen by the team for presentation —
 * not sales-ranked “bestsellers”.
 */
export function SignatureFavourites() {
  return (
    <Section>
      <div className="flex flex-wrap items-end justify-between gap-6">
        <Reveal>
          <SectionHeading
            eyebrow="Signature favourites"
            title="A taste of what we’re known for"
            description="A small, lovingly curated selection from the menu — the dishes our kitchen is built around."
          />
        </Reveal>
        <Reveal delay={0.1}>
          <ButtonLink href="/menu" variant="outline" className="hidden sm:inline-flex">
            View the full menu
            <ArrowRight className="h-4 w-4" aria-hidden="true" />
          </ButtonLink>
        </Reveal>
      </div>

      <div className="mt-12 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
        {featuredProducts.map((product, index) => (
          <Reveal key={product.slug} delay={0.06 * index} className={index === 0 ? "sm:col-span-2" : undefined}>
            <ProductCard product={product} size={index === 0 ? "large" : "default"} className="h-full" />
          </Reveal>
        ))}

        {/* Closing tile keeps the grid honest and invites exploration */}
        <Reveal delay={0.3} className="sm:col-span-2">
          <div className="flex h-full flex-col justify-between gap-8 rounded-3xl bg-navy p-7 shadow-card">
            <p className="font-display text-2xl font-semibold leading-snug text-cream">
              {products.length} Nigerian favourites,{" "}
              <em className="italic text-gold">one beautifully set table.</em>
            </p>
            <ButtonLink href="/menu" variant="outlineLight" className="self-start">
              Browse everything
              <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </ButtonLink>
          </div>
        </Reveal>
      </div>
    </Section>
  );
}
