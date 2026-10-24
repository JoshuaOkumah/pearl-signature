import { ArrowRight } from "lucide-react";
import type { Product } from "@/types";
import { ButtonLink } from "@/components/ui/button";
import { Reveal } from "@/components/ui/reveal";
import { ProductCard } from "@/components/shared/product-card";

interface SignatureFavouritesShowcaseProps {
  featured: Product[];
  /** Published total for the closing tile (null when the count failed). */
  total: number | null;
  state: "ok" | "error";
}

/**
 * Grid half of the Signature Favourites section (the heading is static in
 * `signature-favourites.tsx`, so PPR keeps it in the shell while this streams).
 *
 * - Normal: curated featured products + the editorial closing tile.
 * - Empty catalogue: an honest “being prepared” tile (no fabricated dishes).
 * - Database failure: a calm retry hint — the section never disappears and
 *   never shows internal details.
 */
export function SignatureFavouritesShowcase({ featured, total, state }: SignatureFavouritesShowcaseProps) {
  if (state === "error" || featured.length === 0) {
    const heading =
      state === "error"
        ? "We couldn’t load this section just now"
        : "Signature favourites are being prepared";
    const body =
      state === "error"
        ? "Please refresh the page in a moment. The full menu is always open to browse."
        : "Our featured dishes will appear here once they’re ready. The full menu is open to browse in the meantime.";

    return (
      <div className="mt-12 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
        <Reveal className="sm:col-span-2 lg:col-span-4">
          <div className="flex h-full flex-col items-start justify-between gap-6 rounded-3xl bg-navy p-7 shadow-card sm:p-9">
            <div>
              <p className="font-display text-2xl font-semibold leading-snug text-cream sm:text-3xl">{heading}</p>
              <p className="mt-3 max-w-xl text-sm leading-relaxed text-cream/75 sm:text-base">{body}</p>
            </div>
            <ButtonLink href="/menu" variant="outlineLight" className="self-start">
              Browse the menu
              <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </ButtonLink>
          </div>
        </Reveal>
      </div>
    );
  }

  return (
    <div className="mt-12 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
      {featured.map((product, index) => (
        <Reveal key={product.slug} delay={0.06 * index} className={index === 0 ? "sm:col-span-2" : undefined}>
          <ProductCard product={product} size={index === 0 ? "large" : "default"} className="h-full" />
        </Reveal>
      ))}

      {/* Closing tile keeps the grid honest and invites exploration */}
      {total !== null ? (
        <Reveal delay={0.3} className="sm:col-span-2">
          <div className="relative flex h-full min-h-72 flex-col items-center justify-center gap-6 overflow-hidden rounded-[2.5rem] bg-navy p-7 text-center shadow-card sm:p-9">
            <div aria-hidden="true" className="pointer-events-none absolute -left-20 -top-20 h-64 w-64 rounded-full border-[14px] border-gold/15" />
            <div aria-hidden="true" className="pointer-events-none absolute -bottom-24 -right-16 h-72 w-72 rounded-full border-[14px] border-terracotta/20" />
            <div aria-hidden="true" className="pointer-events-none absolute right-10 top-10 h-2.5 w-2.5 rounded-full bg-gold/60" />
            <div aria-hidden="true" className="pointer-events-none absolute bottom-12 left-12 h-2 w-2 rounded-full bg-cream/40" />

            <div className="relative">
              <h3 className="font-display text-2xl font-semibold leading-snug text-balance text-cream sm:text-3xl">
                {total} Nigerian favourites, {" "}
                <em className="italic text-gold">one beautifully set table.</em>
              </h3>
            </div>

            <ButtonLink href="/menu" variant="accent" size="lg" className="relative">
              Browse everything
              <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </ButtonLink>
          </div>
        </Reveal>
      ) : null}
    </div>
  );
}
