"use client";

import { motion } from "motion/react";
import { cn } from "@/lib/utils";

interface ChipProps {
  label: string;
  active: boolean;
  onSelect: () => void;
  count?: number;
  /** Shared layout id for the animated active pill (one per filter group). */
  layoutId?: string;
}

/**
 * Category chip with an animated active pill. Accessible via aria-pressed;
 * the active background is a shared-layout motion element so it glides
 * between chips instead of popping.
 */
export function Chip({ label, active, onSelect, count, layoutId = "chip-active" }: ChipProps) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onSelect}
      className={cn(
        "focus-gold relative rounded-full border px-4 py-2 text-sm font-semibold transition-colors duration-200",
        active
          ? "border-navy text-cream"
          : "border-sand bg-surface text-navy-700 hover:border-navy/40 hover:text-navy",
      )}
    >
      {active ? (
        <motion.span
          layoutId={layoutId}
          className="absolute inset-0 rounded-full bg-navy"
          transition={{ type: "spring", stiffness: 500, damping: 42 }}
        />
      ) : null}
      <span className="relative z-10 flex items-center gap-1.5">
        {label}
        {typeof count === "number" ? (
          <span className={cn("text-xs font-medium", active ? "text-cream/70" : "text-ink-muted")}>
            ({count})
          </span>
        ) : null}
      </span>
    </button>
  );
}
