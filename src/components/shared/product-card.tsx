import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { getCategory } from "@/data/categories";
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
 * Product preview card. Presentational only — no pricing or cart actions
 * exist in Phase 1. When MongoDB lands, the same card renders API data.
 */
export function ProductCard({ product, size = "default", className }: ProductCardProps) {
  const category = getCategory(product.category);

  return (
    <Link
      href={`/menu?category=${product.category}`}
      className={cn(
        "focus-gold group flex h-full flex-col overflow-hidden rounded-3xl border border-border bg-surface shadow-card",
        "transition-all duration-300 hover:-translate-y-1 hover:shadow-lift",
        className,
      )}
    >
      <div className="overflow-hidden">
        <FoodMedia
          theme={product.theme}
          label={product.name}
          idSuffix={size === "large" ? "lead" : "card"}
          ratio={size === "large" ? "16/10" : "4/3"}
          className="transition-transform duration-500 ease-out group-hover:scale-[1.04]"
        />
      </div>
      <div className="flex flex-1 flex-col p-5">
        <div className="flex items-center justify-between gap-2">
          <span className="text-[0.7rem] font-bold uppercase tracking-[0.18em] text-gold-700">{category.name}</span>
          {product.featured ? <Badge tone="gold">Signature</Badge> : null}
        </div>
        <h3 className="mt-2 font-display text-xl font-semibold text-navy">{product.name}</h3>
        <p className="mt-1.5 line-clamp-2 text-sm leading-relaxed text-ink-muted">{product.description}</p>
        <span className="mt-auto inline-flex items-center gap-1.5 pt-4 text-sm font-bold text-navy">
          View on menu
          <ArrowUpRight className="h-4 w-4 transition-transform duration-300 group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
        </span>
      </div>
    </Link>
  );
}
