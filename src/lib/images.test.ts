import { afterEach, describe, expect, it, vi } from "vitest";
import { canDeliverImage, isCloudinaryDeliveryEnabled, isCloudinaryUrl } from "./images";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("isCloudinaryUrl", () => {
  it("accepts HTTPS upload URLs on res.cloudinary.com", () => {
    expect(isCloudinaryUrl("https://res.cloudinary.com/demo/image/upload/sample.jpg")).toBe(true);
    expect(isCloudinaryUrl("https://res.cloudinary.com/demo/image/upload/v12345/f_1.jpg")).toBe(true);
  });

  it("rejects everything else", () => {
    expect(isCloudinaryUrl("http://res.cloudinary.com/demo/image/upload/a.jpg")).toBe(false); // plain HTTP
    expect(isCloudinaryUrl("https://evil.example.com/image/upload/a.jpg")).toBe(false); // wrong host
    expect(isCloudinaryUrl("https://res.cloudinary.com/demo/raw/upload/a.png")).toBe(false); // raw, not image
    expect(isCloudinaryUrl("https://res.cloudinary.com/demo/image/list/a.jpg")).toBe(false); // wrong action
    expect(isCloudinaryUrl("javascript:alert(1)")).toBe(false);
    expect(isCloudinaryUrl("not a url")).toBe(false);
    expect(isCloudinaryUrl(null)).toBe(false);
    expect(isCloudinaryUrl(undefined)).toBe(false);
    expect(isCloudinaryUrl(42)).toBe(false);
  });

  it("pins URLs to the configured cloud when a cloud name is set", () => {
    vi.stubEnv("CLOUDINARY_CLOUD_NAME", "pearl-signature");
    expect(isCloudinaryUrl("https://res.cloudinary.com/pearl-signature/image/upload/a.jpg")).toBe(true);
    expect(isCloudinaryUrl("https://res.cloudinary.com/other-cloud/image/upload/a.jpg")).toBe(false);
  });
});

describe("delivery gating", () => {
  it("is disabled unless enabled at build time", () => {
    vi.stubEnv("NEXT_PUBLIC_CLOUDINARY_ENABLED", "0");
    expect(isCloudinaryDeliveryEnabled()).toBe(false);
    expect(canDeliverImage({ secureUrl: "https://res.cloudinary.com/demo/image/upload/a.jpg" })).toBe(false);
  });

  it("delivers only validated Cloudinary URLs when enabled", () => {
    vi.stubEnv("NEXT_PUBLIC_CLOUDINARY_ENABLED", "1");
    expect(canDeliverImage({ secureUrl: "https://res.cloudinary.com/demo/image/upload/a.jpg" })).toBe(true);
    expect(canDeliverImage({ secureUrl: "https://evil.example.com/a.jpg" })).toBe(false);
    expect(canDeliverImage(null)).toBe(false);
  });
});
