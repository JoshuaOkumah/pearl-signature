/**
 * Admin catalogue policy constants (Phase 3).
 *
 * Client-safe by design: no `server-only`, no database, no secrets. The
 * admin UI quotes these strings, and the server repositories re-export them,
 * so the wording lives in exactly one place. Keep this module free of any
 * server-only import or Node API.
 */
export const CATEGORY_VISIBILITY_POLICY =
  "Disabled categories are hidden from public navigation, chips and listings; their products stop appearing publicly while the category is disabled, and return when it is re-enabled. Products keep their category assignment throughout.";
