/* eslint-disable @next/next/no-img-element -- next/image mocked for prop assertions. */
import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ProductImage } from "@/types";
import { ProductGallery } from "./product-gallery";

vi.mock("next/image", () => ({
  default: (props: Record<string, unknown>) => {
    const { src, alt, className } = props as { src: string; alt: string; className?: string };
    return <img src={src} alt={alt} className={className} />;
  },
}));

const theme = { deep: "#6E5320", base: "#C9A24B", accent: "#5C7A58" };

const primary: ProductImage = {
  secureUrl: "https://res.cloudinary.com/demo/image/upload/v1/products/soup-1.jpg",
  alt: "Egusi soup served in a bowl",
  sortOrder: 0,
};
const secondary: ProductImage = {
  secureUrl: "https://res.cloudinary.com/demo/image/upload/v1/products/soup-2.jpg",
  alt: "Egusi soup with sides on a table",
  sortOrder: 1,
};

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_CLOUDINARY_ENABLED", "1");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("ProductGallery", () => {
  it("renders the placeholder when the product has no images", () => {
    const { container } = render(<ProductGallery images={[]} productName="Egusi Soup" theme={theme} />);
    expect(container.querySelector("svg")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Show image/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
  });

  it("shows a single image with no thumbnail row", () => {
    render(<ProductGallery images={[primary]} productName="Egusi Soup" theme={theme} />);
    const main = screen.getByRole("img");
    expect(main).toHaveAttribute("alt", primary.alt);
    expect(screen.queryByRole("button", { name: /Show image/ })).not.toBeInTheDocument();
  });

  it("supports selecting images with visible state", () => {
    render(<ProductGallery images={[primary, secondary]} productName="Egusi Soup" theme={theme} />);

    const first = screen.getByRole("button", { name: /Show image 1 of 2/ });
    const second = screen.getByRole("button", { name: /Show image 2 of 2/ });
    expect(first).toHaveAttribute("aria-pressed", "true");
    expect(second).toHaveAttribute("aria-pressed", "false");

    fireEvent.click(second);
    expect(second).toHaveAttribute("aria-pressed", "true");
    expect(first).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByAltText(secondary.alt)).toBeInTheDocument();
    expect(screen.queryByAltText(primary.alt)).not.toBeInTheDocument();
  });

  it("cycles images with arrow keys, moving focus with selection", () => {
    render(<ProductGallery images={[primary, secondary]} productName="Egusi Soup" theme={theme} />);

    const first = screen.getByRole("button", { name: /Show image 1 of 2/ });
    const second = screen.getByRole("button", { name: /Show image 2 of 2/ });

    first.focus();
    fireEvent.keyDown(first, { key: "ArrowRight" });
    expect(second).toHaveAttribute("aria-pressed", "true");
    expect(second).toHaveFocus();

    // Wraps around from the last image.
    fireEvent.keyDown(second, { key: "ArrowRight" });
    expect(first).toHaveAttribute("aria-pressed", "true");
    expect(first).toHaveFocus();

    fireEvent.keyDown(first, { key: "ArrowLeft" });
    expect(second).toHaveAttribute("aria-pressed", "true");
    expect(second).toHaveFocus();
  });

  it("ignores unrelated keys", () => {
    render(<ProductGallery images={[primary, secondary]} productName="Egusi Soup" theme={theme} />);
    const first = screen.getByRole("button", { name: /Show image 1 of 2/ });
    first.focus();
    fireEvent.keyDown(first, { key: "Enter" });
    expect(first).toHaveAttribute("aria-pressed", "true");
    expect(first).toHaveFocus();
  });
});
