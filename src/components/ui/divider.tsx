import { cn } from "@/lib/utils";

/** Decorative divider — a hairline with a small gold diamond, evoking a pearl-set table. */
export function Divider({ className }: { className?: string }) {
  return (
    <div aria-hidden="true" className={cn("flex items-center gap-3", className)}>
      <span className="h-px flex-1 bg-gradient-to-r from-transparent via-sand to-sand" />
      <span className="block h-1.5 w-1.5 rotate-45 bg-gold" />
      <span className="h-px flex-1 bg-gradient-to-l from-transparent via-sand to-sand" />
    </div>
  );
}
