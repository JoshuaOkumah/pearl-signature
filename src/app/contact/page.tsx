import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, BookOpen, MailQuestion, MessageCircle } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Eyebrow, Section } from "@/components/ui/section";
import { Reveal } from "@/components/ui/reveal";

export const metadata: Metadata = {
  title: "Contact",
  description:
    "Get in touch with PEARL Signature. Verified contact channels are being finalised and will be published before ordering opens.",
};

interface Pathway {
  icon: LucideIcon;
  title: string;
  description: string;
  href: string;
  action: string;
}

const pathways: Pathway[] = [
  {
    icon: BookOpen,
    title: "Browse the menu",
    description: "See everything we are preparing, from traditional foods and pastries to snacks and drinks.",
    href: "/menu",
    action: "View the menu",
  },
  {
    icon: MessageCircle,
    title: "Common questions",
    description: "Delivery, pickup, payment and opening plans, answered honestly in our FAQ.",
    href: "/#faq",
    action: "Read the FAQ",
  },
  {
    icon: ArrowRight,
    title: "Our story",
    description: "Learn what PEARL Signature stands for and how our kitchen works.",
    href: "/about",
    action: "About us",
  },
];

export default function ContactPage() {
  return (
    <>
      <Section padding="flush" className="pb-14 pt-14 md:pt-20">
        <Reveal>
          <Eyebrow>Contact</Eyebrow>
          <h1 className="mt-4 max-w-2xl font-display text-4xl font-semibold leading-[1.08] tracking-[-0.01em] text-balance text-navy md:text-5xl">
            We’d love to hear from you
          </h1>
          <p className="mt-6 max-w-2xl text-base leading-relaxed text-ink-muted md:text-lg">
            PEARL Signature is getting ready to open for orders. Here is where things stand with reaching us.
          </p>
        </Reveal>
      </Section>

      <Section padding="flush-top">
        <div className="grid gap-6 lg:grid-cols-[1.05fr_0.95fr]">
          <Reveal className="h-full">
            <div className="flex h-full flex-col rounded-3xl border border-border bg-surface p-8 shadow-card">
              <div className="flex items-center justify-between gap-4">
                <span className="flex h-12 w-12 items-center justify-center rounded-full bg-gold-100 text-gold-700">
                  <MailQuestion className="h-6 w-6" aria-hidden="true" />
                </span>
                <Badge tone="gold">Coming before launch</Badge>
              </div>
              <h2 className="mt-6 font-display text-2xl font-semibold text-navy">
                Verified contact channels are being finalised
              </h2>
              <p className="mt-3 text-sm leading-relaxed text-ink-muted md:text-base">
                We are confirming our official business email, phone line and social profiles, and we will publish
                them here, and only here, once they are verified. Until then, we would rather say “coming soon”
                than give you details that might change.
              </p>
              <p className="mt-4 text-sm leading-relaxed text-ink-muted md:text-base">
                When ordering opens, order enquiries, delivery coordination and pickup arrangements will all be
                handled through those published channels.
              </p>
            </div>
          </Reveal>

          <div className="flex flex-col gap-4">
            <Reveal delay={0.08}>
              <h2 className="px-1 text-xs font-bold uppercase tracking-[0.2em] text-ink-muted">
                In the meantime
              </h2>
            </Reveal>
            {pathways.map((pathway, index) => (
              <Reveal key={pathway.title} delay={0.08 + 0.07 * index}>
                <Link
                  href={pathway.href}
                  className="focus-gold group flex items-center justify-between gap-4 rounded-2xl border border-border bg-surface p-5 shadow-card transition-all duration-300 hover:-translate-y-0.5 hover:shadow-lift"
                >
                  <div className="flex items-start gap-4">
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-cream-200 text-navy">
                      <pathway.icon className="h-5 w-5" aria-hidden="true" />
                    </span>
                    <div>
                      <h3 className="font-display text-lg font-semibold text-navy">{pathway.title}</h3>
                      <p className="mt-1 text-sm leading-relaxed text-ink-muted">{pathway.description}</p>
                    </div>
                  </div>
                  <span className="inline-flex shrink-0 items-center gap-1.5 text-sm font-bold text-navy">
                    {pathway.action}
                    <ArrowRight
                      className="h-4 w-4 transition-transform duration-300 group-hover:translate-x-1"
                      aria-hidden="true"
                    />
                  </span>
                </Link>
              </Reveal>
            ))}
          </div>
        </div>
      </Section>
    </>
  );
}
