"use client";

import { useRef, useState, type ReactNode } from "react";

/**
 * Two-step confirmation submit (Phase 3).
 *
 * Used for significant actions (archive, image removal): the first press
 * ARMS the control (label changes, danger styling, screen readers are
 * told via aria-live), the second press submits. Moving focus away
 * disarms, so a stray click can never fire the action. No modal needed,
 * works identically on touch and keyboard.
 */
export function ConfirmSubmit({
  action,
  fields,
  buttonLabel,
  confirmLabel,
  tone = "danger",
  className,
  children,
}: {
  action: (formData: FormData) => void | Promise<void>;
  fields: Record<string, string>;
  buttonLabel: string;
  confirmLabel: string;
  tone?: "danger" | "neutral";
  className?: string;
  children?: ReactNode;
}) {
  const [armed, setArmed] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);

  return (
    <form
      ref={formRef}
      action={action}
      onBlur={(event) => {
        if (!formRef.current?.contains(event.relatedTarget as Node)) setArmed(false);
      }}
    >
      {Object.entries(fields).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}
      <button
        type="submit"
        onClick={(event) => {
          if (!armed) {
            event.preventDefault();
            setArmed(true);
          }
        }}
        className={
          className ??
          (armed
            ? tone === "danger"
              ? "inline-flex min-h-9 items-center gap-1.5 rounded-full bg-terracotta-700 px-4 font-sans text-xs font-bold text-cream transition-colors hover:bg-terracotta-800 focus-gold"
              : "inline-flex min-h-9 items-center gap-1.5 rounded-full bg-navy px-4 font-sans text-xs font-bold text-cream transition-colors hover:bg-navy-800 focus-gold"
            : "inline-flex min-h-9 items-center gap-1.5 rounded-full border border-navy/25 px-4 font-sans text-xs font-bold text-navy transition-colors hover:border-navy hover:bg-navy hover:text-cream focus-gold")
        }
      >
        {children}
        {armed ? confirmLabel : buttonLabel}
      </button>
      <span aria-live="polite" className="sr-only">
        {armed ? `${confirmLabel} Press again to confirm.` : ""}
      </span>
    </form>
  );
}
