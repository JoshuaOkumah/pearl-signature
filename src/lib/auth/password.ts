import "server-only";

/**
 * Password hashing entry point for application code (Phase 3).
 *
 * The implementation lives in password-core.ts so the operator CLI
 * scripts (bootstrap / reset) can reuse it under plain tsx, where the
 * `server-only` import would throw. This module re-exports everything
 * WITH the server-only guard, so a client bundle can never include the
 * hashing code.
 */
export * from "./password-core";
