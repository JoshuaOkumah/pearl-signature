import { Skeleton } from "@/components/ui/skeleton";

/** Suspense fallback shown while the menu's search params and data resolve. */
export function MenuExplorerSkeleton() {
  return (
    <div aria-hidden="true">
      <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-wrap gap-2.5">
          {["w-24", "w-44", "w-44", "w-24"].map((width, index) => (
            <Skeleton key={index} className={`h-10 rounded-full ${width}`} />
          ))}
        </div>
        <div className="w-full rounded-full lg:w-72">
          <Skeleton className="h-12 w-full rounded-full" />
        </div>
      </div>
      <Skeleton className="mt-6 h-5 w-56" />
      <div className="mt-6 grid gap-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {Array.from({ length: 8 }).map((_, index) => (
          <div key={index} className="overflow-hidden rounded-3xl border border-border bg-surface">
            <Skeleton className="aspect-[4/3] w-full rounded-none" />
            <div className="space-y-3 p-5">
              <Skeleton className="h-3 w-24" />
              <Skeleton className="h-6 w-32" />
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-28" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
