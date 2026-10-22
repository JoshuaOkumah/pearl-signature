import type {
  InputHTMLAttributes,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
} from "react";
import { cn } from "@/lib/utils";

/**
 * Admin form field primitives (Phase 3).
 *
 * Presentational only (no state): usable inside client form components
 * while staying testable. Every control follows the PEARL design system
 * tokens (cream surfaces, navy text, gold focus ring via `focus-gold`)
 * and exposes proper label/error wiring (`aria-invalid`,
 * `aria-describedby`) for screen readers and keyboard users.
 */

const controlClasses =
  "w-full rounded-lg border border-navy/20 bg-surface px-3.5 py-2.5 font-sans text-[15px] text-navy placeholder:text-ink-muted/70 transition-colors focus-gold hover:border-navy/35";

const errorTextClasses = "mt-1.5 font-sans text-[13px] font-medium text-terracotta-700";

function FieldShell({
  id,
  label,
  required,
  error,
  hint,
  children,
}: {
  id: string;
  label: string;
  required?: boolean;
  error?: string | undefined;
  hint?: string | undefined;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label htmlFor={id} className="mb-1.5 block font-sans text-sm font-semibold text-navy">
        {label}
        {required ? (
          <>
            <span aria-hidden="true" className="ml-0.5 text-terracotta-700">
              *
            </span>
            <span className="sr-only"> (required)</span>
          </>
        ) : null}
      </label>
      {children}
      {hint && !error ? (
        <p className="mt-1.5 font-sans text-[13px] text-ink-muted">{hint}</p>
      ) : null}
      {error ? (
        <p id={`${id}-error`} role="alert" className={errorTextClasses}>
          {error}
        </p>
      ) : null}
    </div>
  );
}

type TextFieldProps = InputHTMLAttributes<HTMLInputElement> & {
  id: string;
  label: string;
  required?: boolean;
  error?: string | undefined;
  hint?: string | undefined;
};

export function TextField({
  id,
  label,
  required,
  error,
  hint,
  className,
  ...inputProps
}: TextFieldProps) {
  return (
    <FieldShell id={id} label={label} required={required} error={error} hint={hint}>
      <input
        id={id}
        required={required}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-error` : undefined}
        className={cn(controlClasses, error && "border-terracotta-700/60", className)}
        {...inputProps}
      />
    </FieldShell>
  );
}

type TextAreaFieldProps = TextareaHTMLAttributes<HTMLTextAreaElement> & {
  id: string;
  label: string;
  required?: boolean;
  error?: string | undefined;
  hint?: string | undefined;
};

export function TextAreaField({
  id,
  label,
  required,
  error,
  hint,
  className,
  ...textareaProps
}: TextAreaFieldProps) {
  return (
    <FieldShell id={id} label={label} required={required} error={error} hint={hint}>
      <textarea
        id={id}
        required={required}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-error` : undefined}
        className={cn(controlClasses, "min-h-28 resize-y", error && "border-terracotta-700/60", className)}
        {...textareaProps}
      />
    </FieldShell>
  );
}

type SelectFieldProps = SelectHTMLAttributes<HTMLSelectElement> & {
  id: string;
  label: string;
  required?: boolean;
  error?: string | undefined;
  hint?: string | undefined;
  children: React.ReactNode;
};

export function SelectField({
  id,
  label,
  required,
  error,
  hint,
  className,
  children,
  ...selectProps
}: SelectFieldProps) {
  return (
    <FieldShell id={id} label={label} required={required} error={error} hint={hint}>
      <select
        id={id}
        required={required}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-error` : undefined}
        className={cn(controlClasses, "appearance-none pr-9", error && "border-terracotta-700/60", className)}
        {...selectProps}
      >
        {children}
      </select>
    </FieldShell>
  );
}

/** Checkbox with a large touch target and inline label. */
export function CheckboxField({
  id,
  label,
  hint,
  ...inputProps
}: InputHTMLAttributes<HTMLInputElement> & { id: string; label: string; hint?: string }) {
  return (
    <div className="flex items-start gap-3">
      <input
        id={id}
        type="checkbox"
        className="mt-0.5 size-5 shrink-0 rounded border-navy/30 accent-[#1a2530] focus-gold"
        {...inputProps}
      />
      <div>
        <label htmlFor={id} className="font-sans text-sm font-semibold text-navy">
          {label}
        </label>
        {hint ? <p className="mt-0.5 font-sans text-[13px] text-ink-muted">{hint}</p> : null}
      </div>
    </div>
  );
}

/** Inline alert used for form-level errors and confirmations. */
export function FormAlert({
  tone,
  children,
}: {
  tone: "error" | "success" | "info";
  children: React.ReactNode;
}) {
  const tones = {
    error: "border-terracotta-700/40 bg-terracotta-700/10 text-navy-900",
    success: "border-leaf/40 bg-leaf/10 text-navy-900",
    info: "border-navy/15 bg-cream-200 text-navy",
  } as const;
  return (
    <div
      role={tone === "error" ? "alert" : "status"}
      className={cn("rounded-lg border px-4 py-3 font-sans text-sm", tones[tone])}
    >
      {children}
    </div>
  );
}
