import Image from "next/image";
import Link from "next/link";
import { cn } from "@/lib/utils";

/**
 * CLIVS wordmark.
 *
 * The supplied artwork is the single source of truth: the official lockup
 * (hand, golden apple and the CLIVS wordmark) is rendered as-is, never
 * redrawn, recoloured or stretched. It lives at
 * `public/brand/clivs-logo.png` and keeps its own white background.
 *
 * On light surfaces the artwork's white field blends into the page. On the
 * forest footer and admin sidebar the same artwork sits on a deliberate
 * white plate, so the white background reads as a designed badge instead of
 * a stray rectangle.
 *
 * `tone` is kept from the previous wordmark API: `"navy"` means "on a light
 * surface", `"cream"` means "on a dark surface".
 */
export function Wordmark({
  tone = "navy",
  className,
  imageClassName = "h-9 min-[360px]:h-10 md:h-12",
  priority = false,
}: {
  tone?: "navy" | "cream";
  className?: string;
  imageClassName?: string;
  priority?: boolean;
}) {
  return (
    <Link
      href="/"
      aria-label="CLIVS, home page"
      className={cn("focus-gold inline-flex items-center rounded-lg", className)}
    >
      <span
        className={cn(
          "inline-flex items-center justify-center",
          tone === "cream" && "rounded-xl bg-white px-3 py-2 shadow-sm",
        )}
      >
        <Image
          src="/brand/clivs-logo.png"
          alt=""
          width={763}
          height={480}
          priority={priority}
          className={cn("w-auto", imageClassName)}
        />
      </span>
    </Link>
  );
}
