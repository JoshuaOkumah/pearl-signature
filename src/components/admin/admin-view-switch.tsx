import Link from "next/link";
import { cn } from "@/lib/utils";

export type AdminDashboardView = "simple" | "analytics";

/**
 * Dashboard view switch.
 *
 * A plain link pair rather than client state: the choice survives a reload,
 * can be bookmarked, works with Back/Forward, and needs no JavaScript. The
 * server renders the chosen view in full, so neither view is a hidden
 * client-only branch.
 */
export function AdminViewSwitch({ view }: { view: AdminDashboardView }) {
  return (
    <div className="flex flex-col items-start gap-1.5 sm:items-end">
      <div
        role="group"
        aria-label="Dashboard view"
        className="inline-flex rounded-full border border-navy/15 bg-surface p-1"
      >
        {[
          { key: "simple" as const, href: "/admin", label: "Simple" },
          { key: "analytics" as const, href: "/admin?view=analytics", label: "Analytics" },
        ].map((option) => {
          const active = view === option.key;
          return (
            <Link
              key={option.key}
              href={option.href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "inline-flex min-h-9 items-center rounded-full px-4 font-sans text-sm font-semibold transition-colors focus-gold",
                active ? "bg-navy text-cream" : "text-navy-700 hover:bg-cream-100",
              )}
            >
              {option.label}
            </Link>
          );
        })}
      </div>
      <p className="font-sans text-xs text-ink-muted">
        {view === "simple"
          ? "Simple shows what needs you today."
          : "Analytics shows the week at a glance."}
      </p>
    </div>
  );
}
