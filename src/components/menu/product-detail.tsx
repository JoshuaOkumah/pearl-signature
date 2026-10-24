import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import type { Product } from "@/types";
import { PurchasePanel } from "@/components/cart/purchase-panel";
import { Badge } from "@/components/ui/badge";
import { Section } from "@/components/ui/section";
import { Breadcrumbs, type Crumb } from "@/components/shared/breadcrumbs";
import { ProductCard } from "@/components/shared/product-card";
import { ProductGallery } from "./product-gallery";

interface ProductDetailProps {
  product: Product;
  related: Product[];
}

/**
 * Product detail composition (`/menu/[slug]`).
 *
 * Server component: breadcrumb trail, mobile-first gallery, honest
 * availability states, the purchasing panel (a client island) and
 * same-category related products (the current product is always excluded
 * upstream).
 */
export function ProductDetail({ product, related }: ProductDetailProps) {
  const unavailable = product.availability === "unavailable";

  const crumbs: Crumb[] = [
    { label: "Home", href: "/" },
    { label: "Menu", href: "/menu" },
    { label: product.categoryName, href: `/menu?category=${product.category}` },
    { label: product.name },
  ];

  return (
    <>
      <Section padding="flush" className="pb-12 pt-8 md:pt-12">
        <Breadcrumbs items={crumbs} />

        <div className="mt-7 grid gap-8 lg:grid-cols-2 lg:gap-14">
          <ProductGallery images={product.images} productName={product.name} theme={product.theme} />

          <div className="min-w-0">
            <Link
              href="/menu"
              className="focus-gold inline-flex items-center gap-1.5 rounded-full text-sm font-semibold text-ink-muted transition-colors hover:text-navy"
            >
              <ArrowLeft className="h-4 w-4" aria-hidden="true" />
              Back to menu
            </Link>

            <p className="mt-5 text-xs font-bold uppercase tracking-[0.18em] text-gold-700">
              {product.categoryName}
            </p>
            <h1 className="mt-2 font-display text-4xl font-semibold leading-[1.08] tracking-[-0.01em] text-navy md:text-5xl">
              {product.name}
            </h1>

            {product.shortDescription ? (
              <p className="mt-4 text-lg leading-relaxed text-ink-muted">{product.shortDescription}</p>
            ) : null}

            <div className="mt-5 flex flex-wrap items-center gap-3">
              {unavailable ? <Badge tone="terracotta">Currently unavailable</Badge> : null}
              {product.featured ? <Badge tone="gold">Signature</Badge> : null}
            </div>

            {/* Price, options, quantity and add-to-cart live in one client
                island so the selection state never has to cross the server. */}
            <div className="mt-6">
              <PurchasePanel product={product} />
            </div>

            <div className="mt-8">
              <h2 className="font-display text-xl font-semibold text-navy">About this dish</h2>
              <p className="mt-3 text-base leading-relaxed text-ink-muted">{product.description}</p>
            </div>
          </div>
        </div>
      </Section>

      {related.length > 0 ? (
        <Section padding="default" className="border-t border-sand bg-cream-100/70">
          <div className="flex flex-wrap items-end justify-between gap-x-8 gap-y-4">
            <div>
              <p className="flex items-center gap-3 text-xs font-bold uppercase tracking-[0.22em] text-gold-700">
                <span aria-hidden="true" className="h-px w-8 bg-current opacity-60" />
                More to explore
              </p>
              <h2 className="mt-4 font-display text-3xl font-semibold leading-[1.12] text-navy">
                More in {product.categoryName}
              </h2>
            </div>
            <Link
              href={`/menu?category=${product.category}`}
              className="focus-gold rounded-full border border-navy/25 bg-surface px-5 py-2.5 text-sm font-bold text-navy transition-colors hover:border-navy"
            >
              See all {product.categoryName.toLowerCase()}
            </Link>
          </div>

          <ul className="mt-8 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
            {related.map((item) => (
              <li key={item.slug} className="h-full">
                <ProductCard product={item} className="h-full" />
              </li>
            ))}
          </ul>
        </Section>
      ) : null}
    </>
  );
}
