import { Banknote, CreditCard, Search, Truck, UtensilsCrossed } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Section, SectionHeading } from "@/components/ui/section";
import { Reveal } from "@/components/ui/reveal";

interface Step {
  icon: LucideIcon;
  title: string;
  description: string;
}

const steps: Step[] = [
  {
    icon: Search,
    title: "Explore the menu",
    description: "Browse traditional foods, pastries and drinks, with honest descriptions of every dish.",
  },
  {
    icon: UtensilsCrossed,
    title: "Choose your favourites",
    description: "Select the dishes you love, each one prepared to order just for you.",
  },
  {
    icon: Truck,
    title: "Delivery or pickup",
    description: "Have your order brought to your door, or prearrange a convenient pickup.",
  },
  {
    icon: CreditCard,
    title: "Complete your order",
    description: "Pay securely online, or choose cash on arrival, whichever suits you.",
  },
];

/**
 * The planned ordering journey. Ordering itself is not implemented in
 * Phase 1 — the copy says so plainly.
 */
export function HowOrderingWorks() {
  return (
    <Section id="how-ordering" className="scroll-mt-20 bg-cream-100/70">
      <Reveal>
        <SectionHeading
          align="center"
          eyebrow="How ordering works"
          title="From our kitchen to your table, in four simple steps"
          description="Online ordering is being prepared. Here is the experience we are building for you."
        />
      </Reveal>

      <ol className="mt-14 grid gap-6 md:grid-cols-2 lg:grid-cols-4">
        {steps.map((step, index) => (
          <Reveal key={step.title} delay={0.08 * index} className="h-full">
            <li className="relative flex h-full flex-col rounded-3xl border border-border bg-surface p-6 shadow-card">
              <div className="flex items-center justify-between">
                <span className="flex h-11 w-11 items-center justify-center rounded-full bg-cream-200 text-navy">
                  <step.icon className="h-5 w-5" aria-hidden="true" />
                </span>
                <span aria-hidden="true" className="font-display text-3xl font-semibold text-gold-700">
                  {String(index + 1).padStart(2, "0")}
                </span>
              </div>
              <h3 className="mt-5 font-display text-xl font-semibold text-navy">{step.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-ink-muted">{step.description}</p>
            </li>
          </Reveal>
        ))}
      </ol>

      <Reveal delay={0.2}>
        <div className="mx-auto mt-8 flex max-w-3xl items-start gap-4 rounded-2xl border border-gold/40 bg-gold-100/50 p-5">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-gold/20 text-gold-700">
            <Banknote className="h-5 w-5" aria-hidden="true" />
          </span>
          <p className="text-sm leading-relaxed text-navy-700">
            <strong className="font-bold text-navy">Payment, your way.</strong> We plan to offer secure online payment
            alongside cash on arrival. Online checkout is being prepared and will open together with ordering.
          </p>
        </div>
      </Reveal>
    </Section>
  );
}
