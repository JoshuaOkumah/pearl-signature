import type { CheckoutFormValues } from "@/lib/validations/checkout";
import type { PaymentMethod } from "@/lib/validations/order";

/**
 * Checkout-attempt identity and guest confirmation capabilities (Phase 5).
 *
 * Runs ONLY in the browser. Two small pieces of local state make duplicate
 * prevention work end to end:
 *
 * 1. **The attempt** (`localStorage`, survives tab crashes and restarts):
 *    an unpredictable 32-byte idempotency key plus the confirmation
 *    capability, recorded against a signature of the order INTENT (items +
 *    customer details). Retrying the same intent — double-click, refresh,
 *    timeout retry, a second tab — reuses the same keys, so the server's
 *    unique index collapses them into one order. A DIFFERENT intent
 *    (different basket or details) generates fresh keys, so a later,
 *    separate order is never mistaken for a conflicting retry.
 *
 * 2. **Confirmations** (`sessionStorage`, capped): the reference-to-
 *    capability pairing the confirmation page needs to authorise its read.
 *    sessionStorage keeps the pairing on this device only, so a shared or
 *    leaked URL (`?ref=...` with no capability) cannot open anyone's order
 *    details. The documented limitation: the pairing dies with the tab, so
 *    the confirmation is readable from the browser session that placed the
 *    order (and survives refresh).
 *
 * All storage access is best-effort: a browser with storage disabled still
 * gets a working in-memory attempt for this visit.
 */

const ATTEMPT_KEY = "pearl-checkout-attempt-v1";
const CONFIRMATIONS_KEY = "pearl-confirmations-v1";
const MAX_CONFIRMATIONS = 10;

export interface CheckoutAttempt {
  idempotencyKey: string;
  confirmationKey: string;
  signature: string;
}

/** `bytes` random bytes as lowercase hex, using the platform CSPRNG. */
function randomHex(bytes: number): string {
  const buffer = new Uint8Array(bytes);
  const cryptoApi = globalThis.crypto;
  if (cryptoApi && typeof cryptoApi.getRandomValues === "function") {
    cryptoApi.getRandomValues(buffer);
  } else {
    // Non-secure fallback (jsdom or an exotic browser). The keys still must
    // be syntactically valid; the server-side checks are what actually
    // enforce the security properties.
    for (let index = 0; index < bytes; index++) {
      buffer[index] = Math.floor(Math.random() * 256);
    }
  }
  let hex = "";
  for (const byte of buffer) hex += byte.toString(16).padStart(2, "0");
  return hex;
}

/**
 * Canonical signature of the order intent. Two tabs that typed the same
 * basket and the same customer details compute the same string, and
 * therefore share one idempotency key.
 */
export function checkoutSignature(
  items: ReadonlyArray<{ slug: string; variantName: string | null; quantity: number }>,
  customer: CheckoutFormValues,
  paymentMethod: PaymentMethod = "cash_on_arrival",
): string {
  const lines = items
    .map((item) => [item.slug, item.variantName ?? "", String(item.quantity)] as const)
    .sort((a, b) => `${a[0]}|${a[1]}`.localeCompare(`${b[0]}|${b[1]}`));
  return JSON.stringify([
    lines,
    [
      customer.fullName.trim(),
      customer.email.trim().toLowerCase(),
      customer.phone.trim(),
      customer.fulfillment,
      customer.addressLine1.trim(),
      customer.addressLine2.trim(),
      customer.city.trim(),
      customer.province.trim(),
      customer.postalCode.trim(),
      customer.deliveryInstructions.trim(),
      customer.notes.trim(),
    ],
    paymentMethod,
  ]);
}

function createAttempt(signature: string): CheckoutAttempt {
  return {
    idempotencyKey: randomHex(32),
    confirmationKey: randomHex(32),
    signature,
  };
}

function readAttempt(): CheckoutAttempt | null {
  try {
    const raw = window.localStorage.getItem(ATTEMPT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<CheckoutAttempt>;
    if (
      typeof parsed?.idempotencyKey !== "string" ||
      typeof parsed?.confirmationKey !== "string" ||
      typeof parsed?.signature !== "string"
    ) {
      return null;
    }
    return {
      idempotencyKey: parsed.idempotencyKey,
      confirmationKey: parsed.confirmationKey,
      signature: parsed.signature,
    };
  } catch {
    return null;
  }
}

function writeAttempt(attempt: CheckoutAttempt): void {
  try {
    window.localStorage.setItem(ATTEMPT_KEY, JSON.stringify(attempt));
  } catch {
    // Storage unavailable: the attempt still works for this visit.
  }
}

/**
 * The attempt for this intent: reuse the stored keys when the intent is
 * unchanged (so retries deduplicate), otherwise start a fresh attempt.
 */
export function attemptFor(signature: string): CheckoutAttempt {
  const existing = readAttempt();
  if (existing && existing.signature === signature) return existing;
  const fresh = createAttempt(signature);
  writeAttempt(fresh);
  return fresh;
}

/**
 * Force a fresh attempt. Used exactly once, when the server reports that
 * the stored key was REUSED WITH A DIFFERENT INTENT (a conflict), so the
 * customer can still place their order.
 */
export function freshAttempt(signature: string): CheckoutAttempt {
  const attempt = createAttempt(signature);
  writeAttempt(attempt);
  return attempt;
}

/** Burn the attempt after a successful order so the next order is new. */
export function clearAttempt(): void {
  try {
    window.localStorage.removeItem(ATTEMPT_KEY);
  } catch {
    // Nothing to clean up.
  }
}

/* ── confirmation capabilities ──────────────────────────────────────── */

interface StoredConfirmation {
  reference: string;
  key: string;
  at: number;
}

function readConfirmations(): StoredConfirmation[] {
  try {
    const raw = window.sessionStorage.getItem(CONFIRMATIONS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (entry): entry is StoredConfirmation =>
        typeof entry === "object" &&
        entry !== null &&
        typeof (entry as StoredConfirmation).reference === "string" &&
        typeof (entry as StoredConfirmation).key === "string",
    );
  } catch {
    return [];
  }
}

/** Remember the pairing the confirmation page needs (this tab only). */
export function saveConfirmation(reference: string, key: string): void {
  try {
    const next = [
      { reference, key, at: Date.now() },
      ...readConfirmations().filter((entry) => entry.reference !== reference),
    ].slice(0, MAX_CONFIRMATIONS);
    window.sessionStorage.setItem(CONFIRMATIONS_KEY, JSON.stringify(next));
  } catch {
    // Storage unavailable: the confirmation page will say so honestly.
  }
}

/** The capability for this reference on this device, or null. */
export function confirmationKeyFor(reference: string): string | null {
  const match = readConfirmations().find((entry) => entry.reference === reference);
  return match?.key ?? null;
}
