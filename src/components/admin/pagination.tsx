import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Admin list pagination (Phase 3).
 *
 * Pure links (no client state): every page is a real URL that preserves
 * the current filters, so lists are shareable and Back/Forward work.
 */
export function Pagination({
  page,
  totalPages,
  buildHref,
}: {
  page: number;
  totalPages: number;
  buildHref: (page: number) => string;
}) {
  if (totalPages <= 1) return null;

  const numbers: number[] = [];
  const start = Math.max(1, Math.min(page - 2, totalPages - 4));
  const end = Math.min(totalPages, start + 4);
  for (let index = start; index <= end; index += 1) numbers.push(index);

  return (
    <nav aria-label="Product list pages" className="flex flex-wrap items-center justify-between gap-3">
      <p className="font-sans text-sm text-ink-muted">
        Page {page} of {totalPages}
      </p>
      <div className="flex items-center gap-1.5">
        {page > 1 ? (
          <Link
            href={buildHref(page - 1)}
            className="inline-flex min-h-10 items-center gap-1 rounded-lg border border-navy/25 px-3 font-sans text-sm font-semibold text-navy transition-colors hover:border-navy hover:bg-navy hover:text-cream focus-gold"
          >
            <ChevronLeft className="size-4" aria-hidden="true" />
            Previous
          </Link>
        ) : null}
        {numbers.map((number) => (
          <Link
            key={number}
            href={buildHref(number)}
            aria-current={number === page ? "page" : undefined}
            className={cn(
              "inline-flex size-10 items-center justify-center rounded-lg font-sans text-sm font-semibold transition-colors focus-gold",
              number === page
                ? "bg-navy text-cream"
                : "border border-navy/25 text-navy hover:border-navy hover:bg-navy hover:text-cream",
            )}
          >
            {number}
          </Link>
        ))}
        {page < totalPages ? (
          <Link
            href={buildHref(page + 1)}
            className="inline-flex min-h-10 items-center gap-1 rounded-lg border border-navy/25 px-3 font-sans text-sm font-semibold text-navy transition-colors hover:border-navy hover:bg-navy hover:text-cream focus-gold"
          >
            Next
            <ChevronRight className="size-4" aria-hidden="true" />
          </Link>
        ) : null}
      </div>
    </nav>
  );
}
