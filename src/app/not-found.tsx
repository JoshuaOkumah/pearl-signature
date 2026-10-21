import Link from "next/link";
import { Eyebrow, Section } from "@/components/ui/section";
import { ButtonLink } from "@/components/ui/button";

/** Designed 404 for unknown, unpublished or malformed routes. */
export default function NotFound() {
  return (
    <Section className="flex min-h-[60vh] flex-col items-center justify-center py-24 text-center">
      <Eyebrow className="justify-center">Page not found</Eyebrow>
      <h1 className="mt-5 max-w-xl font-display text-4xl font-semibold leading-[1.08] text-navy md:text-5xl">
        This page isn’t on the menu
      </h1>
      <p className="mt-4 max-w-md text-base leading-relaxed text-ink-muted">
        The page you’re looking for doesn’t exist, or it may no longer be available. Let’s get you back to
        something delicious.
      </p>
      <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
        <ButtonLink href="/menu">Browse the menu</ButtonLink>
        <Link
          href="/"
          className="focus-gold rounded-full px-5 py-3 text-sm font-bold text-navy hover:text-navy-700"
        >
          Back to home
        </Link>
      </div>
    </Section>
  );
}
