/**
 * DISPOSABLE credentials and endpoints for the Phase 3 admin E2E suite.
 *
 * Every `npm run test:e2e` run creates these credentials fresh inside a
 * throwaway in-memory MongoDB (scripts/e2e-admin-server.ts). They exist
 * nowhere else, protect nothing, and must NEVER be reused for a real
 * account. Password is passed via environment variables only, never argv.
 */
export const E2E_ADMIN_ORIGIN = "http://localhost:3001";
export const E2E_ADMIN_EMAIL = "owner@pearl-e2e.test";
export const E2E_ADMIN_PASSWORD = "E2eAdminOnly-2026!";
