import type { Metadata } from "next";
import { connection } from "next/server";
import { redirect } from "next/navigation";
import { LockKeyhole } from "lucide-react";
import { getCurrentAdmin } from "@/lib/auth/session";
import { LoginForm } from "@/components/admin/login-form";

export const metadata: Metadata = {
  title: "Sign in",
};

/**
 * `/admin/login` — the only unauthenticated admin route.
 *
 * An already-signed-in owner is moved straight to the dashboard. There is
 * no registration flow: owner accounts exist only through the guarded
 * bootstrap CLI (scripts/admin-bootstrap.ts).
 */
export default async function AdminLoginPage() {
  // Always render at request time: the sign-in state is per-request, so no
  // prerender or prefetch pass may execute the session lookup.
  await connection();
  const admin = await getCurrentAdmin();
  if (admin && admin.role === "owner") redirect("/admin");

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center bg-cream px-5 py-12">
      <main className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <p className="font-serif text-2xl font-semibold tracking-[0.08em] text-navy">
            PEARL SIGNATURE
          </p>
          <p className="mt-1 font-sans text-sm font-medium text-ink-muted">Store administration</p>
        </div>

        <div className="rounded-2xl border border-border bg-surface p-6 shadow-sm sm:p-8">
          <div className="mb-6 flex items-center gap-3">
            <span className="flex size-10 items-center justify-center rounded-full bg-navy text-cream">
              <LockKeyhole className="size-5" aria-hidden="true" />
            </span>
            <h1 className="font-serif text-2xl font-semibold text-navy">Sign in</h1>
          </div>
          <LoginForm />
        </div>

        <p className="mt-6 text-center font-sans text-[13px] text-ink-muted">
          This area is for the business owner only.
        </p>
      </main>
    </div>
  );
}
