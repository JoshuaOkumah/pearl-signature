import type { Product } from "@/types";

/**
 * Temporary typed preview data for Phase 1.
 *
 * These products were supplied by the business. Pricing, portion sizes and
 * customisation options are intentionally omitted until confirmed — they will
 * be stored in MongoDB (and imagery in Cloudinary) in a later phase, at which
 * point this module is replaced by a data-access layer returning the same
 * `Product` shape.
 */
export const products: Product[] = [
  // ── Traditional Foods ──────────────────────────────────────────────
  {
    slug: "egusi-soup",
    name: "Egusi Soup",
    category: "traditional-foods",
    featured: true,
    description:
      "Ground melon seeds cooked into a rich, nutty soup with leafy greens, a beloved favourite at the Nigerian table.",
    theme: { deep: "#6E5320", base: "#C9A24B", accent: "#5C7A58" },
  },
  {
    slug: "bitterleaf-soup",
    name: "Bitterleaf Soup",
    category: "traditional-foods",
    featured: true,
    description:
      "A deeply savoury classic. Carefully washed bitterleaf, simmered with peppers and traditional spices.",
    theme: { deep: "#2E4230", base: "#5C7A58", accent: "#D4AF37" },
  },
  {
    slug: "vegetable-soup",
    name: "Vegetable Soup",
    category: "traditional-foods",
    featured: false,
    description:
      "Fresh leafy greens simmered in a flavourful pepper base. Vibrant, hearty and comforting.",
    theme: { deep: "#37522F", base: "#6E8A4A", accent: "#B86A4F" },
  },
  {
    slug: "ukwa",
    name: "Ukwa",
    category: "traditional-foods",
    featured: false,
    description:
      "Tender African breadfruit prepared the traditional way. Wholesome, filling and full of character.",
    theme: { deep: "#6E4F33", base: "#C2A276", accent: "#5C7A58" },
  },
  // ── Pastries & Snacks ──────────────────────────────────────────────
  {
    slug: "shawarma",
    name: "Shawarma",
    category: "pastries-snacks",
    featured: true,
    description:
      "A soft, warm wrap filled with seasoned meat and crisp vegetables, finished with a creamy sauce.",
    theme: { deep: "#8A4E30", base: "#D69A5E", accent: "#5C7A58" },
  },
  {
    slug: "turkey-pie",
    name: "Turkey Pie",
    category: "pastries-snacks",
    featured: false,
    description: "Flaky golden pastry generously filled with savoury, well-seasoned turkey.",
    theme: { deep: "#7C4F1E", base: "#D19A4E", accent: "#B86A4F" },
  },
  {
    slug: "meat-pie",
    name: "Meat Pie",
    category: "pastries-snacks",
    featured: true,
    description: "Buttery, flaky pastry with a rich minced-meat filling, a timeless Nigerian favourite.",
    theme: { deep: "#71471F", base: "#C98F45", accent: "#8A6A52" },
  },
  {
    slug: "egg-roll",
    name: "Egg Roll",
    category: "pastries-snacks",
    featured: false,
    description: "A whole boiled egg wrapped in soft, lightly sweet dough and fried until golden.",
    theme: { deep: "#7A5218", base: "#D9A24B", accent: "#B86A4F" },
  },
  {
    slug: "chicken-pie",
    name: "Chicken Pie",
    category: "pastries-snacks",
    featured: false,
    description: "Tender, seasoned chicken tucked into delicate golden pastry.",
    theme: { deep: "#8A5C26", base: "#D9AD63", accent: "#5C7A58" },
  },
  // ── Drinks ─────────────────────────────────────────────────────────
  {
    slug: "zobo",
    name: "Zobo",
    category: "drinks",
    featured: true,
    description: "Chilled hibiscus brew infused with warm spices. Bright, refreshing and gently tangy.",
    theme: { deep: "#571C2A", base: "#93324A", accent: "#D4AF37" },
  },
  {
    slug: "soya-milk",
    name: "Soya Milk",
    category: "drinks",
    featured: false,
    description: "Smooth, creamy soya milk, freshly prepared and lightly sweetened.",
    theme: { deep: "#9C8259", base: "#E3D3B0", accent: "#8A6A52" },
  },
];

/** Items curated for the homepage “Signature Favourites” showcase. */
export const featuredProducts: Product[] = products.filter((product) => product.featured);

export function getProduct(slug: string): Product | undefined {
  return products.find((product) => product.slug === slug);
}
