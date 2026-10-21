import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { loadProductPageData } from "@/lib/server/catalogue-page";
import { resolveCatalogueSource } from "@/lib/repositories/catalogue";
import { excerpt } from "@/lib/format";
import { absoluteUrl } from "@/lib/site-url";
import { slugSchema } from "@/lib/validations/catalogue";
import type { Product } from "@/types";
import { CatalogueUnavailable } from "@/components/menu/menu-states";
import { ProductDetail } from "@/components/menu/product-detail";

type PageProps = { params: Promise<{ slug: string }> };

/**
 * Route-segment config (Next 16 Cache Components): opt this route out of
 * instant-navigation/static-shell validation. Reasons:
 *  1. The shared header reads `usePathname()`, which cannot resolve during
 *     prerender when params are unknown at build time (no
 *     generateStaticParams on purpose — the catalogue lives in MongoDB).
 *  2. Product pages are fresh per-request database reads; price or
 *     availability edits must appear without a redeploy.
 * Genuine 404 status codes are guaranteed one layer earlier, in
 * `src/proxy.ts`, which decides before any rendering starts.
 */
export const instant = false;

/**
 * `/menu/[slug]` — one page per published product.
 *
 * No `generateStaticParams`: the slug space comes from MongoDB, so pages are
 * rendered on demand. Draft, unknown, or malformed slugs all resolve to 404
 * with a real status code (`src/proxy.ts`) — unpublished products never leak
 * through metadata or HTML.
 */

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  // Safety net: the proxy has normally already 404'd missing slugs before
  // rendering; this covers the rare window where the catalogue changed
  // between the proxy check and this render.
  if (!slugSchema.safeParse(slug).success) notFound();

  const data = await loadProductPageData(slug);
  // Unavailable database: minimal metadata; the page body shows the retry
  // state. Missing or draft product: 404 via notFound().
  if (!data.product.ok) return {};
  if (!data.product.data) notFound();

  const product = data.product.data;
  const description = excerpt(product.shortDescription ?? product.description);
  const canonical = absoluteUrl(`/menu/${product.slug}`);
  const preview = resolveCatalogueSource() === "fixtures";
  const image = product.images[0];

  return {
    title: product.name,
    description,
    alternates: canonical ? { canonical } : undefined,
    openGraph: {
      title: `${product.name} | PEARL Signature`,
      description,
      // URLs arrive pre-validated (HTTPS Cloudinary) from the repository.
      ...(image ? { images: [image.secureUrl] } : {}),
    },
    // Preview fixtures are temporary content: never index them as inventory.
    robots: preview ? { index: false, follow: false } : undefined,
  };
}

/** schema.org Product object — only fields backed by real data. */
function buildStructuredData(product: Product) {
  return {
    "@context": "https://schema.org",
    "@type": "Product",
    name: product.name,
    description: product.shortDescription ?? product.description,
    ...(product.images.length > 0 ? { image: product.images.map((image) => image.secureUrl) } : {}),
    brand: { "@type": "Organization", name: "PEARL Signature" },
    // Offers appear ONLY with a configured price, and deliberately omit
    // availability claims (no inventory tracking exists yet).
    ...(product.priceCents !== null
      ? {
          offers: {
            "@type": "Offer",
            price: (product.priceCents / 100).toFixed(2),
            priceCurrency: "CAD",
          },
        }
      : {}),
  };
}

export default async function ProductPage({ params }: PageProps) {
  const { slug } = await params;
  // Malformed slugs are simply not products.
  if (!slugSchema.safeParse(slug).success) notFound();

  const data = await loadProductPageData(slug);

  // Database unreachable: customer-safe retry state (a 404 here would
  // wrongly imply the product does not exist).
  if (!data.product.ok) {
    return (
      <div className="px-5 pb-16 pt-14 md:px-8 md:pt-20">
        <div className="mx-auto w-full max-w-3xl">
          <CatalogueUnavailable
            title="This dish is temporarily unavailable"
            description="We couldn’t load its details just now. Please try again in a moment."
          />
        </div>
      </div>
    );
  }

  const product = data.product.data;
  // Unknown or unpublished slug.
  if (!product) notFound();

  const related = data.related?.ok ? data.related.data : [];
  const structuredData = buildStructuredData(product);

  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData) }} />
      <ProductDetail product={product} related={related} />
    </>
  );
}
