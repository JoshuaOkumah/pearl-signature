/* eslint-disable @next/next/no-img-element -- next/image is mocked below so
   tests can assert delivered-image props without a build-time image config. */
import { render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ImageManager } from "@/components/admin/image-manager";

vi.mock("next/image", () => ({
  default: (props: Record<string, unknown>) => {
    const { src, alt } = props as { src: string; alt: string };
    return <img src={src} alt={alt} />;
  },
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

vi.mock("@/lib/actions/images", () => ({
  attachImageAction: vi.fn(),
  removeImageAction: vi.fn(),
  requestUploadSignatureAction: vi.fn(),
  saveImagesAction: vi.fn(),
}));

const CLOUDINARY_URL = "https://res.cloudinary.com/demo/image/upload/v1/products/egusi.jpg";

const images = [{ secureUrl: CLOUDINARY_URL, publicId: "products/egusi", alt: "Egusi soup" }];

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("ImageManager previews", () => {
  it("shows previews when the build is configured for Cloudinary", () => {
    vi.stubEnv("NEXT_PUBLIC_CLOUDINARY_ENABLED", "1");
    const { container, queryByText } = render(
      <ImageManager
        productId="p1"
        productName="Egusi Soup"
        images={images}
        uploadsConfigured={false}
      />,
    );
    expect(container.querySelector("img")).toHaveAttribute("src", CLOUDINARY_URL);
    expect(queryByText("Preview not available")).not.toBeInTheDocument();
    expect(queryByText(/not configured to display/)).not.toBeInTheDocument();
  });

  it("falls back with an explanation when delivery is not configured", () => {
    // Regression: next/image throws during render for hosts missing from the
    // build's remote-patterns, which crashed the product edit page.
    vi.stubEnv("NEXT_PUBLIC_CLOUDINARY_ENABLED", "0");
    const { container, getByText } = render(
      <ImageManager
        productId="p1"
        productName="Egusi Soup"
        images={images}
        uploadsConfigured={false}
      />,
    );
    expect(container.querySelector("img")).not.toBeInTheDocument();
    expect(getByText("Preview not available")).toBeInTheDocument();
    // Honest operator guidance: the photos are safe, delivery is a config step.
    expect(getByText(/Photos are saved in Cloudinary, but this server/)).toBeInTheDocument();
  });

  it("renders the empty state without the delivery notice when there are no photos", () => {
    vi.stubEnv("NEXT_PUBLIC_CLOUDINARY_ENABLED", "0");
    const { getByText, queryByText } = render(
      <ImageManager
        productId="p1"
        productName="Egusi Soup"
        images={[]}
        uploadsConfigured={false}
      />,
    );
    expect(getByText("No photos yet.")).toBeInTheDocument();
    expect(queryByText(/not configured to display/)).not.toBeInTheDocument();
  });
});
