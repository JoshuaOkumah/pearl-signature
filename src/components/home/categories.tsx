import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { categories } from "@/data/categories";
import { cn } from "@/lib/utils";
import { Section, SectionHeading } from "@/components/ui/section";
import { Reveal } from "@/components/ui/reveal";
import { FoodMedia } from "@/components/shared/food-media";

export function Categories() {
  return (
    <Section className="bg-cream-100/70">
      <Reveal>
        <SectionHeading
          eyebrow="The menu, three ways"
          title="Everything a Nigerian table loves"
          description="Traditional soups and classics, pastries and snacks worth gathering for, and drinks brewed the way home remembers."
        />
      </Reveal>

      <div className="mt-12 grid gap-6 md:grid-cols-3">
        {categories.map((category, index) => (
          <Reveal key={category.slug} delay={index * 0.1} className={cn(index === 1 && "md:translate-y-8")}>
            <Link
              href={`/menu?category=${category.slug}`}
              className="focus-gold group flex h-full flex-col overflow-hidden rounded-3xl border border-border bg-surface shadow-card transition-all duration-300 hover:-translate-y-1 hover:shadow-lift"
            >
              <div className="overflow-hidden">
                <FoodMedia
                  theme={category.theme}
                  label={category.name}
                  idSuffix="category"
                  ratio="16/10"
                  className="transition-transform duration-500 ease-out group-hover:scale-[1.04]"
                />
              </div>
              <div className="flex flex-1 flex-col p-6">
                <p className="text-xs font-bold uppercase tracking-[0.18em] text-gold-700">{category.tagline}</p>
                <h3 className="mt-2 font-display text-2xl font-semibold text-navy">{category.name}</h3>
                <p className="mt-2 text-sm leading-relaxed text-ink-muted">{category.description}</p>
                <span className="mt-5 inline-flex items-center gap-2 text-sm font-bold text-navy">
                  Explore {category.shortName.toLowerCase()}
                  <ArrowRight className="h-4 w-4 transition-transform duration-300 group-hover:translate-x-1" aria-hidden="true" />
                </span>
              </div>
            </Link>
          </Reveal>
        ))}
      </div>
    </Section>
  );
}
