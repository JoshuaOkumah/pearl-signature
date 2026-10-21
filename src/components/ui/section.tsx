import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * Vertical rhythm is owned by this prop (not by className overrides) so
 * responsive padding variants can never fight each other in the cascade.
 */
type SectionPadding = "default" | "flush" | "flush-top" | "flush-bottom";

const paddingClasses: Record<SectionPadding, string> = {
  default: "py-16 md:py-24 lg:py-28",
  flush: "",
  "flush-top": "pb-16 md:pb-24 lg:pb-28",
  "flush-bottom": "pt-16 md:pt-24 lg:pt-28",
};

interface SectionProps {
  id?: string;
  padding?: SectionPadding;
  className?: string;
  containerClassName?: string;
  children: ReactNode;
}

/** Consistent vertical rhythm + responsive content wrapper for page sections. */
export function Section({ id, padding = "default", className, containerClassName, children }: SectionProps) {
  return (
    <section id={id} className={cn(paddingClasses[padding], className)}>
      <div className={cn("mx-auto w-full max-w-6xl px-5 md:px-8", containerClassName)}>{children}</div>
    </section>
  );
}


/** Small-caps gold eyebrow with a rule, used above section headings. */
export function Eyebrow({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <p className={cn("flex items-center gap-3 text-xs font-bold uppercase tracking-[0.22em] text-gold-700", className)}>
      <span aria-hidden="true" className="h-px w-8 bg-current opacity-60" />
      <span>{children}</span>
    </p>
  );
}

interface SectionHeadingProps {
  eyebrow?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  align?: "left" | "center";
  className?: string;
}

/** Editorial section heading: eyebrow + display title + muted description. */
export function SectionHeading({ eyebrow, title, description, align = "left", className }: SectionHeadingProps) {
  return (
    <div className={cn("max-w-2xl", align === "center" && "mx-auto text-center", className)}>
      {eyebrow ? <Eyebrow className={align === "center" ? "justify-center" : undefined}>{eyebrow}</Eyebrow> : null}
      <h2 className="mt-4 font-display text-3xl font-semibold leading-[1.12] tracking-[-0.01em] text-balance text-navy md:text-4xl">
        {title}
      </h2>
      {description ? <p className="mt-4 text-base leading-relaxed text-ink-muted md:text-lg">{description}</p> : null}
    </div>
  );
}
