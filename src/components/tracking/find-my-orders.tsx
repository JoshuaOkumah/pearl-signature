"use client";

import Link from "next/link";
import { useState } from "react";
import { AlertCircle, Loader2, Mail, ShieldCheck } from "lucide-react";
import {
  requestRecoveryCodeAction,
  verifyRecoveryCodeAction,
} from "@/lib/actions/guest-verification";
import { Button } from "@/components/ui/button";

/**
 * Email-only order recovery, also called "Find my orders" (Phase 7B).
 *
 * The customer supplies an email address and nothing else: no reference, no
 * account, no password. Before verification the response is deliberately
 * generic, so this form can never be used to learn whether an address has
 * orders. A code is issued for any valid address, which means a customer with
 * no history still verifies successfully and reaches an honest empty state.
 *
 * On success the server rotates the remembered-device cookie to the verified
 * address; `onVerified` then lets the caller reload the authorised history.
 * The raw code is held only in this component's state for the single check.
 */

export interface FindMyOrdersProps {
  /** Called after the server confirms the code and rotates the session. */
  onVerified: () => void | Promise<void>;
  /** Optional heading override, e.g. on the dedicated My Orders page. */
  heading?: string;
}

const SIX_DIGITS = /^\d{6}$/;

export function FindMyOrders({ onVerified, heading }: FindMyOrdersProps) {
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [phase, setPhase] = useState<"email" | "code">("email");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function requestCode(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (pending) return;
    setError(null);
    setNotice(null);
    setPending(true);
    try {
      const response = await requestRecoveryCodeAction({ email });
      if (response.ok) {
        setPhase("code");
        setCode("");
        // Generic on purpose: it never confirms that orders exist.
        setNotice(
          "If that address can receive email, a six digit code is on its way. It expires after ten minutes.",
        );
        return;
      }
      switch (response.reason) {
        case "invalid":
          setError("Enter a valid email address.");
          break;
        case "rate_limited":
          setError("Too many requests from this connection. Please wait a little while and try again.");
          break;
        case "unavailable":
          setError(
            "Email verification is temporarily unavailable, so we cannot send a code right now. If you placed an order, it is safe and can still be opened from the device that placed it.",
          );
          break;
        default:
          setError("We could not send a code right now. Please try again shortly.");
      }
    } catch {
      setError("We could not send a code right now. Please try again shortly.");
    } finally {
      setPending(false);
    }
  }

  async function verifyCode(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (pending || !SIX_DIGITS.test(code)) return;
    setError(null);
    setPending(true);
    try {
      const response = await verifyRecoveryCodeAction({ email, code });
      if (response.ok) {
        setNotice(null);
        setCode("");
        await onVerified();
        return;
      }
      switch (response.reason) {
        case "expired":
          setError("That code has expired. Request a new code to continue.");
          break;
        case "attempts":
          setError("That code has been used too many times. Request a new code to continue.");
          break;
        case "rate_limited":
          setError("Too many attempts from this connection. Please wait a little while and try again.");
          break;
        case "unavailable":
          setError("Email verification is temporarily unavailable right now. Please try again shortly.");
          break;
        default:
          setError("That code is incorrect. Check the email and try again.");
      }
    } catch {
      setError("We could not check that code right now. Please try again shortly.");
    } finally {
      setPending(false);
    }
  }

  return (
    <section
      aria-labelledby="find-my-orders-heading"
      data-testid="find-my-orders"
      className="rounded-3xl border border-border bg-surface p-6 shadow-card sm:p-8"
    >
      <h2
        id="find-my-orders-heading"
        className="flex items-center gap-2 font-display text-2xl font-semibold text-navy"
      >
        <Mail className="h-5 w-5 shrink-0 text-gold-700" aria-hidden="true" />
        {heading ?? "Find my orders"}
      </h2>
      <p className="mt-2 max-w-xl font-sans text-sm leading-relaxed text-ink-muted">
        Enter the email address you used when ordering. We send a six digit code to confirm it, then show
        every order placed with that address on this device.
      </p>

      {phase === "email" ? (
        <form onSubmit={requestCode} className="mt-6 grid max-w-md gap-4">
          <label className="grid gap-1.5">
            <span className="font-sans text-sm font-semibold text-navy">Email address</span>
            <input
              name="email"
              type="email"
              value={email}
              onChange={(event) => {
                setEmail(event.target.value);
                setError(null);
              }}
              required
              autoComplete="email"
              inputMode="email"
              autoCapitalize="none"
              spellCheck={false}
              placeholder="you@example.com"
              className="focus-gold min-h-11 rounded-xl border border-border bg-cream-100 px-3 font-sans text-base text-navy"
            />
          </label>
          <div>
            <Button type="submit" disabled={pending}>
              {pending ? <Loader2 className="h-4 w-4 motion-safe:animate-spin" aria-hidden="true" /> : null}
              {pending ? "Sending code" : "Email me a code"}
            </Button>
          </div>
        </form>
      ) : (
        <form onSubmit={verifyCode} className="mt-6 grid max-w-md gap-4">
          <p className="font-sans text-sm text-ink-muted">
            Code sent to <strong className="font-semibold text-navy">{email}</strong>
          </p>
          <label className="grid gap-1.5">
            <span className="font-sans text-sm font-semibold text-navy">Six digit code</span>
            <input
              name="code"
              value={code}
              onChange={(event) => {
                setCode(event.target.value.replace(/\D/g, "").slice(0, 6));
                setError(null);
              }}
              required
              pattern="\d{6}"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              placeholder="123456"
              className="focus-gold min-h-12 w-full max-w-[13rem] rounded-xl border border-border bg-cream-100 px-3 text-center font-sans text-2xl font-bold tracking-[0.3em] text-navy tabular-nums"
            />
          </label>
          <div className="flex flex-wrap gap-3">
            <Button type="submit" disabled={pending || !SIX_DIGITS.test(code)}>
              {pending ? <Loader2 className="h-4 w-4 motion-safe:animate-spin" aria-hidden="true" /> : null}
              {pending ? "Checking" : "Show my orders"}
            </Button>
            <Button
              type="button"
              variant="ghost"
              disabled={pending}
              onClick={() => {
                setPhase("email");
                setCode("");
                setError(null);
                setNotice(null);
              }}
            >
              Use a different email
            </Button>
          </div>
        </form>
      )}

      <div aria-live="polite" className="mt-4 grid gap-2">
        {notice ? (
          <p className="flex items-start gap-2 font-sans text-sm leading-relaxed text-ink-muted">
            <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-leaf-700" aria-hidden="true" />
            {notice}
          </p>
        ) : null}
        {error ? (
          <p role="alert" className="flex items-start gap-2 font-sans text-sm leading-relaxed text-terracotta-700">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            {error}
          </p>
        ) : null}
      </div>

      <p className="mt-5 border-t border-border pt-4 font-sans text-xs leading-relaxed text-ink-muted">
        Lost access to that email address?{" "}
        <Link href="/contact" className="focus-gold rounded font-semibold text-navy underline underline-offset-2">
          Contact the kitchen
        </Link>{" "}
        and the owner can help verify the order another way. We never use a phone number or a reference alone
        to open an order.
      </p>
    </section>
  );
}
