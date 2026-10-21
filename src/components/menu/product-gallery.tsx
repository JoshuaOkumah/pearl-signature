"use client";

import { useRef, useState } from "react";
import { motion } from "motion/react";
import { cn } from "@/lib/utils";
import type { DishTheme, ProductImage } from "@/types";
import { FoodMedia } from "@/components/shared/food-media";

interface ProductGalleryProps {
  images: ProductImage[];
  productName: string;
  theme: DishTheme;
  className?: string;
}

/**
 * Mobile-first product gallery.
 *
 * - No images (the honest Phase 2 state, before real photography arrives):
 *   renders the placeholder illustration, no empty chrome.
 * - One image: a single primary image, no thumbnail row.
 * - Multiple images: primary image with a fading transition plus a thumbnail
 *   row. Thumbnails are buttons (≥44px targets, `aria-pressed`), arrow keys
 *   cycle through them, and the container never overflows its column.
 *
 * Reduced-motion users get instant swaps via the global MotionConfig.
 */
export function ProductGallery({ images, productName, theme, className }: ProductGalleryProps) {
  const sorted = [...images].sort((a, b) => a.sortOrder - b.sortOrder);
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLUListElement>(null);

  if (sorted.length === 0) {
    return (
      <div className={className}>
        <FoodMedia theme={theme} label={productName} idSuffix="detail" className="rounded-3xl" />
      </div>
    );
  }

  const current = sorted[Math.min(active, sorted.length - 1)];

  function handleThumbKeyDown(event: React.KeyboardEvent<HTMLUListElement>) {
    if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return;
    event.preventDefault();
    const buttons = Array.from(listRef.current?.querySelectorAll<HTMLButtonElement>("button") ?? []);
    const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
    if (index === -1) return;
    const next = (index + (event.key === "ArrowRight" ? 1 : -1) + buttons.length) % buttons.length;
    setActive(next);
    buttons[next]?.focus();
  }

  return (
    <div className={cn("flex flex-col gap-3", className)}>
      <div className="overflow-hidden rounded-3xl border border-border bg-cream-100 shadow-card">
        {/* Keyed fade-in: the previous image unmounts instantly, the next
            fades in (an instant swap for reduced-motion users via MotionConfig). */}
        <motion.div
          key={current.secureUrl}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
        >
          <FoodMedia
            theme={theme}
            image={current}
            label={productName}
            idSuffix="detail-main"
            priority
            sizes="(min-width:1024px) 50vw, 100vw"
          />
        </motion.div>
      </div>

      {sorted.length > 1 ? (
        <ul
          ref={listRef}
          role="list"
          aria-label={`Images of ${productName}`}
          onKeyDown={handleThumbKeyDown}
          className="grid grid-cols-4 gap-3 sm:grid-cols-6 lg:grid-cols-4"
        >
          {sorted.map((image, index) => (
            <li key={image.secureUrl}>
              <button
                type="button"
                aria-pressed={index === active}
                aria-label={`Show image ${index + 1} of ${sorted.length}: ${image.alt}`}
                onClick={() => setActive(index)}
                className={cn(
                  "focus-gold block w-full overflow-hidden rounded-2xl border-2 transition-colors duration-200",
                  index === active ? "border-navy" : "border-transparent hover:border-sand",
                )}
              >
                <FoodMedia
                  theme={theme}
                  // The button's accessible name carries the description, so
                  // the thumbnail itself stays decorative (no duplicate alt).
                  image={{ ...image, alt: "" }}
                  label={`${productName} thumbnail ${index + 1}`}
                  idSuffix={`thumb-${index}`}
                  ratio="square"
                  sizes="(min-width:1024px) 12vw, 22vw"
                />
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
