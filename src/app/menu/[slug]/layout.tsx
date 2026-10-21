import type { ReactNode } from "react";
import { connection } from "next/server";

/**
 * `/menu/[slug]` is request-rendered end to end.
 *
 * `connection()` marks this segment as needing the request, so no part of it
 * is ever prerendered at build time and every visit reads the database
 * fresh. The genuine `404` status codes are decided one layer earlier, in
 * `src/proxy.ts`, before any response (shell or otherwise) starts.
 *
 * Scoped to this segment only: every other route keeps its Phase 1/2
 * prerendered shell and instant navigations.
 */
export default async function ProductSlugLayout({ children }: { children: ReactNode }) {
  await connection();
  return <>{children}</>;
}
