"use client";

import { Check, Plus } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { remainingQuantityFor } from "@/lib/cart/core";
import { useCart } from "@/lib/cart/context";
import { MAX_LINE_QUANTITY } from "@/lib/cart/limits";
import { cn } from "@/lib/utils";
import { buttonStyles, type ButtonSize, type ButtonVariant } from "@/components/ui/button";

interface AddToCartButtonProps {
  slug: string;
  /** Display name, used for the confirmation wording and accessibility. */
  name: string;
  /** The price currently shown to the customer — recorded as the "seen" price. */
  priceCents: number;
  /** null for a base product; the selected option name otherwise. */
  variantName?: string | null;
  /** Units added per click (the product page's quantity selector). */
  quantity?: number;
  disabled?: boolean;
  /** Honest explanation shown when the control is disabled. */
  disabledReason?: string | null;
  variant?: ButtonVariant;
  size?: ButtonSize;
  fullWidth?: boolean;
  className?: string;
}

const CONFIRMATION_MS = 1_800;

/**
 * Add-to-cart control for a product that needs no further selection.
 *
 * Notes on the interaction:
 *  - The click is optimistic and synchronous — the header count updates in the
 *    same frame, with no round trip and no navigation.
 *  - A short "Added" confirmation gives local feedback without opening the
 *    drawer over whatever the customer was reading.
 *  - The button locks while the confirmation is on screen, so a double click
 *    adds one item rather than two.
 *  - When the cart is already at a limit the control disables itself and says
 *    why, instead of silently doing nothing.
 */
export function AddToCartButton({
  slug,
  name,
  priceCents,
  variantName = null,
  quantity = 1,
  disabled = false,
  disabledReason = null,
  variant = "primary",
  size = "md",
  fullWidth = false,
  className,
}: AddToCartButtonProps) {
  const { add, state, hydrated } = useCart();
  const [added, setAdded] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const remaining = hydrated ? remainingQuantityFor(state, slug, variantName) : MAX_LINE_QUANTITY;
  const atLimit = hydrated && remaining <= 0;
  const blocked = disabled || atLimit;

  const handleClick = () => {
    if (blocked) return;
    add({ slug, variantName, quantity, unitPriceCents: priceCents });
    setAdded(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setAdded(false), CONFIRMATION_MS);
  };

  const label = added ? "Added" : "Add to cart";
  const reason = disabled ? disabledReason : atLimit ? "Maximum quantity reached" : null;

  return (
    <span className={cn("inline-flex flex-col gap-1.5", fullWidth && "w-full", className)}>
      <button
        type="button"
        onClick={handleClick}
        disabled={blocked}
        aria-label={added ? `${name} added to cart` : `Add ${name} to cart`}
        className={cn(buttonStyles({ variant, size, className: fullWidth ? "w-full" : undefined }), "min-w-36")}
      >
        {added ? (
          <Check className="h-4 w-4" aria-hidden="true" strokeWidth={2.5} />
        ) : (
          <Plus className="h-4 w-4" aria-hidden="true" strokeWidth={2.5} />
        )}
        {label}
      </button>
      {blocked && reason ? (
        <span className="text-xs font-medium text-ink-muted">{reason}</span>
      ) : null}
    </span>
  );
}
