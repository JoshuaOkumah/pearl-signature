import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { AlertTriangle } from "lucide-react";
import { getStoreConfigRecord } from "@/lib/store/config";
import { basisPointsToPercent } from "@/lib/validations/store-config";
import { formatCadInput } from "@/lib/validations/admin";
import { StoreSettingsForm, type SettingsFormValues } from "@/components/admin/store-settings-form";

export const metadata: Metadata = {
  title: "Settings",
};

/**
 * `/admin/settings` — fulfilment, intake and tax configuration (Phase 5).
 *
 * Every value on this page is an owner decision. The page never suggests a
 * delivery area, a fee, a pickup location or a tax rate: it records what
 * the owner confirms.
 *
 * Server readiness (whether checkout can open, card payments, email) moved
 * to `/admin/system` in the Phase 8 admin refresh: those are facts about
 * the deployment, not choices, and mixing them in made the page look like
 * settings that were missing.
 */

function emptyValues(): SettingsFormValues {
  return {
    orderIntakeEnabled: false,
    onlinePaymentsEnabled: false,
    notificationsPreparingEnabled: true,
    deliveryEnabled: false,
    serviceAreas: [],
    pickupEnabled: false,
    pickupInstructions: "",
    taxMode: "unconfigured",
    taxRatePercent: "",
    taxBase: "",
    taxLabel: "",
    customerNote: "",
    expectedUpdatedAt: null,
  };
}

export default async function StoreSettingsPage() {
  // Always request-rendered: this reads live database state, so no
  // prerender or prefetch pass may execute it.
  await connection();

  const result = await getStoreConfigRecord();

  if ("error" in result) {
    return (
      <div className="space-y-4">
        <h1 className="font-serif text-3xl font-semibold text-navy">Settings</h1>
        <div className="rounded-2xl border border-terracotta-700/40 bg-terracotta-700/10 p-6">
          <div className="flex items-start gap-3">
            <AlertTriangle className="mt-0.5 size-5 shrink-0 text-terracotta-700" aria-hidden="true" />
            <div>
              <h2 className="font-sans text-base font-bold text-navy">Settings are unavailable right now</h2>
              <p className="mt-1 font-sans text-sm text-ink-muted">
                Check the database connection and reload this page. No changes were made.
              </p>
              <Link
                href="/admin/settings"
                className="mt-3 inline-flex rounded-lg font-sans text-sm font-semibold text-navy underline underline-offset-2 focus-gold"
              >
                Try again
              </Link>
            </div>
          </div>
        </div>
      </div>
    );
  }

  const record = result.record;

  const values: SettingsFormValues = {
    ...emptyValues(),
    orderIntakeEnabled: record.orderIntakeEnabled === true,
    onlinePaymentsEnabled: record.payments?.onlineEnabled === true,
    notificationsPreparingEnabled: record.notifications?.preparingUpdateEnabled !== false,
    deliveryEnabled: record.delivery?.enabled === true,
    serviceAreas: (record.delivery?.serviceAreas ?? []).map((area) => ({
      label: area.label,
      provinces: [...area.provinces],
      postalPrefixes: area.postalPrefixes.join(", "),
      fee: area.feeCents === 0 ? "0" : formatCadInput(area.feeCents),
    })),
    pickupEnabled: record.pickup?.enabled === true,
    pickupInstructions: record.pickup?.instructions ?? "",
    taxMode: record.tax?.mode ?? "unconfigured",
    taxRatePercent: basisPointsToPercent(record.tax?.rateBps ?? null),
    taxBase: record.tax?.base ?? "",
    taxLabel: record.tax?.label ?? "",
    customerNote: record.customerNote ?? "",
    expectedUpdatedAt: result.updatedAt,
  };

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-serif text-3xl font-semibold text-navy">Settings</h1>
          <p className="mt-1 font-sans text-sm text-ink-muted">
            Decide how orders are fulfilled and priced. Nothing here is assumed for you.
          </p>
        </div>
        <Link
          href="/admin/system"
          className="rounded font-sans text-sm font-semibold text-navy underline underline-offset-2 focus-gold"
        >
          Check what is working
        </Link>
      </div>

      <StoreSettingsForm initial={values} />
    </div>
  );
}
