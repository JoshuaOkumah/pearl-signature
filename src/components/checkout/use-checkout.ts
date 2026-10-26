"use client";

import { useCallback, useEffect, useState } from "react";
import { getCheckoutSettingsAction } from "@/lib/actions/checkout";
import {
  checkoutFieldErrors,
  checkoutFormSchema,
  EMPTY_CHECKOUT_VALUES,
  type CheckoutFieldErrors,
  type CheckoutFormValues,
} from "@/lib/validations/checkout";
import type { CheckoutSettings } from "@/lib/validations/store-config";

/**
 * Client-side state for `/checkout` (Phase 5).
 *
 * Two hooks, both lifted to the page so the summary, the price preview and
 * the Place Order action can all read the same state:
 *
 *  - `useCheckoutSettings` fetches the owner's published fulfilment/tax
 *    configuration once, which is what makes a truthful total possible
 *    before submission. A failed fetch is an honest `error` state; nothing
 *    is ever assumed in its place.
 *  - `useCheckoutForm` owns the customer's values, the per-field errors and
 *    the touched set that the Phase 4 form used to keep locally, so the
 *    submit path can run the same Zod validation and surface errors beside
 *    the fields that produced them.
 */

export type CheckoutSettingsStatus = "loading" | "ready" | "error";

export interface CheckoutSettingsState {
  status: CheckoutSettingsStatus;
  settings: CheckoutSettings | null;
}

export function useCheckoutSettings(): CheckoutSettingsState {
  const [state, setState] = useState<CheckoutSettingsState>({ status: "loading", settings: null });

  useEffect(() => {
    let cancelled = false;
    getCheckoutSettingsAction()
      .then((settings) => {
        if (!cancelled) setState({ status: "ready", settings });
      })
      .catch(() => {
        // Network or action failure: report it, never guess a policy.
        if (!cancelled) setState({ status: "error", settings: null });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return state;
}

export interface CheckoutFormController {
  values: CheckoutFormValues;
  errors: CheckoutFieldErrors;
  /** True once a submit attempt has run full-form validation. */
  submitted: boolean;
  update: (field: keyof CheckoutFormValues, value: string) => void;
  blur: (field: keyof CheckoutFormValues) => void;
  /** Validate everything, surface every error, and report validity. */
  validateAll: () => boolean;
}

function omit<T extends object, K extends keyof T>(source: T, key: K): Omit<T, K> {
  const clone = { ...source };
  delete clone[key];
  return clone;
}

export function useCheckoutForm(): CheckoutFormController {
  const [values, setValues] = useState<CheckoutFormValues>(EMPTY_CHECKOUT_VALUES);
  const [errors, setErrors] = useState<CheckoutFieldErrors>({});
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const [submitted, setSubmitted] = useState(false);

  const validate = useCallback(
    (candidate: CheckoutFormValues, focusField?: keyof CheckoutFormValues): boolean => {
      const result = checkoutFormSchema.safeParse(candidate);
      if (result.success) {
        setErrors((previous) => (focusField ? omit(previous, focusField) : {}));
        return true;
      }
      const next = checkoutFieldErrors(result.error);
      setErrors(focusField ? { ...next, [focusField]: next[focusField] } : next);
      return false;
    },
    [],
  );

  const update = useCallback(
    (field: keyof CheckoutFormValues, value: string) => {
      const next = { ...values, [field]: value };
      setValues(next);
      // Re-validate live once the customer has engaged with the field (or
      // already attempted a submit), so an error clears the moment the
      // customer fixes it rather than waiting for another blur.
      if (touched[field] || submitted) validate(next, field);
    },
    [values, touched, submitted, validate],
  );

  const blur = useCallback(
    (field: keyof CheckoutFormValues) => {
      setTouched((previous) => ({ ...previous, [field]: true }));
      validate(values, field);
    },
    [values, validate],
  );

  const validateAll = useCallback((): boolean => {
    setSubmitted(true);
    return validate(values);
  }, [values, validate]);

  return { values, errors, submitted, update, blur, validateAll };
}
