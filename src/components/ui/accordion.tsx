"use client";

import { AnimatePresence, motion } from "motion/react";
import { ChevronDown } from "lucide-react";
import { useId, useState } from "react";
import { cn, slugify } from "@/lib/utils";
import type { FaqItem } from "@/types";

/**
 * Accessible accordion (FAQ). Each item is a heading-wrapped button with
 * aria-expanded / aria-controls; panels animate height with Motion and are
 * removed from the DOM when collapsed. Reduced-motion users get instant
 * toggling via the global MotionConfig.
 */
export function Accordion({ items, className }: { items: FaqItem[]; className?: string }) {
  const baseId = useId();
  return (
    <div className={cn("divide-y divide-sand border-y border-sand", className)}>
      {items.map((item) => (
        <AccordionItem key={item.question} item={item} idBase={`${baseId}-${slugify(item.question)}`} />
      ))}
    </div>
  );
}

function AccordionItem({ item, idBase }: { item: FaqItem; idBase: string }) {
  const [open, setOpen] = useState(false);
  const buttonId = `${idBase}-button`;
  const panelId = `${idBase}-panel`;

  return (
    <div>
      <h3>
        <button
          type="button"
          id={buttonId}
          aria-expanded={open}
          aria-controls={panelId}
          onClick={() => setOpen((value) => !value)}
          className="focus-gold flex w-full items-center justify-between gap-4 py-5 text-left"
        >
          <span className="font-display text-lg font-semibold text-navy">{item.question}</span>
          <span
            aria-hidden="true"
            className={cn(
              "flex h-8 w-8 shrink-0 items-center justify-center rounded-full border transition-all duration-200",
              open ? "border-navy bg-navy text-cream" : "border-sand text-navy-700",
            )}
          >
            <ChevronDown className={cn("h-4 w-4 transition-transform duration-200", open && "rotate-180")} />
          </span>
        </button>
      </h3>
      <AnimatePresence initial={false}>
        {open ? (
          <motion.div
            key="panel"
            id={panelId}
            role="region"
            aria-labelledby={buttonId}
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
            className="overflow-hidden"
          >
            <p className="max-w-2xl pb-6 text-sm leading-relaxed text-ink-muted md:text-base">{item.answer}</p>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}
