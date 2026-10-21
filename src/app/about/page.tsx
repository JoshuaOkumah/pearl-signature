import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, BadgeCheck, ChefHat, Globe, HandHeart, Leaf } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { categories } from "@/data/categories";
import { ClosingCta } from "@/components/home/closing-cta";
import { Divider } from "@/components/ui/divider";
import { Eyebrow, Section } from "@/components/ui/section";
import { Reveal } from "@/components/ui/reveal";

export const metadata: Metadata = {
  title: "About",
  description:
    "PEARL Signature is a Canadian online kitchen dedicated to authentic Nigerian cuisine — traditional foods, pastries, snacks and drinks, prepared with care.",
};

interface Value {
  icon: LucideIcon;
  title: string;
  description: string;
}

const values: Value[] = [
  {
    icon: Leaf,
    title: "Authenticity first",
    description: "Traditional recipes, respected. We cook the dishes the way they are meant to taste — no shortcuts.",
  },
  {
    icon: HandHeart,
    title: "Care in every step",
    description: "From sourcing to simmering to packing, every order is prepared as if for our own table.",
  },
  {
    icon: BadgeCheck,
    title: "Quality you can trust",
    description: "Made to order, handled hygienically and presented beautifully — every single time.",
  },
];

export default function AboutPage() {
  return (
    <>
      <Section padding="flush" className="pb-14 pt-14 md:pt-20">
        <Reveal>
          <Eyebrow>About PEARL Signature</Eyebrow>
          <h1 className="mt-4 max-w-2xl font-display text-4xl font-semibold leading-[1.08] tracking-[-0.01em] text-balance text-navy md:text-5xl">
            A premium online kitchen for authentic Nigerian food
          </h1>
          <p className="mt-6 max-w-2xl text-base leading-relaxed text-ink-muted md:text-lg">
            PEARL Signature is a Canadian online food business celebrating the richness of Nigerian cuisine. We are
            an online-only kitchen — no walk-in storefront — which means every dish we make is prepared specifically
            for your order, then brought to your door or arranged for pickup.
          </p>
        </Reveal>
      </Section>

      <Section padding="flush" className="bg-cream-100/70 py-16 md:py-20">
        <Reveal>
          <h2 className="font-display text-2xl font-semibold text-navy md:text-3xl">What we stand for</h2>
        </Reveal>
        <div className="mt-8 grid gap-6 md:grid-cols-3">
          {values.map((value, index) => (
            <Reveal key={value.title} delay={0.08 * index} className="h-full">
              <div className="flex h-full flex-col rounded-3xl border border-border bg-surface p-6 shadow-card">
                <span className="flex h-11 w-11 items-center justify-center rounded-full bg-leaf-100 text-leaf-700">
                  <value.icon className="h-5 w-5" aria-hidden="true" />
                </span>
                <h3 className="mt-5 font-display text-xl font-semibold text-navy">{value.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-ink-muted">{value.description}</p>
              </div>
            </Reveal>
          ))}
        </div>
      </Section>

      <Section>
        <div className="grid gap-12 lg:grid-cols-[1fr_1.1fr] lg:gap-16">
          <Reveal>
            <Eyebrow>What we serve</Eyebrow>
            <h2 className="mt-4 font-display text-2xl font-semibold text-navy md:text-3xl">
              Three corners of a Nigerian table
            </h2>
            <p className="mt-4 text-base leading-relaxed text-ink-muted">
              Our menu focuses on the dishes home is made of — and it will grow over time as new categories, sizes
              and options are added.
            </p>
            <Divider className="mt-8 max-w-xs" />
            <div className="mt-8 flex items-start gap-4 rounded-2xl border border-border bg-cream-100 p-5">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-navy text-cream">
                <Globe className="h-5 w-5" aria-hidden="true" />
              </span>
              <p className="text-sm leading-relaxed text-ink-muted">
                <strong className="font-bold text-navy">Online only, by design.</strong> Being online-only lets us
                cook to order instead of keeping food waiting — you get dishes at their best, and nothing is wasted.
              </p>
            </div>
          </Reveal>

          <div className="flex flex-col gap-4">
            {categories.map((category, index) => (
              <Reveal key={category.slug} delay={0.08 * index}>
                <Link
                  href={`/menu?category=${category.slug}`}
                  className="focus-gold group flex items-center justify-between gap-6 rounded-3xl border border-border bg-surface p-6 shadow-card transition-all duration-300 hover:-translate-y-0.5 hover:shadow-lift"
                >
                  <div>
                    <p className="text-xs font-bold uppercase tracking-[0.18em] text-gold-700">{category.tagline}</p>
                    <h3 className="mt-1.5 font-display text-xl font-semibold text-navy">{category.name}</h3>
                    <p className="mt-1.5 text-sm leading-relaxed text-ink-muted">{category.description}</p>
                  </div>
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-sand text-navy transition-colors group-hover:border-navy group-hover:bg-navy group-hover:text-cream">
                    <ArrowRight className="h-4 w-4" aria-hidden="true" />
                  </span>
                </Link>
              </Reveal>
            ))}
            <Reveal delay={0.24}>
              <div className="flex items-center gap-3 rounded-2xl px-2 py-1 text-sm text-ink-muted">
                <ChefHat className="h-4 w-4 shrink-0 text-terracotta" aria-hidden="true" />
                Every dish is prepared to order — never sitting under a heat lamp.
              </div>
            </Reveal>
          </div>
        </div>
      </Section>

      <ClosingCta />
    </>
  );
}
