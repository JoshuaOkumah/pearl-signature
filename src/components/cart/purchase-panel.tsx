"use client";

import { AlertTriangle, Check } from "lucide-react";
import { useMemo, useState } from "react";
import { formatCad } from "@/lib/format";
import { isPriced } from "@/lib/cart/purchasable";
import { QuantityStepper } from "@/components/cart/quantity-stepper";
import { AddToCartButton } from "@/components/cart/add-to-cart-button";
import { cn } from "@/lib/utils";
import type { Product } from "@/types";

interface PurchasePanelProps {
  product: Product;
}

/**
 * Purchasing controls for `/menu/[slug]`.
 *
 * Availability rules made visible here:
 *  - A product with options cannot be bought until one is chosen, and only
 *    options the owner has priced are selectable. Unpriced options are shown
 *    (so the customer can see the range the business offers) but are never
 *    orderable.
 *  - When options exist, their price is the price — the base price is not
 *    silently substituted.
 *  - An unavailable or unpriced product keeps its honest "not orderable yet"
 *    message instead of a disabled button with no explanation.
 */
export function PurchasePanel({ product }: PurchasePanelProps) {
  const variants = product.variants;
  const hasVariants = variants.length > 0;
  const pricedVariantNames = useMemo(
    () => variants.filter((variant) => isPriced(variant.priceCents)).map((variant) => variant.name),
    [variants],
  );

  const [selectedName, setSelectedName] = useState<string | null>(
    hasVariants ? (pricedVariantNames[0] ?? null) : null,
  );
  const [quantity, setQuantity] = useState(1);

  const unavailable = product.availability !== "available";
  const selectedVariant = hasVariants
    ? variants.find((variant) => variant.name === selectedName) ?? null
    : null;
  const unitPriceCents = hasVariants ? (selectedVariant?.priceCents ?? null) : product.priceCents;
  const priceIsKnown = isPriced(unitPriceCents);

  const missingSelection = hasVariants && selectedName === null;
  const canOrder = !unavailable && priceIsKnown && !missingSelection;

  const blockedReason = unavailable
    ? "This dish is temporarily unavailable."
    : missingSelection
      ? "Please choose a portion to continue."
      : !priceIsKnown
        ? "The price for this dish has not been confirmed yet."
        : null;

  return (
    <div className="rounded-3xl border border-border bg-surface p-5 shadow-card sm:p-7">
      {/* Price — always the figure for the CURRENT selection. */}
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <p
          data-testid="purchase-price"
          className="font-display text-3xl font-semibold tracking-[-0.01em] text-navy sm:text-4xl"
        >
          {priceIsKnown ? formatCad(unitPriceCents) : "Price to be confirmed"}
        </p>
        {hasVariants && priceIsKnown ? (
          <span className="text-sm font-medium text-ink-muted">for the selected option</span>
        ) : null}
      </div>

      {hasVariants ? (
        <fieldset className="mt-6">
          <legend className="text-sm font-bold uppercase tracking-[0.14em] text-gold-700">
            Choose an option
          </legend>
          <div className="mt-3 flex flex-col gap-2" data-testid="variant-options">
            {variants.map((variant) => {
              const priced = isPriced(variant.priceCents);
              const checked = selectedName === variant.name;
              return (
                <label
                  key={variant.name}
                  className={cn(
                    "focus-within:ring-2 focus-within:ring-gold-700 focus-within:ring-offset-2 flex cursor-pointer items-center justify-between gap-3 rounded-2xl border px-4 py-3 transition-colors",
                    !priced && "cursor-not-allowed opacity-70",
                    checked ? "border-navy bg-cream-100" : "border-border hover:border-navy/40",
                  )}
                >
                  <span className="flex items-center gap-3">
                    <input
                      type="radio"
                      name="variant"
                      value={variant.name}
                      checked={checked}
                      disabled={!priced}
                      onChange={() => setSelectedName(variant.name)}
                      className="h-4 w-4 shrink-0 accent-[#1a2530]"
                    />
                    <span className="text-base font-semibold text-navy">{variant.name}</span>
                    {checked ? (
                      <Check className="h-4 w-4 text-leaf-700" aria-hidden="true" strokeWidth={2.5} />
                    ) : null}
                  </span>
                  <span className="text-sm font-semibold tabular-nums text-navy-700">
                    {priced ? formatCad(variant.priceCents) : "Price to be confirmed"}
                  </span>
                </label>
              );
            })}
          </div>
        </fieldset>
      ) : null}

      {canOrder ? (
        <div className="mt-6 flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="mb-2 text-sm font-bold uppercase tracking-[0.14em] text-gold-700">Quantity</p>
            <QuantityStepper value={quantity} onChange={setQuantity} label={product.name} />
          </div>

          <AddToCartButton
            slug={product.slug}
            name={product.name}
            priceCents={unitPriceCents as number}
            variantName={selectedName}
            quantity={quantity}
            size="lg"
            className="flex-1 sm:flex-none"
          />
        </div>
      ) : (
        <>
          {/* No purchase controls at all when the product cannot be bought: a
              disabled button invites pointless clicks, so an honest
              explanation is shown in its place. */}
          <p
            data-testid="not-orderable"
            className="mt-6 flex items-start gap-2 rounded-2xl bg-cream-100 px-4 py-3 text-sm font-medium leading-relaxed text-navy-700"
          >
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-terracotta-700" aria-hidden="true" />
            {blockedReason}
          </p>
          {/* Unpriced products keep the timing the storefront promises
              everywhere else: pricing arrives when ordering opens. */}
          {!priceIsKnown && !unavailable ? (
            <p className="mt-2 text-sm text-ink-muted">
              Final pricing is published when ordering opens.
            </p>
          ) : null}
        </>
      )}
    </div>
  );
}
