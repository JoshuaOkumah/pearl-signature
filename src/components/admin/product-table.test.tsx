/* eslint-disable @next/next/no-img-element -- next/image is mocked below so
   tests can assert delivered-image props without a build-time image config. */
import { render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AdminProductRow } from "@/lib/repositories/admin";
import { ProductTable } from "@/components/admin/product-table";

vi.mock("next/image", () => ({
  default: (props: Record<string, unknown>) => {
    const { src, alt, className } = props as { src: string; alt: string; className?: string };
    return <img src={src} alt={alt} className={className} />;
  },
}));

vi.mock("@/lib/actions/products", () => ({
  archiveProductAction: vi.fn(),
  setAvailabilityAction: vi.fn(),
}));

const CLOUDINARY_URL = "https://res.cloudinary.com/demo/image/upload/v1/products/egusi.jpg";

function makeRow(overrides: Partial<AdminProductRow> = {}): AdminProductRow {
  return {
    id: "p1",
    name: "Egusi Soup",
    slug: "egusi-soup",
    categoryId: "c1",
    categoryName: "Soups",
    status: "published",
    availability: "available",
    priceInput: "18.00",
    featured: false,
    imageCount: 1,
    thumbnailUrl: null,
    updatedAt: "2026-10-20T12:00:00.000Z",
    ...overrides,
  };
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("ProductTable thumbnails", () => {
  it("shows the honest empty state when the product has no photos", () => {
    const { container, getAllByText } = render(<ProductTable rows={[makeRow({ imageCount: 0 })]} />);
    expect(container.querySelector("img")).not.toBeInTheDocument();
    expect(getAllByText("No photo").length).toBeGreaterThan(0);
  });

  it("delivers the thumbnail when the build is configured for Cloudinary", () => {
    vi.stubEnv("NEXT_PUBLIC_CLOUDINARY_ENABLED", "1");
    const { container } = render(
      <ProductTable rows={[makeRow({ thumbnailUrl: CLOUDINARY_URL })]} />,
    );
    const images = container.querySelectorAll("img");
    expect(images.length).toBeGreaterThan(0);
    expect(images[0]).toHaveAttribute("src", CLOUDINARY_URL);
  });

  it("falls back instead of crashing when delivery is not configured", () => {
    // Regression: an undelivered remote URL handed to next/image throws
    // during render and took down the whole admin products page.
    vi.stubEnv("NEXT_PUBLIC_CLOUDINARY_ENABLED", "0");
    const { container, getAllByText, getByText } = render(
      <ProductTable rows={[makeRow({ thumbnailUrl: CLOUDINARY_URL })]} />,
    );
    expect(container.querySelector("img")).not.toBeInTheDocument();
    expect(getAllByText("Not shown").length).toBeGreaterThan(0);
    // The photo count stays honest: the photos exist, they are just not shown.
    expect(getByText("1 photo")).toBeInTheDocument();
  });

  it("never delivers arbitrary external hosts", () => {
    vi.stubEnv("NEXT_PUBLIC_CLOUDINARY_ENABLED", "1");
    const { container, getAllByText } = render(
      <ProductTable
        rows={[makeRow({ thumbnailUrl: "https://evil.example.com/tracker.jpg" })]}
      />,
    );
    expect(container.querySelector("img")).not.toBeInTheDocument();
    expect(getAllByText("Not shown").length).toBeGreaterThan(0);
  });
});
