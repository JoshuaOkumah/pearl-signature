import type { ReactNode } from "react";
import { connection } from "next/server";
import { requirePageAdmin } from "@/lib/auth/guard";
import { AdminShell } from "@/components/admin/admin-shell";

/**
 * Protected admin area (Phase 3).
 *
 * `requirePageAdmin()` resolves the session cookie against MongoDB on
 * every request and redirects anonymous visitors to the login screen.
 * This is navigation UX — each Server Action independently re-checks
 * authorization (see src/lib/auth/guard.ts), so a mutation can never
 * succeed through a forged page reach alone.
 *
 * Because the layout reads cookies, every admin route is dynamically
 * rendered and never enters a shared cache.
 */
export default async function DashboardLayout({ children }: { children: ReactNode }) {
  // The entire admin subtree is per-request: defer before the session
  // lookup so no prerender or prefetch pass executes it (the MongoDB
  // session query reads current time internally, which would otherwise
  // trip the blocking current-time guard during shell attempts).
  await connection();
  const admin = await requirePageAdmin();

  return <AdminShell email={admin.email}>{children}</AdminShell>;
}
