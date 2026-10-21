"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { AlertTriangle, SearchX } from "lucide-react";
import { Button, ButtonLink } from "@/components/ui/button";

/**
 * Customer-safe states around the catalogue:
 *
 * - `MenuEmpty`: the current filter/search matched nothing.
 * - `MenuPastEnd`: a valid URL pointed beyond the last page.
 * - `MenuPreparing`: the database is reachable but has no published products.
 * - `CatalogueUnavailable`: the database could not be read. Server-side
 *   diagnostics carry the detail; this state never shows internals.
 */

interface ResetProps {
  onReset: () => void;
}

export function MenuEmpty({ onReset, search }: ResetProps & { search?: string }) {
  return (
    <div className="flex flex-col items-center rounded-3xl border border-dashed border-sand bg-cream-100 px-6 py-16 text-center">
      <span className="flex h-14 w-14 items-center justify-center rounded-full bg-cream-200 text-ink-muted">
        <SearchX className="h-6 w-6" aria-hidden="true" />
      </span>
      <h3 className="mt-5 font-display text-xl font-semibold text-navy">Nothing here yet</h3>
      <p className="mt-2 max-w-sm text-sm leading-relaxed text-ink-muted">
        {search
          ? `We couldn’t find any dishes matching “${search}”. Check the spelling, or clear the search to see the full menu.`
          : "We couldn’t find any dishes matching this view. Try another category or a different search."}
      </p>
      <Button variant="outline" className="mt-6" onClick={onReset}>
        View everything
      </Button>
    </div>
  );
}

export function MenuPreparing() {
  return (
    <div className="flex flex-col items-center rounded-3xl border border-dashed border-sand bg-cream-100 px-6 py-16 text-center">
      <span className="flex h-14 w-14 items-center justify-center rounded-full bg-cream-200 text-leaf-700">
        <SearchX className="h-6 w-6" aria-hidden="true" />
      </span>
      <h3 className="mt-5 font-display text-xl font-semibold text-navy">The menu is being prepared</h3>
      <p className="mt-2 max-w-sm text-sm leading-relaxed text-ink-muted">
        Dishes will appear here as soon as the catalogue is published. Thank you for your patience.
      </p>
      <ButtonLink href="/" variant="outline" className="mt-6">
        Back to home
      </ButtonLink>
    </div>
  );
}

export function MenuPastEnd({ page, onReset }: { page: number; onReset: () => void }) {
  return (
    <div className="flex flex-col items-center rounded-3xl border border-dashed border-sand bg-cream-100 px-6 py-16 text-center">
      <span className="flex h-14 w-14 items-center justify-center rounded-full bg-cream-200 text-ink-muted">
        <SearchX className="h-6 w-6" aria-hidden="true" />
      </span>
      <h3 className="mt-5 font-display text-xl font-semibold text-navy">That’s the end of the menu</h3>
      <p className="mt-2 max-w-sm text-sm leading-relaxed text-ink-muted">
        Page {page} is past the last page of results. Head back to the first page to keep browsing.
      </p>
      <Button variant="outline" className="mt-6" onClick={onReset}>
        Back to the first page
      </Button>
    </div>
  );
}

/**
 * Database-unavailable state with a live retry (router.refresh re-runs the
 * server read without reloading the page).
 */
export function CatalogueUnavailable({
  title = "The menu is temporarily unavailable",
  description = "We couldn’t load the latest menu just now. Please try again in a moment.",
}: {
  title?: string;
  description?: string;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  return (
    <div className="flex flex-col items-center rounded-3xl border border-dashed border-sand bg-cream-100 px-6 py-16 text-center">
      <span className="flex h-14 w-14 items-center justify-center rounded-full bg-cream-200 text-terracotta-700">
        <AlertTriangle className="h-6 w-6" aria-hidden="true" />
      </span>
      <h3 className="mt-5 font-display text-xl font-semibold text-navy">{title}</h3>
      <p className="mt-2 max-w-sm text-sm leading-relaxed text-ink-muted">{description}</p>
      <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
        <Button
          variant="outline"
          disabled={isPending}
          onClick={() => startTransition(() => router.refresh())}
        >
          {isPending ? "Trying again…" : "Try again"}
        </Button>
        <Link href="/" className="focus-gold rounded-full px-4 py-2 text-sm font-semibold text-navy hover:text-navy-700">
          Back to home
        </Link>
      </div>
    </div>
  );
}
