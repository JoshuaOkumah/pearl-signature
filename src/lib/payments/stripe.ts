import "server-only";
import Stripe from "stripe";
import { siteUrl } from "@/lib/site-url";

/**
 * Payment readiness is intentionally stricter than key presence. Phase 6
 * accepts Stripe test credentials only, requires an explicit server switch,
 * a webhook secret and the already-established canonical site URL. Live keys
 * are rejected rather than treated as a future-ready configuration.
 */
export interface StripeReadiness {
  ready: boolean;
  reason: "ready" | "disabled" | "missing_configuration" | "live_key_rejected" | "invalid_site_url";
}

export function stripeReadiness(env: NodeJS.ProcessEnv = process.env): StripeReadiness {
  if (env.STRIPE_PAYMENTS_ENABLED?.trim() !== "true") {
    return { ready: false, reason: "disabled" };
  }
  const secret = env.STRIPE_SECRET_KEY?.trim() ?? "";
  if (secret.startsWith("sk_live_")) return { ready: false, reason: "live_key_rejected" };
  if (!secret.startsWith("sk_test_") || !env.STRIPE_WEBHOOK_SECRET?.trim()?.startsWith("whsec_")) {
    return { ready: false, reason: "missing_configuration" };
  }
  const origin = siteUrlFrom(env.NEXT_PUBLIC_SITE_URL);
  if (!origin) return { ready: false, reason: "invalid_site_url" };
  return { ready: true, reason: "ready" };
}

function siteUrlFrom(raw: string | undefined): string | null {
  if (!raw?.trim()) return null;
  try {
    const url = new URL(raw.trim());
    if (url.protocol === "https:") return url.origin;
    if (url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname)) return url.origin;
    return null;
  } catch {
    return null;
  }
}

export function stripeAppUrl(path: string): string | null {
  const origin = siteUrl();
  if (!origin) return null;
  try {
    const url = new URL(origin);
    if (url.protocol !== "https:" && !(url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname))) {
      return null;
    }
    return new URL(path, url.origin).toString();
  } catch {
    return null;
  }
}

let stripe: Stripe | null = null;

export function stripeClient(): Stripe {
  if (!stripeReadiness().ready) throw new Error("Stripe payment provider is not ready");
  const secret = process.env.STRIPE_SECRET_KEY!.trim();
  if (!stripe) {
    stripe = new Stripe(secret, {
      maxNetworkRetries: 2,
      timeout: 10_000,
    });
  }
  return stripe;
}

/** Test-only reset. No secret values are returned or logged. */
export function resetStripeClientForTests(): void {
  stripe = null;
}
