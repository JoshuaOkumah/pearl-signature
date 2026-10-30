import { defineConfig, devices } from "@playwright/test";
import { E2E_ADMIN_EMAIL, E2E_ADMIN_ORIGIN, E2E_ADMIN_PASSWORD } from "./e2e/admin/credentials";

/**
 * Playwright runs four suites against ONE production build:
 *
 *  - "chromium" (Phase 1/2 storefront smoke): port 3000, labelled preview
 *    fixtures, `CATALOGUE_SOURCE=fixtures`, no cloud credentials. Every
 *    fixture is deliberately unpriced, so this suite also proves that no
 *    purchase controls appear where nothing can be bought.
 *  - "cart" (Phase 4): port 3002, the SAME build plus
 *    `E2E_PURCHASABLE_FIXTURES=1`, which adds a handful of clearly-labelled
 *    synthetic orderable products. Cart and checkout cannot be exercised
 *    against the unpriced fixtures.
 *  - "admin" (Phase 3): port 3001 with MONGODB_URI pointed at a disposable
 *    in-memory MongoDB. The harness waits for the storefront server (which
 *    owns `next build`), seeds the database, bootstraps the disposable
 *    owner and starts `next start` on 3001.
 *  - "orders" (Phase 5): port 3003, the same disposable-database pattern
 *    plus the labelled orderable fixtures, a labelled test store
 *    configuration and the whole order stack (checkout → order →
 *    confirmation → admin order management).
 *  - "tracking" (Phase 7): port 3004, its own disposable database and a single
 *    seeded tracking order, so the Phase 5 order counts stay untouched. The
 *    same harness script runs with `E2E_TRACKING_FIXTURE=1`, which enables the
 *    file-sink email provider (no real message can leave) and the guarded
 *    processor secret.
 *
 * Browsers must be installed first: `npx playwright install chromium`.
 * Stop any stray dev/prod server on ports 3000/3001/3002/3003 before running.
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
      testIgnore: ["**/admin/**", "**/cart/**", "**/orders/**", "**/tracking/**"],
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "cart",
      testMatch: "**/cart/**/*.spec.ts",
      use: { ...devices["Desktop Chrome"], baseURL: "http://localhost:3002" },
    },
    {
      name: "admin",
      testMatch: "**/admin/**/*.spec.ts",
      use: { ...devices["Desktop Chrome"], baseURL: E2E_ADMIN_ORIGIN },
    },
    {
      name: "orders",
      testMatch: "**/orders/**/*.spec.ts",
      use: { ...devices["Desktop Chrome"], baseURL: "http://localhost:3003" },
    },
    {
      name: "tracking",
      testMatch: "**/tracking/**/*.spec.ts",
      use: { ...devices["Desktop Chrome"], baseURL: "http://localhost:3004" },
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
        // `.env.local` may carry a real MONGODB_URI, and resolveCatalogueSource
        // gives the URI precedence over CATALOGUE_SOURCE. Without this the
        // suite would read the operator's live catalogue instead of the
        // labelled fixtures — non-hermetic, and missing every fixture-only
        // assertion. An empty value is treated as unconfigured (and `.env.local`
        // loading never overwrites a variable that is already defined).
        MONGODB_URI: "",
        // Same reasoning as the cart/admin harnesses: `.env.local` carries the
        // owner's cloud name, which may not match the `pearl-signature-preview`
        // cloud the preview fixtures reference (pending owner decision). An
        // empty value makes isCloudinaryUrl fall back to its URL-shape check,
        // so preview media slots survive validation and the suite never depends
        // on cloud credentials (build-time delivery switches itself off too).
        CLOUDINARY_CLOUD_NAME: "",
      },
    },
    {
      command: "npx tsx scripts/e2e-cart-server.ts",
      url: "http://localhost:3002",
      reuseExistingServer: false,
      timeout: 300_000,
      env: {
        E2E_STOREFRONT_URL: "http://localhost:3000",
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
    {
      command: "npx tsx scripts/e2e-orders-server.ts",
      url: "http://localhost:3003",
      reuseExistingServer: false,
      timeout: 300_000,
      env: {
        E2E_ADMIN_EMAIL,
        E2E_ADMIN_PASSWORD,
        E2E_STOREFRONT_URL: "http://localhost:3000",
      },
    },
    {
      command: "npx tsx scripts/e2e-orders-server.ts",
      url: "http://localhost:3004",
      reuseExistingServer: false,
      timeout: 300_000,
      env: {
        E2E_ADMIN_EMAIL,
        E2E_ADMIN_PASSWORD,
        E2E_STOREFRONT_URL: "http://localhost:3000",
        E2E_SERVER_PORT: "3004",
        E2E_DB_NAME: "pearl_signature_e2e_tracking",
        E2E_TRACKING_FIXTURE: "1",
      },
    },
  ],
});
