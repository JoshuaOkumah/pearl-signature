import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import tsconfigPaths from "vite-tsconfig-paths";

const dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [tsconfigPaths(), react()],
  resolve: {
    alias: [
      // `server-only` throws outside a React Server environment (its default
      // export). Tests exercise server modules in plain Node, so resolve it
      // to the same no-op module the "react-server" condition provides.
      { find: /^server-only$/, replacement: path.join(dirname, "node_modules", "server-only", "empty.js") },
    ],
  },
  test: {
    environment: "jsdom",
    setupFiles: ["./vitest.setup.ts"],
    include: ["src/**/*.test.{ts,tsx}"],
  },
});
