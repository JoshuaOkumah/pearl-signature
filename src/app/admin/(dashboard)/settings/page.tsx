import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { AlertTriangle, Settings } from "lucide-react";
import { getStoreConfigRecord } from "@/lib/store/config";
import {
  basisPointsToPercent,
  normalizeCheckoutSettings,
} from "@/lib/validations/store-config";
import { formatCadInput } from "@/lib/validations/admin";
import { checkoutBlockers } from "@/lib/checkout/pricing";
import { stripeReadiness } from "@/lib/payments/stripe";
import { emailReadiness } from "@/lib/notifications/config";
import { StoreSettingsForm, type SettingsFormValues } from "@/components/admin/store-settings-form";

export const metadata: Metadata = {
  title: "Settings",
};

/**
 * `/admin/settings` — fulfilment, intake and tax configuration (Phase 5).
 *
 * Every value on this page is an owner decision. The page never suggests a
 * delivery area, a fee, a pickup location or a tax rate: it records what
 * the owner confirms. Until intake, a fulfilment method and the tax
 * treatment are configured, live order submission stays blocked, and the
 * readiness summary below says exactly what is missing.
 */

const BLOCKER_COPY: Record<string, string> = {
  settings_unavailable: "The configuration could not be read from the database.",
  intake_closed: "Order intake is switched off.",
  no_fulfillment_method: "Neither delivery nor pickup is switched on.",
  tax_unconfigured: "The tax treatment has not been confirmed.",
};

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
  const settings = normalizeCheckoutSettings(record);
  const blockers = checkoutBlockers(settings);
  const stripeStatus = stripeReadiness();
  const emailStatus = emailReadiness();

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
      </div>

      <section aria-label="Checkout readiness" className="rounded-2xl border border-border bg-surface p-5">
        <h2 className="flex items-center gap-2 font-sans text-base font-bold text-navy">
          <Settings className="size-4" aria-hidden="true" />
          What customers can do right now
        </h2>
        {blockers.length === 0 ? (
          <p className="mt-2 font-sans text-sm text-leaf-700">
            Checkout is ready: customers can review their basket and place an order.
          </p>
        ) : (
          <ul className="mt-3 flex flex-col gap-1.5">
            {blockers.map((blocker) => (
              <li key={blocker} className="flex items-start gap-2 font-sans text-sm text-ink-muted">
                <AlertTriangle className="mt-0.5 size-4 shrink-0 text-gold-700" aria-hidden="true" />
                {BLOCKER_COPY[blocker] ?? "One more decision is needed before orders can be accepted."}
              </li>
            ))}
          </ul>
        )}
        <p className="mt-3 font-sans text-xs leading-relaxed text-ink-muted">
          Order intake only opens when you switch it on here, and only after delivery or pickup and the
          tax treatment are confirmed.
        </p>
      </section>

      <section aria-label="Stripe readiness" className="rounded-2xl border border-border bg-surface p-5">
        <h2 className="font-sans text-base font-bold text-navy">Stripe readiness</h2>
        {stripeStatus.ready ? (
          <p className="mt-2 font-sans text-sm text-leaf-700">Stripe test-mode configuration is ready. Live payment keys are rejected in this release.</p>
        ) : (
          <p className="mt-2 font-sans text-sm text-ink-muted">
            {stripeStatus.reason === "disabled"
              ? "Stripe is not enabled on this server. The required environment switch is off."
              : stripeStatus.reason === "live_key_rejected"
                ? "A live Stripe key is not accepted in this release. Use test-mode configuration only."
                : stripeStatus.reason === "invalid_site_url"
                  ? "Configure the existing canonical site URL before test Checkout can be initialized."
                  : "Stripe test credentials or the webhook secret are not configured. Online payment remains unavailable."}
          </p>
        )}
        <p className="mt-2 font-sans text-xs text-ink-muted">
          Environment variable names are documented in .env.example; secret values are never shown
          here.
        </p>
      </section>

      <section aria-label="Email readiness" className="rounded-2xl border border-border bg-surface p-5">
        <h2 className="font-sans text-base font-bold text-navy">Email notifications</h2>
        {emailStatus.configured ? (
          <p className="mt-2 font-sans text-sm text-leaf-700">
            Transactional email is configured and ready to attempt a send.
          </p>
        ) : (
          <p className="mt-2 font-sans text-sm text-ink-muted">
            Email delivery is not configured on this server. Orders, payments and tracking keep working, and
            notification events stay queued without being reported as sent.
          </p>
        )}
        <p className="mt-2 font-sans text-xs text-ink-muted">
          Readiness, queue counts and failed notifications are on the notifications page. Secret values are never
          shown.
        </p>
        <Link
          href="/admin/notifications"
          className="mt-3 inline-flex rounded-lg font-sans text-sm font-semibold text-navy underline underline-offset-2 focus-gold"
        >
          Open notification settings
        </Link>
      </section>

      <StoreSettingsForm initial={values} />
    </div>
  );
}
