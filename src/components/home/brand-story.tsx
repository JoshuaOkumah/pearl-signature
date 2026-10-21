import { getProduct } from "@/data/products";
import { Divider } from "@/components/ui/divider";
import { Eyebrow, Section } from "@/components/ui/section";
import { Reveal } from "@/components/ui/reveal";
import { FoodMedia } from "@/components/shared/food-media";

/**
 * Brand story — philosophy only, no invented founder biography,
 * years-in-business or personal history.
 */
export function BrandStory() {
  const ukwa = getProduct("ukwa");
  const zobo = getProduct("zobo");

  return (
    <Section>
      <div className="grid items-center gap-14 lg:grid-cols-[0.95fr_1.05fr]">
        <Reveal className="relative order-2 lg:order-1">
          <div className="relative mx-auto max-w-[26rem]">
            <div aria-hidden="true" className="absolute -left-8 -top-8 h-28 w-28 rounded-full bg-leaf-100" />
            {ukwa ? (
              <FoodMedia
                theme={ukwa.theme}
                label={ukwa.name}
                idSuffix="story"
                ratio="4/3"
                className="relative rounded-[2rem] border border-border shadow-card"
              />
            ) : null}
            {zobo ? (
              <div className="absolute -bottom-10 -right-3 w-40 rotate-6 rounded-2xl border border-border bg-surface p-2 shadow-lift sm:-right-8 sm:w-48">
                <FoodMedia theme={zobo.theme} label={zobo.name} idSuffix="story-mini" ratio="4/3" className="rounded-xl" />
                <p className="px-1 pb-1 pt-2 text-[0.65rem] font-bold uppercase tracking-[0.14em] text-navy-700">
                  Brewed the traditional way
                </p>
              </div>
            ) : null}
          </div>
        </Reveal>

        <div className="order-1 lg:order-2">
          <Reveal>
            <Eyebrow>Our story</Eyebrow>
          </Reveal>
          <Reveal delay={0.08}>
            <h2 className="mt-4 font-display text-3xl font-semibold leading-[1.12] tracking-[-0.01em] text-balance text-navy md:text-4xl">
              Cooking that carries home in every bite
            </h2>
          </Reveal>
          <Reveal delay={0.16}>
            <div className="mt-6 space-y-4 text-base leading-relaxed text-ink-muted md:text-lg">
              <p>
                PEARL Signature began with a simple conviction — that authentic Nigerian food deserves a beautiful
                home online. Based in Canada, we prepare the dishes we grew up loving the way they deserve to be
                made: patiently, generously, and without shortcuts.
              </p>
              <p>
                Every pot of soup is simmered slowly. Every pastry is baked until golden. Every drink is brewed
                fresh. It is the kind of care you can taste — and the kind of table we are proud to set for you.
              </p>
            </div>
          </Reveal>
          <Reveal delay={0.24}>
            <blockquote className="mt-8 border-l-2 border-gold pl-5 font-display text-xl italic leading-relaxed text-navy-700">
              “Every pot is seasoned with patience.”
            </blockquote>
          </Reveal>
          <Reveal delay={0.3}>
            <Divider className="mt-10 max-w-xs" />
          </Reveal>
        </div>
      </div>
    </Section>
  );
}
