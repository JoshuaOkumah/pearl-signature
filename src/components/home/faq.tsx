import { Suspense } from "react";
import { buildFaqs } from "@/data/faqs";
import { getPublicOrderingCopy } from "@/lib/store/public-ordering";
import { UNKNOWN_ORDERING_COPY, type OrderingCopy } from "@/lib/store/ordering-copy";
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
            description="Straight answers about ordering, delivery, payment and the food we cook."
          />
        </Reveal>
        <Reveal delay={0.12}>
          <Suspense fallback={<FaqList copy={UNKNOWN_ORDERING_COPY} />}>
            <ConfiguredFaqList />
          </Suspense>
        </Reveal>
      </div>
    </Section>
  );
}

async function ConfiguredFaqList() {
  const copy = await getPublicOrderingCopy();
  return <FaqList copy={copy} />;
}

function FaqList({ copy }: { copy: OrderingCopy }) {
  return <Accordion items={buildFaqs(copy)} />;
}
