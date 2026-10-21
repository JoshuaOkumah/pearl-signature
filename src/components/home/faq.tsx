import { faqs } from "@/data/faqs";
import { Accordion } from "@/components/ui/accordion";
import { Section, SectionHeading } from "@/components/ui/section";
import { Reveal } from "@/components/ui/reveal";

export function Faq() {
  return (
    <Section id="faq" padding="flush-top" className="scroll-mt-20">
      <div className="grid gap-10 lg:grid-cols-[0.85fr_1.15fr] lg:gap-16">
        <Reveal>
          <SectionHeading
            eyebrow="Questions, answered"
            title="Good to know"
            description="Everything we can tell you today — honestly. Details like delivery areas and opening dates will be confirmed before launch."
          />
        </Reveal>
        <Reveal delay={0.12}>
          <Accordion items={faqs} />
        </Reveal>
      </div>
    </Section>
  );
}
