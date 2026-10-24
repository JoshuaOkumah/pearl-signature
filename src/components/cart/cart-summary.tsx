"use client";

import { formatCad } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";

interface CartSummaryProps {
  /** Server-verified merchandise subtotal, or null while it is being checked. */
  subtotalCents: number | null;
  /** True when the cart changed after the last successful verification. */
  stale?: boolean;
  /** True only while a server quote is pending or the cart has changed. */
  checking?: boolean;
  /** True when prices could not be verified at all. */
  unverified?: boolean;
  className?: string;
  onRetry?: () => void;
}

/**
 * Price breakdown shared by `/cart` and `/checkout`.
 *
 * Delivery and taxes are shown as **to be confirmed**, never as zero: the
 * business has not approved coverage, fees or rates, and printing `$0.00`
 * would promise something nobody has agreed to. The merchandise subtotal is
 * also never labelled a "total", because it is not the amount that would be
 * charged.
 */
export function CartSummary({
  subtotalCents,
  stale = false,
  checking = false,
  unverified = false,
  className,
  onRetry,
}: CartSummaryProps) {
  return (
    <dl className={cn("flex flex-col gap-3", className)}>
      <SummaryRow label="Merchandise subtotal">
        {unverified ? (
          <span className="font-semibold text-ink-muted">Could not be verified</span>
        ) : checking || stale ? (
          <span className="font-semibold text-ink-muted" aria-live="polite">
            Checking…
          </span>
        ) : subtotalCents === null ? (
          <span className="font-semibold text-ink-muted">No verified items</span>
        ) : (
          <span className="font-semibold tabular-nums text-navy">{formatCad(subtotalCents)}</span>
        )}
      </SummaryRow>

      <SummaryRow label="Delivery">
        <Badge tone="gold">To be confirmed</Badge>
      </SummaryRow>

      <SummaryRow label="Estimated taxes">
        <Badge tone="gold">To be confirmed</Badge>
      </SummaryRow>

      <div className="mt-1 border-t border-sand pt-3">
        <p className="text-xs leading-relaxed text-ink-muted">
          {unverified
            ? "Delivery and taxes cannot be calculated until prices are verified."
            : "Delivery and taxes are added once the business confirms coverage and rates."}
        </p>
        {unverified && onRetry ? (
          <button
            type="button"
            onClick={onRetry}
            className="focus-gold mt-2 rounded text-sm font-semibold text-navy underline underline-offset-4 hover:text-gold-700"
          >
            Try verifying again
          </button>
        ) : null}
      </div>
    </dl>
  );
}

function SummaryRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <dt className="text-sm font-medium text-ink-muted">{label}</dt>
      <dd className="text-right text-base">{children}</dd>
    </div>
  );
}
