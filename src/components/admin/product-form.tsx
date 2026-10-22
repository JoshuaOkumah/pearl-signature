"use client";

import { useActionState, useEffect, useState } from "react";
import { Loader2, Plus, Trash2 } from "lucide-react";
import type { ProductActionResult } from "@/lib/actions/products";
import type { AdminProductDetail } from "@/lib/repositories/admin";
import { formatCadInput } from "@/lib/validations/admin";
import { Button } from "@/components/ui/button";
import {
  CheckboxField,
  FormAlert,
  SelectField,
  TextAreaField,
  TextField,
} from "@/components/admin/field";

/**
 * Product create/edit form (Phase 3).
 *
 * - The parsed Server Action output is the complete writable allowlist;
 *   this form cannot mass-assign anything else.
 * - Prices are typed as CAD text (`12.50`) and converted to integer
 *   cents server-side with integer arithmetic.
 * - Variants are optional rows the owner adds deliberately; nothing is
 *   created automatically.
 * - Unsaved-changes protection warns before leaving with edits.
 * - A failed save keeps every entered value (nothing is cleared), and a
 *   concurrent-edit conflict asks the owner to reload instead of
 *   overwriting newer data.
 */

const initialState: ProductActionResult = { ok: false };

export interface CategoryOption {
  id: string;
  name: string;
  isActive: boolean;
}

interface VariantRow {
  name: string;
  price: string;
}

export function ProductForm({
  mode,
  action,
  categories,
  product,
  disabled = false,
}: {
  mode: "create" | "edit";
  action: (state: ProductActionResult, formData: FormData) => Promise<ProductActionResult>;
  categories: CategoryOption[];
  product?: AdminProductDetail;
  /** Archived products are read-only until restored. */
  disabled?: boolean;
}) {
  const [state, formAction, pending] = useActionState(action, initialState);
  const [dirty, setDirty] = useState(false);
  const [variants, setVariants] = useState<VariantRow[]>(
    product?.variants.map((variant) => ({ name: variant.name, price: variant.priceInput })) ?? [],
  );

  useEffect(() => {
    if (!dirty) return;
    function onBeforeUnload(event: BeforeUnloadEvent) {
      event.preventDefault();
      event.returnValue = "";
    }
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirty]);

  const fieldErrors = state.fieldErrors ?? {};

  return (
    <form
      action={formAction}
      onSubmit={() => setDirty(false)}
      onChange={() => setDirty(true)}
      className="space-y-8"
      noValidate
    >
      {state.error ? <FormAlert tone="error">{state.error}</FormAlert> : null}
      {state.conflict ? (
        <FormAlert tone="error">
          This product was changed in another window or tab.{" "}
          <a href={`/admin/products/${product?.id}/edit`} className="font-semibold underline underline-offset-2 focus-gold rounded">
            Reload to get the latest version
          </a>{" "}
          before saving again.
        </FormAlert>
      ) : null}

      {product ? <input type="hidden" name="id" value={product.id} /> : null}
      {product ? (
        <input type="hidden" name="expectedUpdatedAt" value={product.updatedAt} />
      ) : null}

      {/* `contents` keeps layout while the fieldset provides the disabled
          state for archived products (a form element cannot be disabled). */}
      <fieldset disabled={disabled} className="contents">

      {/* ── Basics ─────────────────────────────────────────────────── */}
      <section aria-labelledby="form-basics" className="space-y-4">
        <h2 id="form-basics" className="font-serif text-xl font-semibold text-navy">
          Basics
        </h2>
        <TextField
          id="product-name"
          name="name"
          label="Product name"
          required
          defaultValue={product?.name ?? ""}
          placeholder="e.g. Egusi Soup"
          error={fieldErrors.name}
        />
        <TextField
          id="product-slug"
          name="slug"
          label="Web address (slug)"
          defaultValue={product?.slug ?? ""}
          placeholder="Created from the name if left blank"
          error={fieldErrors.slug}
          hint={
            mode === "create"
              ? "Leave blank to create it from the name. You can change it later."
              : "Leave blank to keep the current address. If you change it, the old link keeps working by redirecting."
          }
        />
        <SelectField
          id="product-category"
          name="categoryId"
          label="Category"
          required
          defaultValue={product?.categoryId ?? ""}
          error={fieldErrors.categoryId}
        >
          <option value="" disabled>
            Choose a category
          </option>
          {categories.map((category) => (
            <option key={category.id} value={category.id}>
              {category.name}
              {category.isActive ? "" : " (disabled, hidden from customers)"}
            </option>
          ))}
        </SelectField>
        <TextField
          id="product-short-description"
          name="shortDescription"
          label="Short description"
          defaultValue={product?.shortDescription ?? ""}
          placeholder="One or two lines shown on cards (optional)"
          error={fieldErrors.shortDescription}
          maxLength={180}
        />
        <TextAreaField
          id="product-description"
          name="description"
          label="Full description"
          required
          defaultValue={product?.description ?? ""}
          placeholder="Describe the dish, portion guidance and anything customers should know"
          error={fieldErrors.description}
        />
      </section>

      {/* ── Pricing ────────────────────────────────────────────────── */}
      <section aria-labelledby="form-pricing" className="space-y-4">
        <h2 id="form-pricing" className="font-serif text-xl font-semibold text-navy">
          Pricing
        </h2>
        <TextField
          id="product-price"
          name="price"
          label="Price (CAD)"
          inputMode="decimal"
          defaultValue={product ? formatCadInput(product.priceCents) : ""}
          placeholder="12.50"
          error={fieldErrors.price}
          hint="Leave blank until the price is confirmed. Products without a price are shown as “Price to be confirmed” and cannot be treated as purchasable."
        />

        <fieldset className="space-y-3">
          <legend className="mb-1 font-sans text-sm font-semibold text-navy">
            Options (optional)
          </legend>
          <p className="font-sans text-[13px] text-ink-muted">
            Add sizes or portions with their own prices, for example Small, Medium or
            Family. Products without options sell at the single price above.
          </p>
          {variants.map((variant, index) => (
            <div key={index} className="flex flex-wrap items-end gap-3 rounded-xl border border-border bg-cream-100 p-3">
              <div className="min-w-40 flex-1">
                <TextField
                  id={`variant-name-${index}`}
                  label="Option name"
                  name="variantName"
                  value={variant.name}
                  onChange={(event) => {
                    const next = [...variants];
                    next[index] = { ...variant, name: event.target.value };
                    setVariants(next);
                  }}
                  placeholder="e.g. Family portion"
                />
              </div>
              <div className="w-32">
                <TextField
                  id={`variant-price-${index}`}
                  label="Price (CAD)"
                  name="variantPrice"
                  inputMode="decimal"
                  value={variant.price}
                  onChange={(event) => {
                    const next = [...variants];
                    next[index] = { ...variant, price: event.target.value };
                    setVariants(next);
                  }}
                  placeholder="20.00"
                />
              </div>
              <button
                type="button"
                onClick={() => setVariants(variants.filter((_, position) => position !== index))}
                aria-label={`Remove option ${variant.name || index + 1}`}
                className="flex size-11 items-center justify-center rounded-lg text-terracotta-700 transition-colors hover:bg-terracotta-700/10 focus-gold"
              >
                <Trash2 className="size-4.5" aria-hidden="true" />
              </button>
            </div>
          ))}
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setVariants([...variants, { name: "", price: "" }])}
          >
            <Plus className="size-4" aria-hidden="true" />
            Add option
          </Button>
          {fieldErrors.variants ? (
            <p role="alert" className="font-sans text-[13px] font-medium text-terracotta-700">
              {fieldErrors.variants}
            </p>
          ) : null}
        </fieldset>
      </section>

      {/* ── Availability ───────────────────────────────────────────── */}
      <section aria-labelledby="form-availability" className="space-y-4">
        <h2 id="form-availability" className="font-serif text-xl font-semibold text-navy">
          Visibility
        </h2>
        <fieldset>
          <legend className="mb-1.5 font-sans text-sm font-semibold text-navy">Publication</legend>
          <div className="flex flex-wrap gap-3">
            {(["draft", "published"] as const).map((value) => (
              <label
                key={value}
                className="inline-flex min-h-11 cursor-pointer items-center gap-2.5 rounded-xl border border-navy/20 bg-surface px-4 font-sans text-sm font-semibold text-navy transition-colors has-[:checked]:border-navy has-[:checked]:bg-navy has-[:checked]:text-cream has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-gold"
              >
                <input
                  type="radio"
                  name="status"
                  value={value}
                  defaultChecked={(product?.status ?? "draft") === value}
                  className="accent-current"
                />
                {value === "draft" ? "Draft (hidden)" : "Published"}
              </label>
            ))}
          </div>
          <p className="mt-1.5 font-sans text-[13px] text-ink-muted">
            Draft products are never shown to customers.
          </p>
          {fieldErrors.status ? (
            <p role="alert" className="mt-1.5 font-sans text-[13px] font-medium text-terracotta-700">
              {fieldErrors.status}
            </p>
          ) : null}
        </fieldset>

        <fieldset>
          <legend className="mb-1.5 font-sans text-sm font-semibold text-navy">Customer availability</legend>
          <div className="flex flex-wrap gap-3">
            {(["available", "unavailable"] as const).map((value) => (
              <label
                key={value}
                className="inline-flex min-h-11 cursor-pointer items-center gap-2.5 rounded-xl border border-navy/20 bg-surface px-4 font-sans text-sm font-semibold text-navy transition-colors has-[:checked]:border-navy has-[:checked]:bg-navy has-[:checked]:text-cream has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-gold"
              >
                <input
                  type="radio"
                  name="availability"
                  value={value}
                  defaultChecked={(product?.availability ?? "available") === value}
                  className="accent-current"
                />
                {value === "available" ? "Available" : "Unavailable"}
              </label>
            ))}
          </div>
          <p className="mt-1.5 font-sans text-[13px] text-ink-muted">
            Published but unavailable products stay visible with a clear “Unavailable” state.
          </p>
          {fieldErrors.availability ? (
            <p role="alert" className="mt-1.5 font-sans text-[13px] font-medium text-terracotta-700">
              {fieldErrors.availability}
            </p>
          ) : null}
        </fieldset>

        <CheckboxField
          id="product-featured"
          name="featured"
          label="Featured product"
          hint="Shown in the Featured selections on the storefront homepage."
          defaultChecked={product?.featured ?? false}
        />
      </section>

      {/* ── Organisation ───────────────────────────────────────────── */}
      <section aria-labelledby="form-organisation" className="space-y-4">
        <h2 id="form-organisation" className="font-serif text-xl font-semibold text-navy">
          Organisation
        </h2>
        <TextField
          id="product-tags"
          name="tags"
          label="Tags"
          defaultValue={product?.tags.join(", ") ?? ""}
          placeholder="e.g. spicy, family size (comma separated)"
          hint="Optional. Up to 10 tags."
          error={fieldErrors.tags}
        />
        <TextField
          id="product-sort-order"
          name="sortOrder"
          label="Display order"
          type="number"
          defaultValue={product?.sortOrder ?? 0}
          error={fieldErrors.sortOrder}
          hint="Lower numbers are listed first within the category."
        />
      </section>

      {disabled ? null : (
        <div className="flex items-center gap-3 border-t border-border pt-6">
          <Button type="submit" variant="primary" size="lg" disabled={pending}>
            {pending ? (
              <>
                <Loader2 className="size-4 motion-safe:animate-spin" aria-hidden="true" />
                Saving…
              </>
            ) : mode === "create" ? (
              "Create product"
            ) : (
              "Save changes"
            )}
          </Button>
          {pending ? (
            <span role="status" className="font-sans text-sm text-ink-muted">
              Saving your changes…
            </span>
          ) : null}
          <span aria-live="polite" className="sr-only">
            {pending ? "Saving" : ""}
          </span>
        </div>
      )}

      </fieldset>
    </form>
  );
}
