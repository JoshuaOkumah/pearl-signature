/* eslint-disable @next/next/no-img-element -- next/image is mocked below so
   tests can assert delivered-image props without a build-time image config. */
import { render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ProductImage } from "@/types";
import { FoodMedia } from "@/components/shared/food-media";

vi.mock("next/image", () => ({
  default: (props: Record<string, unknown>) => {
    const { src, alt, className, sizes, fill, priority } = props as {
      src: string;
      alt: string;
      className?: string;
      sizes?: string;
      fill?: boolean;
      priority?: boolean;
    };
    return (
      <img
        src={src}
        alt={alt}
        className={className}
        data-sizes={sizes}
        data-fill={fill ? "yes" : undefined}
        data-priority={priority ? "yes" : undefined}
      />
    );
  },
}));

const image: ProductImage = {
  secureUrl: "https://res.cloudinary.com/demo/image/upload/v1/products/egusi.jpg",
  publicId: "products/egusi",
  alt: "A bowl of egusi soup garnished with greens",
  sortOrder: 0,
  width: 1200,
  height: 900,
};

const theme = { deep: "#6E5320", base: "#C9A24B", accent: "#5C7A58" };

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("FoodMedia", () => {
  it("renders the honest placeholder when there is no image", () => {
    const { container } = render(<FoodMedia theme={theme} label="Egusi Soup" />);
    // Decorative placeholder art stays hidden from assistive technology.
    expect(container.firstElementChild).toHaveAttribute("aria-hidden", "true");
    expect(container.querySelector("svg")).toBeInTheDocument();
    expect(container.querySelector("img")).not.toBeInTheDocument();
  });

  it("falls back to the placeholder when delivery is not configured", () => {
    vi.stubEnv("NEXT_PUBLIC_CLOUDINARY_ENABLED", "0");
    const { container } = render(<FoodMedia theme={theme} label="Egusi Soup" image={image} />);
    expect(container.querySelector("img")).not.toBeInTheDocument();
    expect(container.querySelector("svg")).toBeInTheDocument();
  });

  it("delivers configured Cloudinary images with real alt text", () => {
    vi.stubEnv("NEXT_PUBLIC_CLOUDINARY_ENABLED", "1");
    const { container } = render(
      <FoodMedia theme={theme} label="Egusi Soup" image={image} sizes="50vw" priority ratio="16/10" />,
    );

    const img = container.querySelector("img")!;
    expect(img).toHaveAttribute("src", image.secureUrl);
    expect(img).toHaveAttribute("alt", image.alt);
    expect(img).toHaveAttribute("data-sizes", "50vw");
    expect(img).toHaveAttribute("data-priority", "yes");
    // Real imagery is exposed to assistive technology (not aria-hidden).
    expect(container.firstElementChild).not.toHaveAttribute("aria-hidden");
    // Fixed ratio container prevents layout shift.
    expect(container.firstElementChild?.className).toContain("aspect-[16/10]");
  });

  it("never delivers arbitrary external hosts", () => {
    vi.stubEnv("NEXT_PUBLIC_CLOUDINARY_ENABLED", "1");
    const { container } = render(
      <FoodMedia
        theme={theme}
        label="Egusi Soup"
        image={{ ...image, secureUrl: "https://evil.example.com/tracker.jpg" }}
      />,
    );
    expect(container.querySelector("img")).not.toBeInTheDocument();
    expect(container.querySelector("svg")).toBeInTheDocument();
  });
});

describe("FoodMedia ids", () => {
  it("keeps SVG gradient ids unique per instance", () => {
    render(<FoodMedia theme={theme} label="Zobo" idSuffix="first" />);
    const { container } = render(<FoodMedia theme={theme} label="Zobo" idSuffix="second" />);
    const gradientId = container.querySelector("linearGradient")?.id;
    expect(gradientId).toBe("zobo-second-bg");
    expect(document.querySelectorAll("#zobo-second-bg")).toHaveLength(1);
  });
});
