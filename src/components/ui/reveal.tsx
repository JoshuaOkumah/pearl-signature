"use client";

import { motion } from "motion/react";
import type { ReactNode } from "react";

interface RevealProps {
  children: ReactNode;
  /** Stagger delay in seconds. Keep small (≤ 0.35s). */
  delay?: number;
  /** Initial vertical offset in px. */
  y?: number;
  className?: string;
}

/**
 * Restrained scroll-reveal: fades and settles once when entering the
 * viewport. Reduced-motion users get an instant, static render via the
 * global MotionConfig (reducedMotion="user") in the root layout.
 */
export function Reveal({ children, delay = 0, y = 20, className }: RevealProps) {
  return (
    <motion.div
      className={className}
      initial={{ opacity: 0, y }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-64px" }}
      transition={{ duration: 0.55, delay, ease: [0.22, 1, 0.36, 1] }}
    >
      {children}
    </motion.div>
  );
}
