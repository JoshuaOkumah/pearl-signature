import { Skeleton } from "@/components/ui/skeleton";

/** Streaming fallback while a product page's database read resolves. */
export default function ProductLoading() {
  return (
    <div className="mx-auto w-full max-w-6xl px-5 pb-16 pt-8 md:px-8 md:pt-12" aria-hidden="true">
      <Skeleton className="h-5 w-64" />
      <div className="mt-7 grid gap-8 lg:grid-cols-2 lg:gap-14">
        <Skeleton className="aspect-[4/3] w-full rounded-3xl" />
        <div className="space-y-4">
          <Skeleton className="h-4 w-28" />
          <Skeleton className="h-10 w-3/4" />
          <Skeleton className="h-5 w-full" />
          <Skeleton className="h-5 w-5/6" />
          <Skeleton className="mt-6 h-10 w-44 rounded-full" />
          <div className="space-y-3 pt-6">
            <Skeleton className="h-5 w-full" />
            <Skeleton className="h-5 w-full" />
            <Skeleton className="h-5 w-4/5" />
          </div>
        </div>
      </div>
    </div>
  );
}
