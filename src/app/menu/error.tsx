"use client";

import Link from "next/link";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * Safety net for the menu route: if rendering fails after the repository
 * handled a database problem, visitors still get a calm, honest state.
 * Internal details stay in server logs (the `error` prop is never rendered).
 */
export default function MenuPageError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="mx-auto w-full max-w-3xl px-5 pb-16 pt-8 md:px-8">
      <div className="flex flex-col items-center rounded-3xl border border-dashed border-sand bg-cream-100 px-6 py-16 text-center">
        <span className="flex h-14 w-14 items-center justify-center rounded-full bg-cream-200 text-terracotta-700">
          <RefreshCw className="h-6 w-6" aria-hidden="true" />
        </span>
        <h2 className="mt-5 font-display text-2xl font-semibold text-navy">The menu couldn’t load</h2>
        <p className="mt-2 max-w-sm text-sm leading-relaxed text-ink-muted">
          Please try again in a moment. If the problem continues, please check back a little later.
        </p>
        <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
          <Button variant="outline" onClick={reset}>
            Try again
          </Button>
          <Link
            href="/"
            className="focus-gold rounded-full px-4 py-2 text-sm font-semibold text-navy hover:text-navy-700"
          >
            Back to home
          </Link>
        </div>
      </div>
    </div>
  );
}
