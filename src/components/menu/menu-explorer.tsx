"use client";

import { AnimatePresence, motion } from "motion/react";
import { SearchX } from "lucide-react";
import { useMemo, useState } from "react";
import { ALL, countByCategory, filterProducts, type MenuFilter } from "@/lib/filter";
import { pluralize } from "@/lib/utils";
import type { Category, Product } from "@/types";
import { Button } from "@/components/ui/button";
import { Chip } from "@/components/ui/chip";
import { ProductCard } from "@/components/shared/product-card";

interface MenuExplorerProps {
  initialFilter?: MenuFilter;
  products: Product[];
  categories: Category[];
}

/**
 * Interactive menu preview. Filtering is client-side against typed local
 * data; when MongoDB lands, the same component will receive server-fetched
 * products with no presentation changes.
 */
export function MenuExplorer({ initialFilter = ALL, products, categories }: MenuExplorerProps) {
  const [filter, setFilter] = useState<MenuFilter>(initialFilter);
  const visible = useMemo(() => filterProducts(products, filter), [products, filter]);

  return (
    <div>
      <div role="group" aria-label="Filter menu by category" className="flex flex-wrap gap-2.5">
        <Chip label="All" count={products.length} active={filter === ALL} onSelect={() => setFilter(ALL)} />
        {categories.map((category) => (
          <Chip
            key={category.slug}
            label={category.name}
            count={countByCategory(products, category.slug)}
            active={filter === category.slug}
            onSelect={() => setFilter(category.slug)}
          />
        ))}
      </div>

      <p aria-live="polite" className="mt-6 text-sm font-semibold text-ink-muted">
        {filter === ALL
          ? `Showing all ${products.length} dishes`
          : `Showing ${visible.length} ${pluralize(visible.length, "dish", "dishes")}`}
      </p>

      {visible.length > 0 ? (
        <motion.ul layout className="mt-6 grid gap-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          <AnimatePresence mode="popLayout">
            {visible.map((product) => (
              <motion.li
                key={product.slug}
                layout
                initial={{ opacity: 0, scale: 0.96 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.96 }}
                transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
              >
                <ProductCard product={product} />
              </motion.li>
            ))}
          </AnimatePresence>
        </motion.ul>
      ) : (
        <div className="mt-6 flex flex-col items-center rounded-3xl border border-dashed border-sand bg-cream-100 px-6 py-16 text-center">
          <span className="flex h-14 w-14 items-center justify-center rounded-full bg-cream-200 text-ink-muted">
            <SearchX className="h-6 w-6" aria-hidden="true" />
          </span>
          <h3 className="mt-5 font-display text-xl font-semibold text-navy">Nothing here yet</h3>
          <p className="mt-2 max-w-sm text-sm leading-relaxed text-ink-muted">
            We couldn’t find dishes in this category yet. Try another category, or browse the full menu.
          </p>
          <Button variant="outline" className="mt-6" onClick={() => setFilter(ALL)}>
            View everything
          </Button>
        </div>
      )}
    </div>
  );
}
