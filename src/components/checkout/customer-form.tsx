"use client";

import { useId, type ReactElement, type ReactNode, cloneElement, isValidElement } from "react";
import { AlertTriangle, MapPin, Truck } from "lucide-react";
import {
  CANADIAN_PROVINCES,
  normalizePostalCode,
  type CheckoutFieldErrors,
  type CheckoutFormValues,
  type FulfillmentMethod,
} from "@/lib/validations/checkout";
import type { CheckoutSettings } from "@/lib/validations/store-config";
import { matchServiceArea } from "@/lib/checkout/pricing";
import { formatCad } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import type { CheckoutSettingsState } from "./use-checkout";

/**
 * Customer and fulfilment form for `/checkout` (Phase 5, controlled).
 *
 * The form holds no state of its own: values, errors and the update/blur
 * handlers are lifted to the page so the Place Order action can validate
 * the same fields it displays. What the form DOES own is presentation of
 * the owner's configuration:
 *
 *  - a fulfilment method the owner has not enabled is shown disabled with an
 *    honest badge, never offered as a choice that would later be refused;
 *  - pickup shows the owner's own instructions when configured, and says so
 *    plainly when they are not;
 *  - delivery validates the address against the configured service areas
 *    live, so an unsupported address is visible BEFORE submission.
 */

interface CustomerFormProps {
  values: CheckoutFormValues;
  errors: CheckoutFieldErrors;
  settingsState: CheckoutSettingsState;
  update: (field: keyof CheckoutFormValues, value: string) => void;
  blur: (field: keyof CheckoutFormValues) => void;
}

export function CustomerForm({ values, errors, settingsState, update, blur }: CustomerFormProps) {
  return (
    <form noValidate className="flex flex-col gap-8">
      <FormSection title="Your details" description="So we know who the order is for.">
        <Field id="checkout-name" label="Full name" required error={errors.fullName}>
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
            hint="So the store can reach you about this order."
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
            hint="A Canadian number, for example 416 555 0123."
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

      <FulfillmentSection values={values} errors={errors} settingsState={settingsState} update={update} blur={blur} />

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
    </form>
  );
}

/* ── fulfilment ─────────────────────────────────────────────────────── */

function FulfillmentSection({
  values,
  errors,
  settingsState,
  update,
  blur,
}: {
  values: CheckoutFormValues;
  errors: CheckoutFieldErrors;
  settingsState: CheckoutSettingsState;
  update: (field: keyof CheckoutFormValues, value: string) => void;
  blur: (field: keyof CheckoutFormValues) => void;
}) {
  const groupName = useId();
  const { status, settings } = settingsState;

  const offered = (method: FulfillmentMethod): boolean =>
    status === "ready" &&
    (method === "delivery" ? settings?.deliveryEnabled === true : settings?.pickupEnabled === true);

  const showDeliveryFields = values.fulfillment === "delivery" && offered("delivery");

  return (
    <FormSection
      title="How you would like to receive it"
      description="Choose the option the store currently offers. Unavailable options cannot be selected."
    >
      <fieldset>
        <legend className="sr-only">Fulfilment method</legend>
        <div className="grid gap-3 sm:grid-cols-2">
          {(["delivery", "pickup"] as const).map((method) => (
            <MethodOption
              key={method}
              groupName={groupName}
              method={method}
              selected={values.fulfillment === method && offered(method)}
              disabled={!offered(method)}
              status={status}
              onSelect={() => update("fulfillment", method)}
            />
          ))}
        </div>
      </fieldset>

      {showDeliveryFields ? (
        <div className="mt-6 flex flex-col gap-5" data-testid="delivery-fields">
          <Field id="checkout-address1" label="Street address" required error={errors.addressLine1}>
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

          <DeliveryAreaHint values={values} settings={settings} />
        </div>
      ) : null}

      {values.fulfillment === "pickup" && offered("pickup") ? (
        <div
          className="mt-6 rounded-2xl border border-border bg-cream-100 px-4 py-3"
          data-testid="pickup-fields"
        >
          <p className="flex items-center gap-2 text-sm font-semibold text-navy">
            <MapPin className="h-4 w-4 shrink-0 text-gold-700" aria-hidden="true" />
            Arranged pickup
          </p>
          <p className="mt-1 text-sm leading-relaxed text-navy-700">
            {settings?.pickupInstructions ??
              "Pickup details are not available right now. Please check again shortly."}
          </p>
        </div>
      ) : null}
    </FormSection>
  );
}

/**
 * Live service-area feedback for the address being typed. Shows the matched
 * area and its fee when the address is inside one, and says so plainly when
 * it is not — before the customer ever reaches the Place Order button.
 */
function DeliveryAreaHint({
  values,
  settings,
}: {
  values: CheckoutFormValues;
  settings: CheckoutSettings | null;
}) {
  const postal = normalizePostalCode(values.postalCode);

  if (!values.province || !postal) {
    return (
      <p className="flex items-start gap-2 text-sm text-ink-muted">
        <Truck className="mt-0.5 h-4 w-4 shrink-0 text-ink-muted" aria-hidden="true" />
        Enter your province and postal code to check whether this address is served.
      </p>
    );
  }

  const area = matchServiceArea({ province: values.province, postalCode: postal }, settings?.serviceAreas ?? []);

  if (!area) {
    return (
      <p
        role="alert"
        className="flex items-start gap-2 text-sm font-medium text-terracotta-700"
        data-testid="area-unsupported"
      >
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
        This address is outside the delivery areas the store currently serves, so it cannot be
        delivered to.
      </p>
    );
  }

  return (
    <p className="flex items-start gap-2 text-sm text-leaf-700" data-testid="area-supported">
      <MapPin className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
      In the {area.label} delivery area. Delivery fee {formatCad(area.feeCents) ?? "to be confirmed"}.
    </p>
  );
}

function MethodOption({
  groupName,
  method,
  selected,
  disabled,
  status,
  onSelect,
}: {
  groupName: string;
  method: FulfillmentMethod;
  selected: boolean;
  disabled: boolean;
  status: CheckoutSettingsState["status"];
  onSelect: () => void;
}) {
  const id = `${groupName}-${method}`;
  const label = method === "delivery" ? "Delivery" : "Pickup";
  const badge =
    status === "loading"
      ? { tone: "neutral" as const, text: "Checking availability" }
      : status === "error"
        ? { tone: "terracotta" as const, text: "Unavailable right now" }
        : disabled
          ? { tone: "neutral" as const, text: "Not available" }
          : { tone: "leaf" as const, text: "Available" };

  return (
    <label
      htmlFor={id}
      className={cn(
        "focus-within:ring-2 focus-within:ring-gold-700 focus-within:ring-offset-2 flex flex-col gap-2 rounded-2xl border p-4 transition-colors",
        disabled
          ? "cursor-not-allowed border-border bg-cream-100/60 opacity-80"
          : selected
            ? "cursor-pointer border-navy bg-cream-100"
            : "cursor-pointer border-border hover:border-navy/40",
      )}
    >
      <span className="flex items-center gap-3">
        <input
          id={id}
          type="radio"
          name={groupName}
          value={method}
          checked={selected}
          disabled={disabled}
          onChange={onSelect}
          className="h-4 w-4 shrink-0 accent-[#1a2530]"
        />
        <span className="text-base font-semibold text-navy">{label}</span>
      </span>
      <Badge tone={badge.tone} className="self-start">
        {badge.text}
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
  children: ReactNode;
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
