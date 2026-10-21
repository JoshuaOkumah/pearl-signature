import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
  {
    // Database internals must never be imported from components (including
    // Client Components) — catalogue reads go through the repository layer,
    // which returns plain DTOs.
    files: ["src/components/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            { name: "@/lib/db/mongoose", message: "Use the repository layer (src/lib/repositories) instead." },
            { name: "@/models/category", message: "Mongoose models stay in server-side code; use repositories." },
            { name: "@/models/product", message: "Mongoose models stay in server-side code; use repositories." },
          ],
        },
      ],
    },
  },
]);

export default eslintConfig;
