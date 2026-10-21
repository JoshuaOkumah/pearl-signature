import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { formatCad } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { Product } from "@/types";
import { Badge } from "@/components/ui/badge";
import { FoodMedia } from "./food-media";

interface ProductCardProps {
  product: Product;
  /** "large" is used for the editorial lead slot in the favourites grid. */
  size?: "default" | "large";
  className?: string;
}

/**
 * Product preview card linking to its detail page (`/menu/[slug]`).
 *
 * Presentational only: no Add to Cart exists until the cart phase, and the
 * price area shows either the configured CAD amount or the honest
 * “Price to be confirmed” state — never a fabricated number.
 */
export function ProductCard({ product, size = "default", className }: ProductCardProps) {
  const price = formatCad(product.priceCents);
  const unavailable = product.availability === "unavailable";

  return (
    <Link
      href={`/menu/${product.slug}`}
      className={cn(
        "focus-gold group flex h-full flex-col overflow-hidden rounded-3xl border border-border bg-surface shadow-card",
        "transition-all duration-300 hover:-translate-y-1 hover:shadow-lift",
        className,
      )}
    >
      <div className="overflow-hidden">
        <FoodMedia
          theme={product.theme}
          image={product.images[0]}
          label={product.name}
          idSuffix={size === "large" ? "lead" : "card"}
          ratio={size === "large" ? "16/10" : "4/3"}
          sizes={
            size === "large"
              ? "(min-width:1024px) 50vw, 100vw"
              : "(min-width:1280px) 25vw, (min-width:1024px) 33vw, (min-width:640px) 50vw, 100vw"
          }
          className="transition-transform duration-500 ease-out group-hover:scale-[1.04]"
        />
      </div>
      <div className="flex flex-1 flex-col p-5">
        <div className="flex items-center justify-between gap-2">
          <span className="text-[0.7rem] font-bold uppercase tracking-[0.18em] text-gold-700">
            {product.categoryName}
          </span>
          {product.featured ? <Badge tone="gold">Signature</Badge> : null}
        </div>
        <h3 className="mt-2 font-display text-xl font-semibold text-navy">{product.name}</h3>
        <p className="mt-1.5 line-clamp-2 text-sm leading-relaxed text-ink-muted">
          {product.shortDescription ?? product.description}
        </p>

        <div className="mt-auto flex flex-wrap items-center gap-x-2 gap-y-1.5 pt-4">
          {price ? (
            <span className="text-base font-bold text-navy">{price}</span>
          ) : (
            <span className="text-sm font-semibold text-ink-muted">Price to be confirmed</span>
          )}
          {unavailable ? <Badge tone="terracotta">Unavailable</Badge> : null}
        </div>

        <span className="mt-2 inline-flex items-center gap-1.5 text-sm font-bold text-navy">
          View details
          <ArrowUpRight
            className="h-4 w-4 transition-transform duration-300 group-hover:-translate-y-0.5 group-hover:translate-x-0.5"
            aria-hidden="true"
          />
        </span>
      </div>
    </Link>
  );
}
