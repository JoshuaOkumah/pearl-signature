"use client";

import { cloneElement, isValidElement, useId, useState, type ReactElement, type ReactNode } from "react";
import { AlertTriangle, Info } from "lucide-react";
import {
  CANADIAN_PROVINCES,
  checkoutFieldErrors,
  checkoutFormSchema,
  EMPTY_CHECKOUT_VALUES,
  type CheckoutFieldErrors,
  type CheckoutFormValues,
  type FulfillmentMethod,
} from "@/lib/validations/checkout";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";

/**
 * Customer and fulfilment form for `/checkout`.
 *
 * Phase 4 boundary: this form is fully validated but deliberately has NO
 * submit action. Values are held in component state only — never written to
 * storage, never posted, never rendered back by the server — because order
 * creation belongs to a later phase. The panel below it says so plainly.
 */
export function CustomerForm() {
  const [values, setValues] = useState<CheckoutFormValues>(EMPTY_CHECKOUT_VALUES);
  const [errors, setErrors] = useState<CheckoutFieldErrors>({});
  const [touched, setTouched] = useState<Record<string, boolean>>({});

  const update = (field: keyof CheckoutFormValues, value: string) => {
    const next = { ...values, [field]: value };
    setValues(next);
    // Re-validate live once a field has been touched, so an error clears the
    // moment the customer fixes it rather than on blur of another field.
    if (touched[field]) validate(next, field);
  };

  const validate = (candidate: CheckoutFormValues, focusField?: keyof CheckoutFormValues) => {
    const result = checkoutFormSchema.safeParse(candidate);
    if (result.success) {
      if (focusField) setErrors((previous) => omit(previous, focusField));
      else setErrors({});
      return true;
    }
    const next = checkoutFieldErrors(result.error);
    setErrors(focusField ? { ...next, [focusField]: next[focusField] } : next);
    return false;
  };

  const blur = (field: keyof CheckoutFormValues) => {
    setTouched((previous) => ({ ...previous, [field]: true }));
    validate(values, field);
  };

  return (
    <form noValidate className="flex flex-col gap-8">
      <FormSection title="Your details" description="So we know who the order is for.">
        <Field
          id="checkout-name"
          label="Full name"
          required
          error={errors.fullName}
        >
          <input
            id="checkout-name"
            name="fullName"
            type="text"
            autoComplete="name"
            required
            value={values.fullName}
            onChange={(event) => update("fullName", event.target.value)}
            onBlur={() => blur("fullName")}
            aria-invalid={errors.fullName ? true : undefined}
            className={inputClass(errors.fullName)}
          />
        </Field>

        <div className="grid gap-5 sm:grid-cols-2">
          <Field
            id="checkout-email"
            label="Email address"
            required
            error={errors.email}
            hint="Order updates would go here in a later release."
          >
            <input
              id="checkout-email"
              name="email"
              type="email"
              autoComplete="email"
              inputMode="email"
              required
              value={values.email}
              onChange={(event) => update("email", event.target.value)}
              onBlur={() => blur("email")}
              aria-invalid={errors.email ? true : undefined}
              className={inputClass(errors.email)}
            />
          </Field>

          <Field
            id="checkout-phone"
            label="Phone number"
            required
            error={errors.phone}
            hint=" Canadian number, for example 416 555 0123."
          >
            <input
              id="checkout-phone"
              name="phone"
              type="tel"
              autoComplete="tel"
              inputMode="tel"
              required
              value={values.phone}
              onChange={(event) => update("phone", event.target.value)}
              onBlur={() => blur("phone")}
              aria-invalid={errors.phone ? true : undefined}
              className={inputClass(errors.phone)}
            />
          </Field>
        </div>
      </FormSection>

      <FulfillmentSection values={values} errors={errors} update={update} blur={blur} />

      <FormSection
        title="Order notes"
        description="Anything the kitchen should know. Allergen questions are best raised before ordering."
      >
        <Field id="checkout-notes" label="Notes" error={errors.notes}>
          <textarea
            id="checkout-notes"
            name="notes"
            rows={3}
            value={values.notes}
            onChange={(event) => update("notes", event.target.value)}
            onBlur={() => blur("notes")}
            aria-invalid={errors.notes ? true : undefined}
            className={cn(inputClass(errors.notes), "min-h-28 resize-y")}
          />
        </Field>
      </FormSection>

      <p className="rounded-2xl bg-cream-100 px-4 py-3 text-sm leading-relaxed text-navy-700">
        Nothing you type on this page is sent or saved yet. Order placement is not available while the
        checkout experience is being prepared.
      </p>
    </form>
  );
}

/* ── fulfilment ─────────────────────────────────────────────────────── */

function FulfillmentSection({
  values,
  errors,
  update,
  blur,
}: {
  values: CheckoutFormValues;
  errors: CheckoutFieldErrors;
  update: (field: keyof CheckoutFormValues, value: string) => void;
  blur: (field: keyof CheckoutFormValues) => void;
}) {
  const groupName = useId();

  return (
    <FormSection
      title="How you would like to receive it"
      description="Delivery and pickup are both being confirmed by the business right now."
    >
      <fieldset>
        <legend className="sr-only">Fulfilment method</legend>
        <div className="grid gap-3 sm:grid-cols-2">
          {(["delivery", "pickup"] as const).map((method) => (
            <MethodOption
              key={method}
              groupName={groupName}
              method={method}
              selected={values.fulfillment === method}
              onSelect={() => update("fulfillment", method)}
            />
          ))}
        </div>
      </fieldset>

      <div className="mt-4 flex items-start gap-2.5 rounded-2xl bg-gold-100 px-4 py-3">
        <Info className="mt-0.5 h-4 w-4 shrink-0 text-gold-700" aria-hidden="true" />
        <p className="text-sm leading-relaxed text-gold-700">
          Service areas, fees and pickup arrangements are still being finalised, so nothing here can be
          ordered yet. Your details stay in this page only.
        </p>
      </div>

      {values.fulfillment === "delivery" ? (
        <div className="mt-6 flex flex-col gap-5" data-testid="delivery-fields">
          <Field
            id="checkout-address1"
            label="Street address"
            required
            error={errors.addressLine1}
          >
            <input
              id="checkout-address1"
              name="addressLine1"
              type="text"
              autoComplete="address-line1"
              required
              value={values.addressLine1}
              onChange={(event) => update("addressLine1", event.target.value)}
              onBlur={() => blur("addressLine1")}
              aria-invalid={errors.addressLine1 ? true : undefined}
              className={inputClass(errors.addressLine1)}
            />
          </Field>

          <Field id="checkout-address2" label="Apartment or unit" error={errors.addressLine2}>
            <input
              id="checkout-address2"
              name="addressLine2"
              type="text"
              autoComplete="address-line2"
              value={values.addressLine2}
              onChange={(event) => update("addressLine2", event.target.value)}
              onBlur={() => blur("addressLine2")}
              className={inputClass(errors.addressLine2)}
            />
          </Field>

          <div className="grid gap-5 sm:grid-cols-2">
            <Field id="checkout-city" label="City or town" required error={errors.city}>
              <input
                id="checkout-city"
                name="city"
                type="text"
                autoComplete="address-level2"
                required
                value={values.city}
                onChange={(event) => update("city", event.target.value)}
                onBlur={() => blur("city")}
                aria-invalid={errors.city ? true : undefined}
                className={inputClass(errors.city)}
              />
            </Field>

            <Field
              id="checkout-province"
              label="Province or territory"
              required
              error={errors.province}
            >
              <select
                id="checkout-province"
                name="province"
                autoComplete="address-level1"
                required
                value={values.province}
                onChange={(event) => update("province", event.target.value)}
                onBlur={() => blur("province")}
                aria-invalid={errors.province ? true : undefined}
                className={inputClass(errors.province)}
              >
                <option value="">Choose one</option>
                {CANADIAN_PROVINCES.map((province) => (
                  <option key={province.code} value={province.code}>
                    {province.name}
                  </option>
                ))}
              </select>
            </Field>
          </div>

          <div className="grid gap-5 sm:grid-cols-2">
            <Field id="checkout-postal" label="Postal code" required error={errors.postalCode}>
              <input
                id="checkout-postal"
                name="postalCode"
                type="text"
                autoComplete="postal-code"
                inputMode="text"
                required
                value={values.postalCode}
                onChange={(event) => update("postalCode", event.target.value)}
                onBlur={() => blur("postalCode")}
                aria-invalid={errors.postalCode ? true : undefined}
                className={cn(inputClass(errors.postalCode), "uppercase")}
              />
            </Field>

            <Field
              id="checkout-instructions"
              label="Delivery instructions"
              error={errors.deliveryInstructions}
              hint="Buzzer, gate code or a safe spot."
            >
              <input
                id="checkout-instructions"
                name="deliveryInstructions"
                type="text"
                value={values.deliveryInstructions}
                onChange={(event) => update("deliveryInstructions", event.target.value)}
                onBlur={() => blur("deliveryInstructions")}
                className={inputClass(errors.deliveryInstructions)}
              />
            </Field>
          </div>
        </div>
      ) : (
        <div className="mt-6 rounded-2xl border border-border bg-cream-100 px-4 py-3" data-testid="pickup-fields">
          <p className="text-sm font-semibold text-navy">Arranged pickup</p>
          <p className="mt-1 text-sm leading-relaxed text-ink-muted">
            A pickup location and collection times have not been confirmed yet, so there is nothing to
            choose here at the moment.
          </p>
        </div>
      )}
    </FormSection>
  );
}

function MethodOption({
  groupName,
  method,
  selected,
  onSelect,
}: {
  groupName: string;
  method: FulfillmentMethod;
  selected: boolean;
  onSelect: () => void;
}) {
  const id = `${groupName}-${method}`;
  const label = method === "delivery" ? "Delivery" : "Pickup";

  return (
    <label
      htmlFor={id}
      className={cn(
        "focus-within:ring-2 focus-within:ring-gold-700 focus-within:ring-offset-2 flex cursor-pointer flex-col gap-2 rounded-2xl border p-4 transition-colors",
        selected ? "border-navy bg-cream-100" : "border-border hover:border-navy/40",
      )}
    >
      <span className="flex items-center gap-3">
        <input
          id={id}
          type="radio"
          name={groupName}
          value={method}
          checked={selected}
          onChange={onSelect}
          className="h-4 w-4 shrink-0 accent-[#1a2530]"
        />
        <span className="text-base font-semibold text-navy">{label}</span>
      </span>
      <Badge tone="gold" className="self-start">
        Not yet confirmed
      </Badge>
    </label>
  );
}

/* ── field primitives ───────────────────────────────────────────────── */

function FormSection({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="flex flex-col gap-5">
      <div>
        <h2 className="font-display text-2xl font-semibold text-navy">{title}</h2>
        {description ? <p className="mt-1.5 text-sm leading-relaxed text-ink-muted">{description}</p> : null}
      </div>
      {children}
    </section>
  );
}

function Field({
  id,
  label,
  required = false,
  error,
  hint,
  children,
}: {
  id: string;
  label: string;
  required?: boolean;
  error?: string;
  hint?: string;
  children: ReactNode;
}) {
  const describedBy =
    [error ? `${id}-error` : null, hint ? `${id}-hint` : null].filter(Boolean).join(" ") || undefined;

  // The control arrives as an element, so its accessibility wiring can be
  // completed here instead of repeated at every call site.
  const control = isValidElement(children)
    ? cloneElement(children as ReactElement<Record<string, unknown>>, {
        "aria-describedby": describedBy,
        ...(error ? { "aria-invalid": true } : null),
      })
    : children;

  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-semibold text-navy">
        {label}
        <span className="ml-1 font-medium text-ink-muted">
          {required ? "(required)" : "(optional)"}
        </span>
      </label>
      {control}
      {hint ? (
        <p id={`${id}-hint`} className="text-xs text-ink-muted">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p
          id={`${id}-error`}
          role="alert"
          className="flex items-start gap-1.5 text-xs font-medium text-terracotta-700"
        >
          <AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          {error}
        </p>
      ) : null}
    </div>
  );
}

function inputClass(error?: string): string {
  return cn(
    "w-full rounded-2xl border bg-surface px-4 py-3 text-base text-navy transition-colors placeholder:text-ink-muted/60 focus-gold",
    error ? "border-terracotta-700" : "border-border hover:border-navy/40",
  );
}

function omit<T extends object, K extends keyof T>(source: T, key: K): Omit<T, K> {
  const clone = { ...source };
  delete clone[key];
  return clone;
}
