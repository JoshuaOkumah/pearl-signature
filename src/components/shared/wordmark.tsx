import Link from "next/link";
import { cn } from "@/lib/utils";

/**
 * PEARL Signature typographic wordmark.
 *
 * Temporary (approved-direction) mark: “PEARL” in letterspaced Fraunces,
 * a small pearl detail, and an italic “Signature”. The final P+S monogram
 * logo will replace this when supplied by the business.
 */
export function Wordmark({ tone = "navy", className }: { tone?: "navy" | "cream"; className?: string }) {
  return (
    <Link
      href="/"
      aria-label="PEARL Signature, home page"
      className={cn("focus-gold inline-flex items-center gap-2 rounded-sm", className)}
    >
      {/* Slightly smaller below 360px so the header's cart and menu
          buttons keep the full 20px gutter on the narrowest phones. */}
      <span
        className={cn(
          "font-display text-[1.15rem] font-semibold uppercase leading-none tracking-[0.18em] min-[360px]:text-[1.3rem]",
          tone === "navy" ? "text-navy" : "text-cream",
        )}
      >
        Pearl
      </span>
      <span aria-hidden="true" className="pearl-dot" />
      <span
        className={cn(
          "-ml-1 font-display text-[1rem] italic leading-none min-[360px]:text-[1.15rem]",
          tone === "navy" ? "text-terracotta" : "text-gold",
        )}
      >
        Signature
      </span>
    </Link>
  );
}
