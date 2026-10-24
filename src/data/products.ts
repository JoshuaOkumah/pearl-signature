import { categoryMap } from "@/data/categories";
import { e2ePurchasableProducts } from "@/data/e2e-products";
import type { Product, ProductStatus } from "@/types";

/**
 * Labelled preview fixtures (development / test only).
 *
 * These products were supplied by the business. Pricing, portion sizes and
 * customisation options are intentionally omitted until confirmed — the
 * public repository renders them with `priceCents: null`, which the UI
 * presents as “Price to be confirmed” rather than a fabricated amount.
 *
 * Mode rules (see src/lib/repositories/catalogue.ts):
 * - Used ONLY when `CATALOGUE_SOURCE=fixtures` or during local development.
 * - Production without `MONGODB_URI` shows an honest error state instead.
 * - One `status: "draft"` record exists so draft-visibility rules can be
 *   tested end to end; it is never publicly readable.
 * - The demo product carries two preview media slots (not photographs): the
 *   UI renders themed placeholders for them until real Cloudinary
 *   photography lands, exercising the gallery, thumbnails and alt texts.
 */

type PreviewInput = Omit<
  Product,
  | "categoryName"
  | "shortDescription"
  | "status"
  | "availability"
  | "currency"
  | "priceCents"
  | "variants"
  | "images"
  | "tags"
  | "sortOrder"
> &
  Partial<Pick<Product, "shortDescription" | "status" | "images">>;

let sequence = 0;

function previewProduct(input: PreviewInput): Product {
  sequence += 1;
  const category = (categoryMap as Record<string, { name: string } | undefined>)[input.category];
  return {
    categoryName: category?.name ?? input.category,
    shortDescription: null,
    status: "published" satisfies ProductStatus,
    availability: "available",
    currency: "CAD",
    priceCents: null,
    variants: [],
    images: [],
    tags: [],
    sortOrder: sequence * 10,
    ...input,
  };
}

export const products: Product[] = [
  // ── Traditional Foods ──────────────────────────────────────────────
  previewProduct({
    slug: "egusi-soup",
    name: "Egusi Soup",
    category: "traditional-foods",
    featured: true,
    description:
      "Ground melon seeds cooked into a rich, nutty soup with leafy greens, a beloved favourite at the Nigerian table.",
    theme: { deep: "#6E5320", base: "#C9A24B", accent: "#5C7A58" },
    // Preview media slots (not photographs): until Cloudinary holds real
    // photography, the storefront renders themed placeholders with these
    // alt texts. Real customer photography replaces these records later;
    // nothing here is fetched from the network.
    images: [
      {
        publicId: "preview/egusi-soup-serving",
        secureUrl:
          "https://res.cloudinary.com/pearl-signature-preview/image/upload/v1/preview/egusi-soup-serving.jpg",
        alt: "Preview image: egusi soup presented in a serving bowl",
        sortOrder: 0,
        width: 1200,
        height: 900,
      },
      {
        publicId: "preview/egusi-soup-sides",
        secureUrl:
          "https://res.cloudinary.com/pearl-signature-preview/image/upload/v1/preview/egusi-soup-sides.jpg",
        alt: "Preview image: egusi soup served with sides at the table",
        sortOrder: 1,
        width: 1200,
        height: 900,
      },
    ],
  }),
  previewProduct({
    slug: "bitterleaf-soup",
    name: "Bitterleaf Soup",
    category: "traditional-foods",
    featured: true,
    description:
      "A deeply savoury classic. Carefully washed bitterleaf, simmered with peppers and traditional spices.",
    theme: { deep: "#2E4230", base: "#5C7A58", accent: "#D4AF37" },
  }),
  previewProduct({
    slug: "vegetable-soup",
    name: "Vegetable Soup",
    category: "traditional-foods",
    featured: false,
    description:
      "Fresh leafy greens simmered in a flavourful pepper base. Vibrant, hearty and comforting.",
    theme: { deep: "#37522F", base: "#6E8A4A", accent: "#B86A4F" },
  }),
  previewProduct({
    slug: "ukwa",
    name: "Ukwa",
    category: "traditional-foods",
    featured: false,
    description:
      "Tender African breadfruit prepared the traditional way. Wholesome, filling and full of character.",
    theme: { deep: "#6E4F33", base: "#C2A276", accent: "#5C7A58" },
  }),
  // ── Pastries & Snacks ──────────────────────────────────────────────
  previewProduct({
    slug: "shawarma",
    name: "Shawarma",
    category: "pastries-snacks",
    featured: true,
    description:
      "A soft, warm wrap filled with seasoned meat and crisp vegetables, finished with a creamy sauce.",
    theme: { deep: "#8A4E30", base: "#D69A5E", accent: "#5C7A58" },
  }),
  previewProduct({
    slug: "turkey-pie",
    name: "Turkey Pie",
    category: "pastries-snacks",
    featured: false,
    description: "Flaky golden pastry generously filled with savoury, well-seasoned turkey.",
    theme: { deep: "#7C4F1E", base: "#D19A4E", accent: "#B86A4F" },
  }),
  previewProduct({
    slug: "meat-pie",
    name: "Meat Pie",
    category: "pastries-snacks",
    featured: true,
    description: "Buttery, flaky pastry with a rich minced-meat filling, a timeless Nigerian favourite.",
    theme: { deep: "#71471F", base: "#C98F45", accent: "#8A6A52" },
  }),
  previewProduct({
    slug: "egg-roll",
    name: "Egg Roll",
    category: "pastries-snacks",
    featured: false,
    description: "A whole boiled egg wrapped in soft, lightly sweet dough and fried until golden.",
    theme: { deep: "#7A5218", base: "#D9A24B", accent: "#B86A4F" },
  }),
  previewProduct({
    slug: "chicken-pie",
    name: "Chicken Pie",
    category: "pastries-snacks",
    featured: false,
    description: "Tender, seasoned chicken tucked into delicate golden pastry.",
    theme: { deep: "#8A5C26", base: "#D9AD63", accent: "#5C7A58" },
  }),
  // ── Drinks ─────────────────────────────────────────────────────────
  previewProduct({
    slug: "zobo",
    name: "Zobo",
    category: "drinks",
    featured: true,
    description: "Chilled hibiscus brew infused with warm spices. Bright, refreshing and gently tangy.",
    theme: { deep: "#571C2A", base: "#93324A", accent: "#D4AF37" },
  }),
  previewProduct({
    slug: "soya-milk",
    name: "Soya Milk",
    category: "drinks",
    featured: false,
    description: "Smooth, creamy soya milk, freshly prepared and lightly sweetened.",
    theme: { deep: "#9C8259", base: "#E3D3B0", accent: "#8A6A52" },
  }),
  // ── Unpublished test record (never publicly readable) ──────────────
  previewProduct({
    slug: "preview-draft-item",
    name: "Preview Draft Item",
    category: "traditional-foods",
    featured: false,
    status: "draft",
    description:
      "An unpublished sample record used to verify that draft products never appear in the public catalogue.",
    theme: { deep: "#46586A", base: "#7C8B9A", accent: "#D4AF37" },
  }),

  // Orderable synthetic records for the disposable cart test server only.
  // Empty (and therefore invisible) unless E2E_PURCHASABLE_FIXTURES=1.
  ...e2ePurchasableProducts,
];

export function getProduct(slug: string): Product | undefined {
  return products.find((product) => product.slug === slug);
}
