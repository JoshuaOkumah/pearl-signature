"use client";

import { Minus, Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import { DEFAULT_CART_LIMITS } from "@/lib/cart/limits";

interface QuantityStepperProps {
  value: number;
  onChange: (next: number) => void;
  /** Accessible name of the product, e.g. "Egusi Soup". */
  label: string;
  min?: number;
  max?: number;
  disabled?: boolean;
  size?: "sm" | "md";
  className?: string;
}

const sizes = {
  sm: { button: "h-9 w-9", icon: "h-3.5 w-3.5", value: "min-w-7 text-sm" },
  md: { button: "h-11 w-11", icon: "h-4 w-4", value: "min-w-9 text-base" },
} as const;

/**
 * Accessible quantity control.
 *
 * Minus is disabled at the minimum rather than silently deleting the line:
 * removal is a distinct, deliberate action with its own button, so a stray tap
 * never destroys cart contents. Both buttons carry explicit labels naming the
 * product, and the value sits in a polite live region so keyboard and screen
 * reader users hear the new quantity immediately.
 */
export function QuantityStepper({
  value,
  onChange,
  label,
  min = DEFAULT_CART_LIMITS.minLineQuantity,
  max = DEFAULT_CART_LIMITS.maxLineQuantity,
  disabled = false,
  size = "md",
  className,
}: QuantityStepperProps) {
  const classes = sizes[size];
  const canDecrease = !disabled && value > min;
  const canIncrease = !disabled && value < max;

  return (
    <div
      role="group"
      aria-label={`Quantity of ${label}`}
      className={cn(
        "inline-flex items-center gap-1 rounded-full border border-border bg-surface p-1",
        disabled && "opacity-60",
        className,
      )}
    >
      <button
        type="button"
        onClick={() => onChange(value - 1)}
        disabled={!canDecrease}
        aria-label={`Decrease quantity of ${label}`}
        className={cn(
          "focus-gold inline-flex shrink-0 items-center justify-center rounded-full text-navy transition-colors",
          classes.button,
          canDecrease ? "hover:bg-cream-200 hover:text-navy" : "cursor-not-allowed text-ink-muted/40",
        )}
      >
        <Minus className={classes.icon} aria-hidden="true" strokeWidth={2.5} />
      </button>

      <span
        aria-live="polite"
        aria-atomic="true"
        className={cn("text-center font-semibold tabular-nums text-navy", classes.value)}
      >
        {value}
      </span>

      <button
        type="button"
        onClick={() => onChange(value + 1)}
        disabled={!canIncrease}
        aria-label={`Increase quantity of ${label}`}
        className={cn(
          "focus-gold inline-flex shrink-0 items-center justify-center rounded-full text-navy transition-colors",
          classes.button,
          canIncrease ? "hover:bg-cream-200 hover:text-navy" : "cursor-not-allowed text-ink-muted/40",
        )}
      >
        <Plus className={classes.icon} aria-hidden="true" strokeWidth={2.5} />
      </button>
    </div>
  );
}
