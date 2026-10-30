"use server";

import { recordAudit } from "@/lib/auth/audit";
import { requireActionAdmin } from "@/lib/auth/guard";
import { connectDatabase, logDatabaseError } from "@/lib/db/mongoose";
import { StoreConfigModel } from "@/models/store-config";
import {
  percentToBasisPoints,
  storeConfigFormSchema,
  type StoreConfigFormInput,
} from "@/lib/validations/store-config";

/**
 * Store settings server action (Phase 5, Milestone A).
 *
 * Contract, identical to every other admin mutation:
 *   independent session guard → Zod allowlist → business-rule validation →
 *   optimistic concurrency → atomic write → audit → honest feedback.
 *
 * The parsed form is the ONLY thing written: no caller can smuggle an
 * extra field into the configuration document. Nothing here invents
 * business data — every value comes from the owner's own form.
 */

export interface StoreSettingsActionResult {
  ok: boolean;
  error?: string;
  fieldErrors?: Record<string, string>;
  /** True when a concurrent edit was detected (caller should reload). */
  conflict?: boolean;
  /** Fresh concurrency token for the next save. */
  updatedAt?: string;
}

const UNAUTHORIZED: StoreSettingsActionResult = {
  ok: false,
  error: "Your session has expired. Please sign in again.",
};

function parseForm(formData: FormData): { input: StoreConfigFormInput } | { fieldErrors: Record<string, string> } {
  const labels = formData.getAll("areaLabel").map(String);
  const provinces = formData.getAll("areaProvinces").map(String);
  const prefixes = formData.getAll("areaPostcodes").map(String);
  const fees = formData.getAll("areaFee").map(String);

  const parsed = storeConfigFormSchema.safeParse({
    orderIntakeEnabled: formData.get("orderIntakeEnabled") === "on" || formData.get("orderIntakeEnabled") === "true",
    onlinePaymentsEnabled: formData.get("onlinePaymentsEnabled") === "on" || formData.get("onlinePaymentsEnabled") === "true",
    // A checkbox that is unchecked sends no value, so a marker field
    // distinguishes "the owner turned it off" from "this form predates the
    // preference". Absent marker keeps the safe default (enabled).
    notificationsPreparingEnabled:
      formData.get("notificationsPreparingPresent") === "1"
        ? formData.get("notificationsPreparingEnabled") === "on" ||
          formData.get("notificationsPreparingEnabled") === "true"
        : true,
    deliveryEnabled: formData.get("deliveryEnabled") === "on" || formData.get("deliveryEnabled") === "true",
    serviceAreas: labels.map((label, index) => ({
      label,
      provinces: (provinces[index] ?? "")
        .split(",")
        .map((code) => code.trim().toUpperCase())
        .filter(Boolean),
      postalPrefixes: prefixes[index] ?? "",
      fee: fees[index] ?? "",
    })),
    pickupEnabled: formData.get("pickupEnabled") === "on" || formData.get("pickupEnabled") === "true",
    pickupInstructions: formData.get("pickupInstructions") ?? "",
    taxMode: formData.get("taxMode") ?? "unconfigured",
    taxRatePercent: formData.get("taxRatePercent") ?? "",
    taxBase: formData.get("taxBase") ?? "",
    taxLabel: formData.get("taxLabel") ?? "",
    customerNote: formData.get("customerNote") ?? "",
    expectedUpdatedAt: formData.get("expectedUpdatedAt") ?? undefined,
  });

  if (parsed.success) return { input: parsed.data };
  const fieldErrors: Record<string, string> = {};
  for (const issue of parsed.error.issues) {
    fieldErrors[String(issue.path[0] ?? "form")] ??= issue.message;
  }
  return { fieldErrors };
}

function writableFields(input: StoreConfigFormInput) {
  return {
    orderIntakeEnabled: input.orderIntakeEnabled,
    payments: { onlineEnabled: input.onlinePaymentsEnabled },
    notifications: { preparingUpdateEnabled: input.notificationsPreparingEnabled },
    delivery: {
      enabled: input.deliveryEnabled,
      serviceAreas: input.serviceAreas.map((area) => ({
        label: area.label,
        provinces: area.provinces,
        postalPrefixes: area.postalPrefixes,
        feeCents: area.fee,
      })),
    },
    pickup: {
      enabled: input.pickupEnabled,
      instructions: input.pickupInstructions,
    },
    tax: {
      mode: input.taxMode,
      rateBps: input.taxMode === "rate" ? percentToBasisPoints(input.taxRatePercent) : null,
      base: input.taxMode === "rate" ? input.taxBase : null,
      label: input.taxMode === "rate" ? input.taxLabel : null,
    },
    customerNote: input.customerNote,
  };
}

function summarize(input: StoreConfigFormInput): string {
  const parts = [
    `intake ${input.orderIntakeEnabled ? "on" : "off"}`,
    `online payments ${input.onlinePaymentsEnabled ? "on" : "off"}`,
    `preparing email ${input.notificationsPreparingEnabled ? "on" : "off"}`,
    input.deliveryEnabled
      ? `delivery ${input.serviceAreas.length} area${input.serviceAreas.length === 1 ? "" : "s"}`
      : "delivery off",
    input.pickupEnabled ? "pickup on" : "pickup off",
    input.taxMode === "rate"
      ? `tax rate ${input.taxRatePercent}%`
      : input.taxMode === "zero"
        ? "tax zero (owner attested)"
        : "tax unconfigured",
  ];
  return parts.join(", ");
}

export async function saveStoreSettingsAction(
  _previous: StoreSettingsActionResult,
  formData: FormData,
): Promise<StoreSettingsActionResult> {
  const guard = await requireActionAdmin();
  if (!guard.ok) return UNAUTHORIZED;

  const parsed = parseForm(formData);
  if ("fieldErrors" in parsed) return { ok: false, fieldErrors: parsed.fieldErrors };
  const input = parsed.input;
  const fields = writableFields(input);

  try {
    await connectDatabase();

    const existing = await StoreConfigModel.findById("checkout").lean();

    if (existing) {
      const expectedRaw = input.expectedUpdatedAt;
      if (!expectedRaw) return { ok: false, conflict: true };
      const expected = new Date(expectedRaw);
      if (Number.isNaN(expected.getTime()) || existing.updatedAt?.getTime() !== expected.getTime()) {
        return { ok: false, conflict: true };
      }
      const result = await StoreConfigModel.updateOne(
        // Concurrent-edit guard lives in the filter itself.
        { _id: "checkout", updatedAt: existing.updatedAt },
        { $set: fields },
      );
      if (result.matchedCount === 0) return { ok: false, conflict: true };
    } else {
      if (input.expectedUpdatedAt) return { ok: false, conflict: true };
      await StoreConfigModel.create({ _id: "checkout", ...fields });
    }

    await recordAudit({
      event: "store.settings_updated",
      outcome: "success",
      adminId: String(guard.admin._id),
      email: guard.admin.email,
      target: { type: "store", id: "checkout", label: "Checkout settings" },
      detail: summarize(input),
    });

    // Hand the caller a fresh concurrency token so the very next save from
    // this form does not report a spurious conflict.
    const saved = await StoreConfigModel.findById("checkout").select({ updatedAt: 1 }).lean();
    return { ok: true, updatedAt: saved?.updatedAt?.toISOString() };
  } catch (error) {
    logDatabaseError("store-config-save", error);
    if (isDuplicateKey(error)) return { ok: false, conflict: true };
    return { ok: false, error: "Settings could not be saved. Please try again." };
  }
}

function isDuplicateKey(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === 11000
  );
}
