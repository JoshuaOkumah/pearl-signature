import type { FaqItem } from "@/types";
import type { OrderingCopy } from "@/lib/store/ordering-copy";

/**
 * FAQ entries. Answers only cover confirmed business requirements —
 * no invented delivery areas, times or contact details.
 *
 * The delivery, payment and opening answers are supplied by the caller from
 * the owner's live configuration (`OrderingCopy`), so the FAQ cannot keep
 * claiming that ordering is closed after it has opened.
 */
export function buildFaqs(copy: OrderingCopy): FaqItem[] {
  return [
    {
      question: "Where is CLIVS located?",
      answer:
        "CLIVS is an online-only business based in Canada. There is no walk-in storefront. Every order is placed through this website and prepared for pickup or delivery where it is available.",
    },
    {
      question: "How will delivery and pickup work?",
      answer: copy.faqDelivery,
    },
    {
      question: "How can I pay for my order?",
      answer: copy.faqPayment,
    },
    {
      question: "When can I start ordering?",
      answer: copy.faqOpening,
    },
    {
      question: "What kind of food do you offer?",
      answer:
        "We specialise in authentic Nigerian cuisine, from traditional soups and classics such as Egusi and Bitterleaf to pastries and snacks such as Meat Pie and Shawarma, plus traditional drinks including Zobo and Soya Milk.",
    },
  ];
}
