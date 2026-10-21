import { MAX_SEARCH_LENGTH } from "@/lib/validations/catalogue";

/**
 * Title-first search relevance (Phase 2B).
 *
 * Pure functions shared by the database path and the fixtures path in
 * `src/lib/repositories/catalogue.ts` so both sources match identically.
 * Search looks at product NAMES ONLY — descriptions, category names and
 * tags are deliberately excluded (customers filter by category through the
 * dedicated chips; descriptions produced single-letter false positives like
 * "f" matching "favourite" inside a description).
 *
 * Matching rules, by query length:
 *
 * - 1 character: names *beginning with* the character (tier 1 only).
 * - 2 characters: name prefix (tier 1) or word prefix (tier 2).
 * - 3+ characters: the above plus literal substrings inside the name
 *   (tier 3), ranked last.
 *
 * Tiers double as the relevance rank: 1 (best) → 3 (worst). Callers break
 * remaining ties deterministically with `compareSearchRelevance` so result
 * order is stable across requests and pagination pages.
 *
 * Every term is escaped before entering a regular expression, and terms are
 * length-bounded, so user input can never build a pathological pattern.
 * No Atlas Search or paid plan is involved.
 */

/** From this length, literal substrings inside a name also count. */
export const MIN_SUBSTRING_LENGTH = 3;

/** Escape user input into a literal regular-expression pattern. */
export function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Fold raw input into a comparable term: trimmed, internal whitespace
 * collapsed to single spaces, case-folded, length-bounded. Returns null
 * when nothing usable remains (empty or whitespace-only input).
 */
export function normalizeSearchTerm(raw?: string | null): string | null {
  const term = (raw ?? "")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase()
    .slice(0, MAX_SEARCH_LENGTH);
  return term ? term : null;
}

/** Relevance tier of a product name for an already-normalized term. */
export type NameMatchTier = 0 | 1 | 2 | 3;

/**
 * How a product name matches a normalized term:
 *
 * - 0: no match (the product must be excluded)
 * - 1: the name begins with the term
 * - 2: an individual word in the name begins with the term
 * - 3: the term appears as a literal substring (3+ character terms only)
 */
export function nameMatchTier(name: string, term: string): NameMatchTier {
  // Terms should already be normalized; case folding is applied again here
  // (idempotent) so no caller can accidentally make matching case-sensitive.
  const needle = term.toLowerCase();
  const folded = name.toLowerCase();
  if (folded.startsWith(needle)) return 1;
  // Word tokens mirror the regex \b semantics used by the database query:
  // maximal runs of letters and digits (hyphens/apostrophes split words).
  const words = folded.split(/[^a-z0-9]+/);
  if (words.some((word) => word.startsWith(needle))) return 2;
  if (needle.length >= MIN_SUBSTRING_LENGTH && folded.includes(needle)) return 3;
  return 0;
}

/**
 * Candidate pattern for the database query. This matches exactly the union
 * of the tiers for the term length, so the database returns the true match
 * set (no extra documents, none missing) and `nameMatchTier` can rank the
 * candidates in memory:
 *
 * - 1 character: `^f` (name prefix only)
 * - 2 characters: `(?:^|\b)me` (name or word prefix)
 * - 3+ characters: plain substring (a superset of both prefix tiers)
 */
export function searchCandidateRegex(term: string): RegExp {
  const escaped = escapeRegExp(term);
  if (term.length === 1) return new RegExp(`^${escaped}`, "i");
  if (term.length < MIN_SUBSTRING_LENGTH) return new RegExp(`(?:^|\\b)${escaped}`, "i");
  return new RegExp(escaped, "i");
}

export interface RelevanceSortable {
  name: string;
  sortOrder: number;
  slug: string;
}

/**
 * Deterministic relevance ordering: match tier first, then catalogue sort
 * order, then slug (unique, so ties can never reorder between requests or
 * across pagination pages).
 */
export function compareSearchRelevance(
  a: RelevanceSortable,
  b: RelevanceSortable,
  term: string,
): number {
  const tier = nameMatchTier(a.name, term) - nameMatchTier(b.name, term);
  if (tier !== 0) return tier;
  if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
  return a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0;
}
