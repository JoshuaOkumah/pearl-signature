"use client";

import Image from "next/image";
import Link from "next/link";
import { AlertTriangle, Info, Loader2, X } from "lucide-react";
import { canDeliverImage } from "@/lib/images";
import { formatCad } from "@/lib/format";
import { placeholderThemeFor } from "@/lib/placeholder-themes";
import { remainingQuantityFor } from "@/lib/cart/core";
import { quoteIssueCopy } from "@/lib/cart/issues";
import { MAX_LINE_QUANTITY } from "@/lib/cart/limits";
import { cn } from "@/lib/utils";
import type { CartLineView } from "@/lib/cart/context";
import type { CartState } from "@/lib/cart/core";
import { FoodMedia } from "@/components/shared/food-media";
import { QuantityStepper } from "./quantity-stepper";

interface CartLineRowProps {
  line: CartLineView;
  state: CartState;
  onQuantityChange: (key: string, quantity: number) => void;
  onRemove: (key: string) => void;
  /** "drawer" is the compact quick-access panel; "page" is `/cart`. */
  density?: "drawer" | "page";
}

/**
 * One cart line, shared by the quick-access drawer and the dedicated cart
 * page so both surfaces stay pixel-consistent.
 *
 * Every figure it shows comes from the server quote: name, image, unit price
 * and line total are never read from browser storage. While the first quote
 * for a line is still in flight the row renders a resolving placeholder
 * instead of guessing at a name or a price.
 */
export function CartLineRow({
  line,
  state,
  onQuantityChange,
  onRemove,
  density = "page",
}: CartLineRowProps) {
  const compact = density === "drawer";
  const quote = line.quote;
  const name = quote?.name ?? null;
  const unitPriceCents = quote?.unitPriceCents ?? null;
  const lineTotalCents = unitPriceCents === null ? null : unitPriceCents * line.quantity;
  const resolving = quote === null;
  const displayName = name ?? (resolving ? "Loading item" : "Unavailable item");
  const blocked = quote?.issue != null;

  const maxQuantity = Math.max(
    1,
    Math.min(MAX_LINE_QUANTITY, remainingQuantityFor(state, line.slug, line.variantName)),
  );

  return (
    <li
      data-testid="cart-line"
      className={cn(
        "flex gap-3 border-b border-sand last:border-b-0",
        compact ? "py-4" : "gap-4 py-5",
      )}
    >
      <div className={cn("shrink-0", compact ? "w-16" : "w-20 md:w-24")}>
        <CartThumbnail line={line} displayName={displayName} />
      </div>

      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            {name ? (
              <Link
                href={`/menu/${line.slug}`}
                className="focus-gold block truncate rounded text-base font-semibold text-navy hover:text-gold-700"
                title={displayName}
              >
                {displayName}
              </Link>
            ) : (
              <span className="block truncate text-base font-semibold text-navy/60">
                {displayName}
              </span>
            )}

            {line.variantName ? (
              <p className="mt-0.5 truncate text-sm text-ink-muted">
                <span className="sr-only">Option: </span>
                {line.variantName}
              </p>
            ) : null}
          </div>

          <button
            type="button"
            onClick={() => onRemove(line.key)}
            aria-label={`Remove ${displayName} from your cart`}
            className={cn(
              "focus-gold -mr-1 inline-flex shrink-0 items-center justify-center rounded-full text-ink-muted transition-colors hover:bg-terracotta-100 hover:text-terracotta-700",
              compact ? "h-9 w-9" : "h-10 w-10",
            )}
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>

        {blocked ? (
          <LineNotice tone="warning" icon={<AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" />}>
            {quoteIssueCopy(quote!.issue!)}
          </LineNotice>
        ) : line.priceChanged ? (
          <LineNotice tone="info" icon={<Info className="h-3.5 w-3.5" aria-hidden="true" />}>
            Price updated from {formatCad(line.seenUnitPriceCents)} to {formatCad(unitPriceCents)}.
          </LineNotice>
        ) : null}

        <div className="mt-1 flex flex-wrap items-center justify-between gap-3">
          <QuantityStepper
            value={line.quantity}
            onChange={(next) => onQuantityChange(line.key, next)}
            label={displayName}
            max={maxQuantity}
            size={compact ? "sm" : "md"}
            disabled={resolving || blocked}
          />

          <div className="text-right">
            {resolving ? (
              <span className="inline-flex items-center gap-1.5 text-sm text-ink-muted">
                <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                Checking
              </span>
            ) : lineTotalCents === null ? (
              <span className="text-sm font-medium text-ink-muted">
                {blocked && quote?.issue !== "unpriced" && quote?.issue !== "variant_unpriced"
                  ? "Price unavailable"
                  : "Price to be confirmed"}
              </span>
            ) : (
              <span className={cn("font-semibold tabular-nums text-navy", compact ? "text-base" : "text-lg")}>
                {formatCad(lineTotalCents)}
              </span>
            )}
            {!compact && unitPriceCents !== null && line.quantity > 1 ? (
              <p className="text-xs text-ink-muted">
                {formatCad(unitPriceCents)} each
              </p>
            ) : null}
          </div>
        </div>
      </div>
    </li>
  );
}

/**
 * Small inline alert used for reconciliation warnings and price-change
 * notices. The icon plus wording carry the meaning, so colour is never the
 * only signal.
 */
export function LineNotice({
  tone,
  icon,
  children,
  className,
}: {
  tone: "warning" | "info";
  icon: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <p
      className={cn(
        "flex items-start gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium leading-snug",
        tone === "warning" ? "bg-terracotta-100 text-terracotta-700" : "bg-gold-100 text-gold-700",
        className,
      )}
    >
      <span className="mt-px shrink-0">{icon}</span>
      <span>{children}</span>
    </p>
  );
}

/** Product photo when deliverable, otherwise the on-brand placeholder art. */
function CartThumbnail({ line, displayName }: { line: CartLineView; displayName: string }) {
  const quote = line.quote;
  const image = quote?.image ?? null;

  if (canDeliverImage(image)) {
    return (
      <div className="relative aspect-square w-full overflow-hidden rounded-xl bg-cream-100">
        <Image
          src={image.secureUrl}
          alt={image.alt}
          fill
          sizes="(max-width: 768px) 64px, 96px"
          className="object-cover"
        />
      </div>
    );
  }

  return (
    <FoodMedia
      theme={placeholderThemeFor(quote?.categorySlug ?? "")}
      label={displayName}
      ratio="square"
      sizes="96px"
      idSuffix={`cart-${line.key}`}
      className="rounded-xl"
    />
  );
}
