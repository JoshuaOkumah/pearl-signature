import type { MetadataRoute } from "next";

/**
 * Web app manifest (PWA / add-to-home-screen identity).
 *
 * The icons are the same official-artwork derivatives used for the favicon
 * and Apple touch icon: `src/app/icon.png` (512×512) and
 * `src/app/apple-icon.png` (180×180), both served from the app root.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "CLIVS",
    short_name: "CLIVS",
    description:
      "Authentic Nigerian cuisine, made beautifully. Order soups, classics, pastries, snacks and traditional drinks online.",
    start_url: "/",
    display: "standalone",
    background_color: "#FAFAF5",
    theme_color: "#243D30",
    icons: [
      { src: "/icon.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/apple-icon.png", sizes: "180x180", type: "image/png", purpose: "any" },
    ],
  };
}
