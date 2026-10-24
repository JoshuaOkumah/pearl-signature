import { render, type RenderResult } from "@testing-library/react";
import type { ReactNode } from "react";
import { CartProvider } from "@/lib/cart/context";

/**
 * Render helper for any component that transitively uses the cart (Phase 4).
 *
 * `CartProvider` now wraps the whole app in `src/app/layout.tsx`, so the
 * header's cart button, quick-add on product cards and the purchase panel all
 * legitimately expect it. Tests render through here rather than around each
 * individual component.
 *
 * The provider's reconciliation timer is cleared on unmount, and this
 * repository's tests finish synchronously, so the server action is never
 * actually invoked from these suites.
 */
export function renderWithCart(ui: ReactNode): RenderResult {
  const result = render(<CartProvider>{ui}</CartProvider>);

  return {
    ...result,
    // Keep the provider in place across updates, the same way the real app
    // keeps it mounted for the lifetime of the session.
    rerender: (next: ReactNode) => result.rerender(<CartProvider>{next}</CartProvider>),
  };
}
