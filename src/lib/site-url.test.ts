import { afterEach, describe, expect, it, vi } from "vitest";
import { absoluteUrl, siteUrl } from "./site-url";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("siteUrl", () => {
  it("returns null when unconfigured (no fabricated domains)", () => {
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "");
    expect(siteUrl()).toBeNull();
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "   ");
    expect(siteUrl()).toBeNull();
  });

  it("normalises a configured origin", () => {
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://pearlsignature.ca/");
    expect(siteUrl()).toBe("https://pearlsignature.ca");
  });

  it("rejects unusable values", () => {
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "not-a-url");
    expect(siteUrl()).toBeNull();
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "mailto:hello@example.com");
    expect(siteUrl()).toBeNull();
  });
});

describe("absoluteUrl", () => {
  it("builds absolute paths only when a site URL exists", () => {
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://pearlsignature.ca");
    expect(absoluteUrl("/menu/egusi-soup")).toBe("https://pearlsignature.ca/menu/egusi-soup");
    expect(absoluteUrl("menu")).toBe("https://pearlsignature.ca/menu");

    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "");
    expect(absoluteUrl("/menu")).toBeNull();
  });
});
