import { cn } from "@/lib/utils";

/**
 * Loading placeholder used in Suspense fallbacks.
 * `motion-safe` keeps the pulse away from reduced-motion users.
 */
export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden="true" className={cn("rounded-xl bg-cream-200 motion-safe:animate-pulse", className)} />;
}
