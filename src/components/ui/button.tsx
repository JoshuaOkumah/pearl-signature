import Link from "next/link";
import type { AnchorHTMLAttributes, ButtonHTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/utils";

export type ButtonVariant = "primary" | "secondary" | "accent" | "outline" | "outlineLight" | "ghost";
export type ButtonSize = "sm" | "md" | "lg" | "icon";

const base =
  "inline-flex items-center justify-center gap-2 rounded-full font-sans font-semibold tracking-[0.01em] transition-all duration-200 focus-gold active:scale-[0.98] disabled:pointer-events-none disabled:opacity-50";

const variants: Record<ButtonVariant, string> = {
  /** Deep navy — main commerce actions on cream. */
  primary: "bg-navy text-cream shadow-sm hover:bg-navy-800 active:bg-navy-900",
  /** Warm terracotta — appetite-driven secondary actions. */
  secondary: "bg-terracotta text-cream shadow-sm hover:bg-terracotta-700",
  /** Champagne gold — used sparingly, only on dark panels. */
  accent: "bg-gold text-navy-900 shadow-sm hover:bg-gold-600",
  outline: "border border-navy/25 bg-transparent text-navy hover:border-navy hover:bg-navy hover:text-cream",
  /** Outline variant legible on navy surfaces. */
  outlineLight: "border border-cream/40 bg-transparent text-cream hover:border-cream hover:bg-cream hover:text-navy",
  ghost: "bg-transparent text-navy hover:bg-navy/5",
};

const sizes: Record<ButtonSize, string> = {
  sm: "h-9 px-4 text-sm",
  md: "h-11 px-6 text-sm",
  lg: "h-[3.25rem] px-8 text-base",
  icon: "h-11 w-11",
};

export function buttonStyles({
  variant = "primary",
  size = "md",
  className,
}: {
  variant?: ButtonVariant;
  size?: ButtonSize;
  className?: string;
} = {}): string {
  return cn(base, variants[variant], sizes[size], className);
}

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
}

export function Button({ variant, size, className, type = "button", ...props }: ButtonProps) {
  return <button type={type} className={buttonStyles({ variant, size, className })} {...props} />;
}

export interface ButtonLinkProps extends AnchorHTMLAttributes<HTMLAnchorElement> {
  href: string;
  variant?: ButtonVariant;
  size?: ButtonSize;
  children: ReactNode;
}

/** Button-styled next/link for navigation actions. */
export function ButtonLink({ href, variant, size, className, children, ...props }: ButtonLinkProps) {
  return (
    <Link href={href} className={buttonStyles({ variant, size, className })} {...props}>
      {children}
    </Link>
  );
}
