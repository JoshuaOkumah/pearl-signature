import { ArrowRight } from "lucide-react";
import { ButtonLink } from "@/components/ui/button";
import { Eyebrow, Section } from "@/components/ui/section";
import { Reveal } from "@/components/ui/reveal";

export function ClosingCta() {
  return (
    <Section>
      <Reveal>
        <div className="relative overflow-hidden rounded-[2.5rem] bg-navy px-6 py-16 text-center md:px-16 md:py-24">
          {/* Decorative pearl-ring motif */}
          <div aria-hidden="true" className="pointer-events-none absolute -left-20 -top-20 h-64 w-64 rounded-full border-[14px] border-gold/15" />
          <div aria-hidden="true" className="pointer-events-none absolute -bottom-24 -right-16 h-72 w-72 rounded-full border-[14px] border-terracotta/20" />
          <div aria-hidden="true" className="pointer-events-none absolute right-10 top-10 h-2.5 w-2.5 rounded-full bg-gold/60" />
          <div aria-hidden="true" className="pointer-events-none absolute bottom-12 left-12 h-2 w-2 rounded-full bg-cream/40" />

          <div className="relative">
            <Eyebrow className="justify-center text-gold">Your table is waiting</Eyebrow>
            <h2 className="mx-auto mt-4 max-w-2xl font-display text-3xl font-semibold leading-[1.12] text-balance text-cream md:text-5xl">
              Bring the taste of home to <em className="italic text-gold">your</em> table
            </h2>
            <p className="mx-auto mt-5 max-w-xl text-base leading-relaxed text-cream/75 md:text-lg">
              Explore the full menu of traditional foods, pastries and drinks — ordering opens soon.
            </p>
            <div className="mt-9 flex flex-wrap items-center justify-center gap-4">
              <ButtonLink href="/menu" variant="accent" size="lg">
                Explore the Menu
                <ArrowRight className="h-4 w-4" aria-hidden="true" />
              </ButtonLink>
              <ButtonLink href="/about" variant="outlineLight" size="lg">
                Our story
              </ButtonLink>
            </div>
          </div>
        </div>
      </Reveal>
    </Section>
  );
}
