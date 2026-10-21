"use client";

import { MotionConfig } from "motion/react";
import type { ReactNode } from "react";

/**
 * Global Motion configuration.
 * reducedMotion="user" makes every Motion animation respect the visitor’s
 * prefers-reduced-motion setting (animations become instant, content is
 * never hidden behind motion).
 */
export function MotionProvider({ children }: { children: ReactNode }) {
  return <MotionConfig reducedMotion="user">{children}</MotionConfig>;
}
