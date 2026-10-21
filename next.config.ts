import type { NextConfig } from "next";

/**
 * Cloudinary delivery (Phase 2): product images are served from
 * `res.cloudinary.com` through next/image — but ONLY when a cloud name is
 * configured at build time. The remote pattern is scoped to that exact cloud,
 * so no arbitrary external host can ever reach the image loader, and the
 * inlined NEXT_PUBLIC_CLOUDINARY_ENABLED flag keeps the runtime render guard
 * in src/lib/images.ts in agreement with this configuration.
 */
const cloudName = process.env.CLOUDINARY_CLOUD_NAME?.trim() ?? "";

const nextConfig: NextConfig = {
  /* config options here */
  cacheComponents: true,
  partialPrefetching: true,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
  ...(cloudName
    ? {
        images: {
          remotePatterns: [
            {
              protocol: "https",
              hostname: "res.cloudinary.com",
              pathname: `/${cloudName}/image/upload/**`,
            },
          ],
        },
      }
    : {}),
  env: {
    NEXT_PUBLIC_CLOUDINARY_ENABLED: cloudName ? "1" : "0",
  },
};

export default nextConfig;
