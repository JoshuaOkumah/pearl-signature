"use client";

import { useActionState, useRef, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import {
  saveStoreSettingsAction,
  type StoreSettingsActionResult,
} from "@/lib/actions/store-settings";
import { CANADIAN_PROVINCES } from "@/lib/validations/checkout";
import { Button } from "@/components/ui/button";
import { CheckboxField, FormAlert, SelectField, TextAreaField, TextField } from "@/components/admin/field";

/**
 * Owner settings form (Phase 5, Milestone A).
 *
 * Records business decisions only: intake on/off, delivery coverage with
 * flat fees, arranged pickup with instructions, and the owner-attested tax
 * treatment. The form never pre-fills an area, a fee, a location or a rate
 * that the owner did not enter, and it never enables intake implicitly.
 *
 * Service-area rows always stay mounted (even while delivery is off) so
 * toggling delivery can never silently erase configured areas.
 */

export interface SettingsFormValues {
  orderIntakeEnabled: boolean;
  deliveryEnabled: boolean;
  serviceAreas: Array<{
    label: string;
    provinces: string[];
    postalPrefixes: string;
    fee: string;
  }>;
  pickupEnabled: boolean;
  pickupInstructions: string;
  taxMode: "unconfigured" | "zero" | "rate";
  taxRatePercent: string;
  taxBase: "merchandise" | "with_delivery" | "";
  taxLabel: string;
  customerNote: string;
  expectedUpdatedAt: string | null;
}

const initialState: StoreSettingsActionResult = { ok: false };

/** Field errors rendered next to their control instead of in the summary. */
const INLINE_ERROR_KEYS = new Set([
  "deliveryEnabled",
  "pickupEnabled",
  "pickupInstructions",
  "serviceAreas",
  "taxRatePercent",
  "taxBase",
  "customerNote",
]);

interface AreaRow {
  id: number;
  provinces: string[];
  /** Mount-time defaults; the DOM keeps whatever the owner types. */
  label: string;
  postalPrefixes: string;
  fee: string;
}

export function StoreSettingsForm({ initial }: { initial: SettingsFormValues }) {
  const [state, formAction, pending] = useActionState(saveStoreSettingsAction, initialState);

  const [rows, setRows] = useState<AreaRow[]>(() =>
    initial.serviceAreas.map((area, index) => ({
      id: index,
      provinces: [...area.provinces],
      label: area.label,
      postalPrefixes: area.postalPrefixes,
      fee: area.fee,
    })),
  );
  const nextId = useRef(initial.serviceAreas.length);

  const [taxMode, setTaxMode] = useState<string>(initial.taxMode);
  const [taxRatePercent, setTaxRatePercent] = useState(initial.taxRatePercent);
  const [taxBase, setTaxBase] = useState<string>(initial.taxBase);
  const [taxLabel, setTaxLabel] = useState(initial.taxLabel);

  const fieldErrors = state.fieldErrors ?? {};
  const summaryErrors = Object.entries(fieldErrors)
    .filter(([key]) => !INLINE_ERROR_KEYS.has(key))
    .map(([, message]) => message);

  const toggleProvince = (id: number, code: string): void => {
    setRows((previous) =>
      previous.map((row) =>
        row.id === id
          ? {
              ...row,
              provinces: row.provinces.includes(code)
                ? row.provinces.filter((existing) => existing !== code)
                : [...row.provinces, code],
            }
          : row,
      ),
    );
  };

  const addArea = (): void => {
    setRows((previous) => [
      ...previous,
      { id: nextId.current++, provinces: [], label: "", postalPrefixes: "", fee: "" },
    ]);
  };

  const removeArea = (id: number): void => {
    setRows((previous) => previous.filter((row) => row.id !== id));
  };

  return (
    <form action={formAction} className="space-y-6">
      <input
        type="hidden"
        name="expectedUpdatedAt"
        value={state.updatedAt ?? initial.expectedUpdatedAt ?? ""}
        readOnly
      />

      {summaryErrors.length > 0 ? (
        <FormAlert tone="error">
          <ul className="list-inside list-disc">
            {summaryErrors.map((message) => (
              <li key={message}>{message}</li>
            ))}
          </ul>
        </FormAlert>
      ) : null}

      {state.conflict ? (
        <FormAlert tone="error">
          These settings were changed somewhere else while you were editing. Reload the page to pick up the
          latest version, then reapply your change.
        </FormAlert>
      ) : null}

      {state.error ? <FormAlert tone="error">{state.error}</FormAlert> : null}

      {state.ok && !state.conflict ? (
        <FormAlert tone="success">Settings saved. The checkout page reflects them immediately.</FormAlert>
      ) : null}

      {/* ── order intake ─────────────────────────────────────────── */}

      <section aria-label="Order intake" className="rounded-2xl border border-border bg-surface p-5">
        <h2 className="font-sans text-base font-bold text-navy">Order intake</h2>
        <p className="mt-1 font-sans text-sm text-ink-muted">
          The master switch for live ordering. Keep it off until everything below is confirmed.
        </p>
        <div className="mt-4">
          <CheckboxField
            id="intake-enabled"
            name="orderIntakeEnabled"
            label="Accept orders from customers"
            hint="Requires at least one fulfilment method and a confirmed tax treatment."
            defaultChecked={initial.orderIntakeEnabled}
          />
        </div>
      </section>

      {/* ── delivery ─────────────────────────────────────────────── */}

      <section aria-label="Delivery" className="rounded-2xl border border-border bg-surface p-5">
        <h2 className="font-sans text-base font-bold text-navy">Delivery</h2>
        <p className="mt-1 font-sans text-sm text-ink-muted">
          List only the places you actually deliver to, with the exact charge. An address outside every
          area you list is refused at checkout.
        </p>
        <div className="mt-4">
          <CheckboxField
            id="delivery-enabled"
            name="deliveryEnabled"
            label="Offer delivery"
            hint="Customers choose delivery only when this is on."
            defaultChecked={initial.deliveryEnabled}
          />
        </div>
        {fieldErrors.deliveryEnabled ? (
          <p role="alert" className="mt-2 font-sans text-[13px] font-medium text-terracotta-700">
            {fieldErrors.deliveryEnabled}
          </p>
        ) : null}

        <div className="mt-5 flex flex-col gap-4">
          <h3 className="font-sans text-sm font-bold uppercase tracking-wide text-ink-muted">
            Service areas and fees
          </h3>

          {fieldErrors.serviceAreas ? (
            <p role="alert" className="font-sans text-[13px] font-medium text-terracotta-700">
              {fieldErrors.serviceAreas}
            </p>
          ) : null}

          {rows.length === 0 ? (
            <p className="rounded-xl border border-dashed border-navy/25 bg-cream-100 px-4 py-4 font-sans text-sm text-ink-muted">
              No service areas yet. Delivery cannot be offered until at least one area with a fee exists.
            </p>
          ) : null}

          {rows.map((row) => (
            <div key={row.id} className="rounded-xl border border-border bg-cream-100 p-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <TextField
                  id={`area-label-${row.id}`}
                  name="areaLabel"
                  label="Area name"
                  required
                  defaultValue={row.label}
                  placeholder="e.g. Downtown core"
                  maxLength={80}
                />
                <TextField
                  id={`area-fee-${row.id}`}
                  name="areaFee"
                  label="Delivery fee (CAD)"
                  required
                  inputMode="decimal"
                  defaultValue={row.fee}
                  placeholder="0 for free delivery"
                  hint="Exact amount charged for this area."
                />
              </div>

              <fieldset className="mt-4">
                <legend className="mb-2 font-sans text-sm font-semibold text-navy">
                  Provinces served
                  <span className="ml-0.5 text-terracotta-700">*</span>
                </legend>
                <div className="flex flex-wrap gap-2">
                  {CANADIAN_PROVINCES.map((province) => {
                    const checked = row.provinces.includes(province.code);
                    return (
                      <label
                        key={province.code}
                        className={
                          checked
                            ? "inline-flex cursor-pointer items-center gap-1.5 rounded-full border border-navy bg-navy px-3 py-1.5 font-sans text-xs font-semibold text-cream focus-within:ring-2 focus-within:ring-gold-700 focus-within:ring-offset-2"
                            : "inline-flex cursor-pointer items-center gap-1.5 rounded-full border border-navy/25 bg-surface px-3 py-1.5 font-sans text-xs font-semibold text-navy hover:border-navy/50 focus-within:ring-2 focus-within:ring-gold-700 focus-within:ring-offset-2"
                        }
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggleProvince(row.id, province.code)}
                          className="size-3.5 accent-[#1a2530] focus-gold"
                        />
                        {province.code}
                        <span className="sr-only">{province.name}</span>
                      </label>
                    );
                  })}
                </div>
              </fieldset>

              <div className="mt-4">
                <TextField
                  id={`area-postcodes-${row.id}`}
                  name="areaPostcodes"
                  label="Postal code prefixes (optional)"
                  defaultValue={row.postalPrefixes}
                  placeholder="e.g. M5H, M5V"
                  maxLength={2000}
                  hint="Comma-separated 3-character FSAs. Leave empty to cover the whole province listed above."
                />
              </div>

              <div className="mt-4 flex justify-end">
                <button
                  type="button"
                  onClick={() => removeArea(row.id)}
                  className="inline-flex min-h-9 items-center gap-1.5 rounded-full border border-terracotta-700/40 px-3 font-sans text-xs font-bold text-terracotta-700 transition-colors hover:bg-terracotta-700 hover:text-cream focus-gold"
                >
                  <Trash2 className="size-3.5" aria-hidden="true" />
                  Remove area
                </button>
              </div>
            </div>
          ))}

          <div>
            <Button type="button" variant="outline" size="sm" onClick={addArea}>
              <Plus className="size-4" aria-hidden="true" />
              Add service area
            </Button>
          </div>
        </div>
      </section>

      {/* ── pickup ───────────────────────────────────────────────── */}

      <section aria-label="Pickup" className="rounded-2xl border border-border bg-surface p-5">
        <h2 className="font-sans text-base font-bold text-navy">Arranged pickup</h2>
        <p className="mt-1 font-sans text-sm text-ink-muted">
          Offer pickup only when you can describe where and how collection works. The instructions are
          shown to the customer at checkout.
        </p>
        <div className="mt-4">
          <CheckboxField
            id="pickup-enabled"
            name="pickupEnabled"
            label="Offer pickup"
            defaultChecked={initial.pickupEnabled}
          />
        </div>
        <div className="mt-4">
          <TextAreaField
            id="pickup-instructions"
            name="pickupInstructions"
            label="Pickup instructions"
            required
            maxLength={500}
            defaultValue={initial.pickupInstructions}
            error={fieldErrors.pickupInstructions}
            hint="Where customers collect, and how collection is arranged. Required before pickup can be offered."
          />
        </div>
      </section>

      {/* ── tax ──────────────────────────────────────────────────── */}

      <section aria-label="Tax" className="rounded-2xl border border-border bg-surface p-5">
        <h2 className="font-sans text-base font-bold text-navy">Tax treatment</h2>
        <p className="mt-1 font-sans text-sm text-ink-muted">
          Enter only your confirmed treatment. The application never assumes a Canadian rate, and checkout
          stays blocked while this is unconfirmed.
        </p>

        <fieldset className="mt-4">
          <legend className="mb-2 font-sans text-sm font-semibold text-navy">Treatment</legend>
          <div className="flex flex-col gap-2">
            <label className="flex cursor-pointer items-start gap-3">
              <input
                type="radio"
                name="taxMode"
                value="unconfigured"
                checked={taxMode === "unconfigured"}
                onChange={() => setTaxMode("unconfigured")}
                className="mt-1 size-4 accent-[#1a2530] focus-gold"
              />
              <span>
                <span className="font-sans text-sm font-semibold text-navy">Not confirmed yet</span>
                <span className="block font-sans text-[13px] text-ink-muted">
                  Orders stay blocked until you decide.
                </span>
              </span>
            </label>

            <label className="flex cursor-pointer items-start gap-3">
              <input
                type="radio"
                name="taxMode"
                value="zero"
                checked={taxMode === "zero"}
                onChange={() => setTaxMode("zero")}
                className="mt-1 size-4 accent-[#1a2530] focus-gold"
              />
              <span>
                <span className="font-sans text-sm font-semibold text-navy">No tax collected on orders</span>
                <span className="block font-sans text-[13px] text-ink-muted">
                  Choose this only if your confirmed treatment means nothing is due on these orders.
                </span>
              </span>
            </label>

            <label className="flex cursor-pointer items-start gap-3">
              <input
                type="radio"
                name="taxMode"
                value="rate"
                checked={taxMode === "rate"}
                onChange={() => setTaxMode("rate")}
                className="mt-1 size-4 accent-[#1a2530] focus-gold"
              />
              <span>
                <span className="font-sans text-sm font-semibold text-navy">Approved rate</span>
                <span className="block font-sans text-[13px] text-ink-muted">
                  Your confirmed percentage, applied exactly as you set it below.
                </span>
              </span>
            </label>
          </div>
        </fieldset>

        {taxMode === "rate" ? (
          <div className="mt-4 grid gap-4 sm:grid-cols-3">
            <TextField
              id="tax-rate"
              name="taxRatePercent"
              label="Rate (%)"
              required
              inputMode="decimal"
              value={taxRatePercent}
              onChange={(event) => setTaxRatePercent(event.target.value)}
              placeholder="13"
              error={fieldErrors.taxRatePercent}
            />
            <SelectField
              id="tax-base"
              name="taxBase"
              label="Applies to"
              required
              value={taxBase}
              onChange={(event) => setTaxBase(event.target.value)}
              error={fieldErrors.taxBase}
            >
              <option value="">Choose one</option>
              <option value="merchandise">Merchandise subtotal</option>
              <option value="with_delivery">Merchandise and delivery fee</option>
            </SelectField>
            <TextField
              id="tax-label"
              name="taxLabel"
              label="Label shown to customers"
              value={taxLabel}
              onChange={(event) => setTaxLabel(event.target.value)}
              placeholder="e.g. HST"
              maxLength={40}
              hint="Optional."
            />
          </div>
        ) : null}
        {fieldErrors.taxMode ? (
          <p role="alert" className="mt-3 font-sans text-[13px] font-medium text-terracotta-700">
            {fieldErrors.taxMode}
          </p>
        ) : null}
      </section>

      {/* ── customer note ────────────────────────────────────────── */}

      <section aria-label="Customer note" className="rounded-2xl border border-border bg-surface p-5">
        <h2 className="font-sans text-base font-bold text-navy">Note for customers</h2>
        <div className="mt-4">
          <TextAreaField
            id="customer-note"
            name="customerNote"
            label="Fulfilment note (optional)"
            maxLength={300}
            defaultValue={initial.customerNote}
            error={fieldErrors.customerNote}
            hint="Shown at checkout, for example a general delivery or collection guideline."
          />
        </div>
      </section>

      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" variant="primary" disabled={pending}>
          {pending ? "Saving…" : "Save settings"}
        </Button>
        {pending ? (
          <span role="status" className="font-sans text-sm text-ink-muted">
            Saving your settings…
          </span>
        ) : null}
      </div>
    </form>
  );
}
