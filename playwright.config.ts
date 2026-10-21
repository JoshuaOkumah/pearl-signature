import { defineConfig, devices } from "@playwright/test";

/**
 * Playwright is configured for Phase 1 smoke coverage and future E2E suites.
 * Browsers must be installed first: `npx playwright install chromium`.
 */
/**
 * E2E runs against the PRODUCTION server (`next build` + `next start`) with
 * the labelled preview fixtures. Two reasons over `next dev`:
 *  - reliability: dev's on-demand Turbopack compiles under 5 parallel workers
 *    makes client-side transitions miss 5s assertion timeouts spuriously;
 *  - fidelity: the 404 statuses, proxy checks, metadata and PPR behaviour are
 *    only exactly what production serves.
 *
 * The webServer command builds first, so the suite always tests the current
 * tree. Stop any stray dev/prod server on port 3000 before running.
 */
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  reporter: "list",
  use: {
    baseURL: "http://localhost:3000",
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "npm run build && npm run start",
    url: "http://localhost:3000",
    reuseExistingServer: false,
    timeout: 240_000,
    env: {
      CATALOGUE_SOURCE: "fixtures",
    },
  },
});
