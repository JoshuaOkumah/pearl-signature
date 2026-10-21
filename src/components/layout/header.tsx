"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { motion } from "motion/react";
import { Menu as MenuIcon, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { navItems } from "@/data/navigation";
import { cn } from "@/lib/utils";
import type { NavItem } from "@/types";
import { Wordmark } from "@/components/shared/wordmark";
import { ButtonLink } from "@/components/ui/button";
import { MobileNav } from "./mobile-nav";

export function Header() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const [previousPathname, setPreviousPathname] = useState(pathname);
  const triggerRef = useRef<HTMLButtonElement>(null);

  // Close the mobile menu whenever the route changes — adjusting state
  // during render is the React-recommended alternative to an effect.
  if (pathname !== previousPathname) {
    setPreviousPathname(pathname);
    setOpen(false);
  }

  // Subtle sticky-header elevation after a small scroll.
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <header
      className={cn(
        "sticky top-0 z-50 border-b transition-[background-color,border-color,box-shadow] duration-300",
        open || scrolled
          ? "border-border bg-cream/90 shadow-[0_8px_30px_-18px_rgb(26_37_48/0.25)] backdrop-blur-md"
          : "border-transparent bg-cream",
      )}
    >
      <div className="mx-auto flex h-18 w-full max-w-6xl items-center justify-between px-5 md:px-8">
        <Wordmark />

        <nav aria-label="Primary" className="hidden items-center gap-8 md:flex">
          {navItems.map((item) => (
            <DesktopNavLink key={item.href} item={item} pathname={pathname} />
          ))}
        </nav>

        <div className="flex items-center gap-3">
          <ButtonLink href="/menu" size="sm" className="hidden md:inline-flex">
            Explore Menu
          </ButtonLink>
          <button
            ref={triggerRef}
            type="button"
            onClick={() => setOpen((value) => !value)}
            aria-expanded={open}
            aria-controls="mobile-navigation"
            aria-label={open ? "Close menu" : "Open menu"}
            className="focus-gold inline-flex h-11 w-11 items-center justify-center rounded-full border border-border bg-surface text-navy transition-colors hover:border-navy/40 md:hidden"
          >
            {open ? <X className="h-5 w-5" aria-hidden="true" /> : <MenuIcon className="h-5 w-5" aria-hidden="true" />}
          </button>
        </div>
      </div>

      <MobileNav open={open} onClose={() => setOpen(false)} triggerRef={triggerRef} pathname={pathname} />
    </header>
  );
}

function DesktopNavLink({ item, pathname }: { item: NavItem; pathname: string }) {
  const active = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);

  return (
    <Link
      href={item.href}
      aria-current={active ? "page" : undefined}
      className={cn(
        "focus-gold relative rounded-sm py-1 text-sm font-semibold tracking-wide transition-colors duration-200",
        active ? "text-navy" : "text-ink-muted hover:text-navy",
      )}
    >
      {item.label}
      {active ? (
        <motion.span
          layoutId="active-nav-underline"
          className="absolute inset-x-0 -bottom-0.5 h-0.5 rounded-full bg-gold"
          transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
        />
      ) : null}
    </Link>
  );
}
