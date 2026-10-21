import { ArrowRight, CreditCard, Leaf, Truck } from "lucide-react";
import { getProduct } from "@/data/products";
import { ButtonLink } from "@/components/ui/button";
import { Eyebrow, Section } from "@/components/ui/section";
import { Reveal } from "@/components/ui/reveal";
import { FoodMedia } from "@/components/shared/food-media";

export function Hero() {
  const egusi = getProduct("egusi-soup");
  const meatPie = getProduct("meat-pie");

  return (
    <Section padding="flush" className="relative overflow-hidden pb-20 pt-12 md:pb-28 md:pt-20">
      {/* Soft editorial backdrop details */}
      <div aria-hidden="true" className="pointer-events-none absolute -right-24 top-10 h-72 w-72 rounded-full bg-gold-100/60 blur-3xl" />
      <div aria-hidden="true" className="pointer-events-none absolute -left-24 bottom-0 h-72 w-72 rounded-full bg-terracotta-100/50 blur-3xl" />

      <div className="relative grid items-center gap-14 lg:grid-cols-[1.02fr_0.98fr]">
        <div>
          <Reveal>
            <Eyebrow>Authentic Nigerian kitchen · Canada</Eyebrow>
          </Reveal>
          <Reveal delay={0.08}>
            <h1 className="mt-5 font-display text-[2.65rem] font-semibold leading-[1.06] tracking-[-0.015em] text-balance text-navy sm:text-5xl lg:text-[3.5rem]">
              Authentic Nigerian flavours, <em className="italic text-terracotta">made beautifully.</em>
            </h1>
          </Reveal>
          <Reveal delay={0.16}>
            <p className="mt-6 max-w-xl text-base leading-relaxed text-ink-muted md:text-lg">
              From slow-simmered soups to golden pastries and refreshing traditional drinks, PEARL Signature brings
              carefully prepared Nigerian favourites to your table — ordered online, made with care.
            </p>
          </Reveal>
          <Reveal delay={0.24}>
            <div className="mt-8 flex flex-wrap items-center gap-x-4 gap-y-3">
              <ButtonLink href="/menu" size="lg">
                Explore the Menu
                <ArrowRight className="h-4 w-4" aria-hidden="true" />
              </ButtonLink>
              <ButtonLink href="#how-ordering" variant="ghost" size="lg" className="px-4">
                How ordering works
              </ButtonLink>
            </div>
          </Reveal>
          <Reveal delay={0.32}>
            <ul className="mt-10 flex flex-wrap gap-x-8 gap-y-3 text-sm font-semibold text-navy-700">
              <li className="flex items-center gap-2">
                <Leaf className="h-4 w-4 text-leaf" aria-hidden="true" />
                Made to order
              </li>
              <li className="flex items-center gap-2">
                <Truck className="h-4 w-4 text-terracotta" aria-hidden="true" />
                Delivery or arranged pickup
              </li>
              <li className="flex items-center gap-2">
                <CreditCard className="h-4 w-4 text-gold-700" aria-hidden="true" />
                Online or cash payment
              </li>
            </ul>
          </Reveal>
        </div>

        {/* Layered media composition (temporary illustrations — see FoodMedia) */}
        <Reveal delay={0.18} y={28} className="relative">
          <div className="relative mx-auto max-w-[30rem]">
            <div aria-hidden="true" className="absolute -right-8 -top-10 h-40 w-40 rounded-full border-[10px] border-gold/25" />
            <div aria-hidden="true" className="absolute -bottom-10 -left-8 h-24 w-24 rounded-full bg-terracotta-100" />

            {egusi ? (
              <FoodMedia
                theme={egusi.theme}
                label={egusi.name}
                idSuffix="hero"
                ratio="4/3"
                className="relative rounded-[2rem] border border-border shadow-lift"
              />
            ) : null}

            {meatPie ? (
              <div className="absolute -bottom-9 -left-3 w-36 -rotate-6 rounded-2xl border border-border bg-surface p-2 shadow-lift sm:-left-6 sm:w-44">
                <FoodMedia theme={meatPie.theme} label={meatPie.name} idSuffix="hero-mini" ratio="4/3" className="rounded-xl" />
                <p className="px-1 pb-1 pt-2 text-[0.65rem] font-bold uppercase tracking-[0.14em] text-navy-700">
                  Meat Pie · golden & flaky
                </p>
              </div>
            ) : null}

            <div className="absolute -right-2 top-6 rotate-3 rounded-full border border-border bg-surface px-4 py-2 shadow-card sm:-right-5">
              <p className="text-[0.65rem] font-bold uppercase tracking-[0.14em] text-navy-700">Zobo · served chilled</p>
            </div>
          </div>
        </Reveal>
      </div>
    </Section>
  );
}
