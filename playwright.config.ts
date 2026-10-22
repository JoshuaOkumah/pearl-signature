import { defineConfig, devices } from "@playwright/test";
import { E2E_ADMIN_EMAIL, E2E_ADMIN_ORIGIN, E2E_ADMIN_PASSWORD } from "./e2e/admin/credentials";

/**
 * Playwright runs two suites against ONE production build:
 *
 *  - "chromium" (Phase 1/2 storefront smoke): port 3000, labelled preview
 *    fixtures, `CATALOGUE_SOURCE=fixtures`, no cloud credentials.
 *  - "admin" (Phase 3): port 3001 with MONGODB_URI pointed at a disposable
 *    in-memory MongoDB. The harness waits for the storefront server (which
 *    owns `next build`), seeds the database, bootstraps the disposable
 *    owner and starts `next start` on 3001.
 *
 * Browsers must be installed first: `npx playwright install chromium`.
 * Stop any stray dev/prod server on ports 3000/3001 before running.
 *
 * Reliability notes: e2e runs against `next build` + `next start` rather
 * than `next dev` because dev's on-demand Turbopack under parallel workers
 * makes client-side transitions miss assertion timeouts spuriously, and
 * because 404 statuses, metadata and PPR behaviour are only exactly what
 * production serves.
 */
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  reporter: "list",
  use: {
    baseURL: "http://localhost:3000",
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      testIgnore: "**/admin/**",
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "admin",
      testMatch: "**/admin/**/*.spec.ts",
      use: { ...devices["Desktop Chrome"], baseURL: E2E_ADMIN_ORIGIN },
    },
  ],
  webServer: [
    {
      command: "npm run build && npm run start",
      url: "http://localhost:3000",
      reuseExistingServer: false,
      timeout: 240_000,
      env: {
        CATALOGUE_SOURCE: "fixtures",
      },
    },
    {
      command: "npx tsx scripts/e2e-admin-server.ts",
      url: E2E_ADMIN_ORIGIN,
      reuseExistingServer: false,
      timeout: 300_000,
      env: {
        E2E_ADMIN_EMAIL,
        E2E_ADMIN_PASSWORD,
        E2E_STOREFRONT_URL: "http://localhost:3000",
      },
    },
  ],
});
