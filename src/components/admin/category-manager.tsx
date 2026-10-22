"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { CheckCircle2, Eye, EyeOff, Plus } from "lucide-react";
import {
  createCategoryAction,
  updateCategoryAction,
  type CategoryActionResult,
} from "@/lib/actions/categories";
import type { AdminCategoryRow } from "@/lib/repositories/admin";
import { CATEGORY_VISIBILITY_POLICY } from "@/lib/admin-policy";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CheckboxField, FormAlert, TextAreaField, TextField } from "@/components/admin/field";

/**
 * Category management (Phase 3).
 *
 * Names, descriptions and display order are editable; the slug (web
 * address) is created once and never changes, so public filter links stay
 * stable when a category is renamed. Categories are disabled, never
 * deleted, so product references always remain valid.
 */

const initialState: CategoryActionResult = { ok: false };

function CategoryRow({ category }: { category: AdminCategoryRow }) {
  const [state, formAction, pending] = useActionState(updateCategoryAction, initialState);
  const [disarmOnBlur, setDisarmOnBlur] = useState(false);
  const [armed, setArmed] = useState(false);

  // Disabling a category that has products deserves a deliberate confirm.
  const needsConfirm = category.isActive && category.productCount > 0;

  return (
    <li className="rounded-2xl border border-border bg-surface p-4 md:p-5">
      <form action={formAction} onChange={() => setDisarmOnBlur(true)} className="space-y-4">
        <input type="hidden" name="id" value={category.id} />

        <div className="flex flex-wrap items-center gap-2">
          <h3 className="font-sans text-base font-bold text-navy">{category.name}</h3>
          <Badge tone={category.isActive ? "leaf" : "neutral"}>
            {category.isActive ? (
              <>
                <Eye className="size-3" aria-hidden="true" />
                Active
              </>
            ) : (
              <>
                <EyeOff className="size-3" aria-hidden="true" />
                Disabled
              </>
            )}
          </Badge>
          <Badge tone="neutral">
            {category.productCount} product{category.productCount === 1 ? "" : "s"}
          </Badge>
        </div>

        {state.error ? <FormAlert tone="error">{state.error}</FormAlert> : null}

        <div className="grid gap-4 sm:grid-cols-2">
          <TextField
            id={`category-name-${category.id}`}
            name="name"
            label="Name"
            required
            defaultValue={category.name}
            error={state.fieldErrors?.name}
          />
          <TextField
            id={`category-slug-${category.id}`}
            label="Web address"
            defaultValue={category.slug}
            readOnly
            disabled
            hint="Fixed after creation so existing links keep working."
          />
        </div>
        <TextAreaField
          id={`category-description-${category.id}`}
          name="description"
          label="Description"
          defaultValue={category.description}
          maxLength={400}
          error={state.fieldErrors?.description}
        />
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField
            id={`category-order-${category.id}`}
            name="sortOrder"
            label="Display order"
            type="number"
            required
            defaultValue={category.sortOrder}
            error={state.fieldErrors?.sortOrder}
            hint="Lower numbers appear first."
          />
          <div className="flex items-end pb-1">
            <CheckboxField
              id={`category-active-${category.id}`}
              name="isActive"
              label="Visible to customers"
              defaultChecked={category.isActive}
            />
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3 border-t border-border pt-4">
          <button
            type="submit"
            onClick={(event) => {
              const disabling = (event.currentTarget as HTMLButtonElement).form?.querySelector(
                `#category-active-${category.id}`,
              ) as HTMLInputElement | null;
              if (armed || !needsConfirm || disabling?.checked) return;
              event.preventDefault();
              setArmed(true);
            }}
            onBlur={() => {
              if (!disarmOnBlur) return;
              setArmed(false);
            }}
            disabled={pending}
            className={
              armed
                ? "inline-flex min-h-11 items-center gap-2 rounded-full bg-terracotta-700 px-6 font-sans text-sm font-semibold text-cream transition-colors hover:bg-terracotta-800 focus-gold disabled:pointer-events-none disabled:opacity-50"
                : "inline-flex min-h-11 items-center gap-2 rounded-full bg-navy px-6 font-sans text-sm font-semibold text-cream transition-colors hover:bg-navy-800 focus-gold disabled:pointer-events-none disabled:opacity-50"
            }
          >
            {pending ? "Saving…" : armed ? "Confirm disable" : "Save changes"}
          </button>
          {armed ? (
            <p role="alert" className="font-sans text-sm font-semibold text-terracotta-700">
              Disabling hides this category and its products from the storefront until you
              enable it again. Press again to confirm.
            </p>
          ) : null}
        </div>
      </form>
    </li>
  );
}

export function CategoryManager({ categories }: { categories: AdminCategoryRow[] }) {
  const [createState, createFormAction, createPending] = useActionState(
    createCategoryAction,
    initialState,
  );

  return (
    <div className="space-y-8">
      <section aria-labelledby="add-category" className="rounded-2xl border border-border bg-surface p-5 md:p-7">
        <h2 id="add-category" className="font-serif text-xl font-semibold text-navy">
          Add a category
        </h2>
        <p className="mt-1 font-sans text-[13px] text-ink-muted">
          New categories appear in the storefront filters as soon as they are active.{" "}
          <Link
            href="/menu"
            className="rounded font-semibold underline underline-offset-2 focus-gold"
          >
            See the storefront
          </Link>
          .
        </p>
        <form action={createFormAction} className="mt-4 space-y-4">
          {createState.error ? <FormAlert tone="error">{createState.error}</FormAlert> : null}
          {createState.ok ? (
            <p role="status" className="flex items-start gap-2 rounded-lg border border-leaf/40 bg-leaf/10 px-4 py-3 font-sans text-sm text-navy-900">
              <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-leaf-700" aria-hidden="true" />
              Category created.
            </p>
          ) : null}
          <div className="grid gap-4 sm:grid-cols-2">
            <TextField
              id="new-category-name"
              name="name"
              label="Name"
              required
              placeholder="e.g. Soups and Stews"
              error={createState.fieldErrors?.name}
            />
            <TextField
              id="new-category-order"
              name="sortOrder"
              label="Display order"
              type="number"
              required
              defaultValue={categories.length + 1}
              error={createState.fieldErrors?.sortOrder}
              hint="Lower numbers appear first."
            />
          </div>
          <TextAreaField
            id="new-category-description"
            name="description"
            label="Description"
            placeholder="Optional line shown with the category (optional)"
            maxLength={400}
            error={createState.fieldErrors?.description}
          />
          <CheckboxField
            id="new-category-active"
            name="isActive"
            label="Visible to customers"
            defaultChecked
          />
          <Button type="submit" variant="primary" disabled={createPending}>
            {createPending ? (
              <>
                <Plus className="size-4 motion-safe:animate-spin" aria-hidden="true" />
                Adding…
              </>
            ) : (
              <>
                <Plus className="size-4" aria-hidden="true" />
                Add category
              </>
            )}
          </Button>
        </form>
      </section>

      <section aria-labelledby="existing-categories" className="space-y-4">
        <div>
          <h2 id="existing-categories" className="font-serif text-xl font-semibold text-navy">
            Existing categories
          </h2>
          <p className="mt-1 max-w-2xl font-sans text-[13px] text-ink-muted">
            {CATEGORY_VISIBILITY_POLICY}
          </p>
        </div>
        {categories.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-border px-4 py-10 text-center font-sans text-sm text-ink-muted">
            No categories yet. Add your first category above.
          </p>
        ) : (
          <ul className="space-y-3">
            {categories.map((category) => (
              <CategoryRow key={category.id} category={category} />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
