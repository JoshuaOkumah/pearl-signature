import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export type BadgeTone = "neutral" | "gold" | "leaf" | "terracotta" | "navy";

const tones: Record<BadgeTone, string> = {
  neutral: "bg-cream-200 text-navy-700",
  gold: "bg-gold-100 text-gold-700",
  leaf: "bg-leaf-100 text-leaf-700",
  terracotta: "bg-terracotta-100 text-terracotta-700",
  navy: "bg-navy text-cream",
};

export function Badge({
  children,
  tone = "neutral",
  className,
}: {
  children: ReactNode;
  tone?: BadgeTone;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-bold tracking-wide",
        tones[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}
