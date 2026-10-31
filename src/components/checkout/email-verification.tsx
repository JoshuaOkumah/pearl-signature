"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { AlertCircle, CheckCircle2, Loader2, Mail, ShieldCheck } from "lucide-react";
import {
  requestCheckoutCodeAction,
  verifyCheckoutCodeAction,
} from "@/lib/actions/guest-verification";
import { maskEmail, normalizeEmail } from "@/lib/guest/policy";
import { guestEmailSchema } from "@/lib/validations/guest";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

/**
 * Mandatory checkout email verification (Phase 7B).
 *
 * The customer proves control of the address with a six-digit code before any
 * order can be placed. The code is never stored in this component beyond the
 * single submission: success is reported by the server, and the server also
 * sets the remembered-device cookie, so no reusable secret ever reaches client
 * JavaScript.
 *
 * Accessibility: one labelled input with `inputMode="numeric"` and
 * `autoComplete="one-time-code"`, a polite live region for status and an alert
 * for failures. Paste works because it is a normal text input, not six fragile
 * boxes.
 */

const SIX_DIGITS = /^\d{6}$/;

export interface EmailVerificationProps {
  /** The address currently typed in the checkout form. */
  email: string;
  /** True once this checkout has a fresh proof for `email`. */
  verified: boolean;
  /** False when codes cannot be delivered at all (honest unavailability). */
  available: boolean;
  /** The address the server actually verified, when known. */
  verifiedEmail: string | null;
  disabled?: boolean;
  onVerified: (email: string) => void;
  onReset: () => void;
}

type Phase = "idle" | "sending" | "sent" | "verifying";

function secondsUntil(target: number, now: number): number {
  return Math.max(0, Math.ceil((target - now) / 1_000));
}

export function EmailVerification({
  email,
  verified,
  available,
  verifiedEmail,
  disabled = false,
  onVerified,
  onReset,
}: EmailVerificationProps) {
  const codeId = useId();
  const errorId = useId();
  const normalized = normalizeEmail(email);
  const emailValid = guestEmailSchema.safeParse(email).success;

  const [phase, setPhase] = useState<Phase>("idle");
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [cooldownUntil, setCooldownUntil] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  const inputRef = useRef<HTMLInputElement>(null);

  // A change of address invalidates any code we were about to submit.
  const lastAddress = useRef(normalized);
  useEffect(() => {
    if (lastAddress.current === normalized) return;
    lastAddress.current = normalized;
    setPhase("idle");
    setCode("");
    setError(null);
    setNotice(null);
    setSentTo(null);
  }, [normalized]);

  // Cooldown countdown. One interval, cleared as soon as it reaches zero.
  useEffect(() => {
    if (cooldownUntil <= Date.now()) return;
    const timer = window.setInterval(() => {
      const current = Date.now();
      setNow(current);
      if (current >= cooldownUntil) window.clearInterval(timer);
    }, 1_000);
    return () => window.clearInterval(timer);
  }, [cooldownUntil]);

  const remaining = secondsUntil(cooldownUntil, now);
  const canSend = available && emailValid && !disabled && phase !== "sending" && remaining === 0;

  const send = useCallback(async (): Promise<void> => {
    if (!canSend) return;
    setError(null);
    setNotice(null);
    setPhase("sending");
    try {
      const response = await requestCheckoutCodeAction({ email: normalized });
      if (response.ok) {
        setSentTo(normalized);
        setPhase("sent");
        setCooldownUntil(Date.now() + 60_000);
        setNow(Date.now());
        setNotice(`We sent a six digit code to ${normalized}. It expires in ten minutes.`);
        window.setTimeout(() => inputRef.current?.focus(), 0);
        return;
      }
      setPhase(sentTo ? "sent" : "idle");
      switch (response.reason) {
        case "invalid":
          setError("Enter a valid email address before requesting a code.");
          break;
        case "cooldown":
          setCooldownUntil(Date.now() + (response.retryAfterSeconds ?? 60) * 1_000);
          setNotice("A code was sent recently. You can request another in a moment.");
          break;
        case "rate_limited":
          setError("Too many code requests from this connection. Please wait a little while and try again.");
          break;
        default:
          setError(
            "We could not send a verification code right now. Your basket is saved. Please try again shortly.",
          );
      }
    } catch {
      setPhase(sentTo ? "sent" : "idle");
      setError("We could not send a verification code right now. Please try again shortly.");
    }
  }, [canSend, normalized, sentTo]);

  const verify = useCallback(async (): Promise<void> => {
    if (!SIX_DIGITS.test(code) || disabled || phase === "verifying") return;
    setError(null);
    setPhase("verifying");
    try {
      const response = await verifyCheckoutCodeAction({ email: normalized, code });
      if (response.ok) {
        setNotice(null);
        setCode("");
        setPhase("idle");
        setCooldownUntil(0);
        onVerified(response.email);
        return;
      }
      setPhase("sent");
      switch (response.reason) {
        case "expired":
          setError("Your verification code has expired. Request a new code to continue.");
          break;
        case "attempts":
          setError("That code has been used too many times. Request a new code to continue.");
          break;
        case "rate_limited":
          setError("Too many attempts from this connection. Please wait a little while and try again.");
          break;
        case "unavailable":
          setError("Email verification is temporarily unavailable. Your basket is saved. Please try again shortly.");
          break;
        default:
          setError("That code is incorrect. Please try again.");
      }
    } catch {
      setPhase("sent");
      setError("We could not check that code right now. Please try again shortly.");
    }
  }, [code, disabled, normalized, onVerified, phase]);

  if (verified) {
    return (
      <section
        aria-labelledby="verify-email-heading"
        className="mt-8 rounded-2xl border border-leaf-700/30 bg-leaf-100 p-4"
        data-testid="email-verified"
      >
        <h3
          id="verify-email-heading"
          className="flex items-center gap-2 font-display text-lg font-semibold text-navy"
        >
          <CheckCircle2 className="h-5 w-5 shrink-0 text-leaf-700" aria-hidden="true" />
          Email verified
        </h3>
        <p className="mt-1.5 text-sm leading-relaxed text-navy-700">
          {verifiedEmail ? (
            <>
              This order will be placed with <strong className="font-semibold">{maskEmail(verifiedEmail)}</strong>.
            </>
          ) : (
            "This order will be placed with the verified email address."
          )}{" "}
          You can change the address, but a new code will be required.
        </p>
        <Button type="button" variant="ghost" size="sm" className="mt-2" onClick={onReset} disabled={disabled}>
          Use a different email
        </Button>
      </section>
    );
  }

  if (!available) {
    return (
      <section
        aria-labelledby="verify-email-heading"
        className="mt-8 rounded-2xl border border-dashed border-navy/25 bg-cream-100 p-4"
        data-testid="verification-unavailable"
      >
        <h3
          id="verify-email-heading"
          className="flex items-center gap-2 font-display text-lg font-semibold text-navy"
        >
          <ShieldCheck className="h-5 w-5 shrink-0 text-gold-700" aria-hidden="true" />
          Email verification is unavailable
        </h3>
        <p className="mt-1.5 text-sm leading-relaxed text-ink-muted">
          We cannot send verification codes right now, so new orders are paused. Your basket and
          details are saved. If you already have an order, you can still open My Orders.
        </p>
      </section>
    );
  }

  const showCodeEntry = phase === "sent" || phase === "verifying" || sentTo !== null;
  const headingId = "verify-email-heading";

  return (
    <section
      aria-labelledby={headingId}
      className="mt-8 rounded-2xl border border-border bg-surface p-4 shadow-card sm:p-5"
      data-testid="email-verification"
    >
      <h3 id={headingId} className="flex items-center gap-2 font-display text-lg font-semibold text-navy">
        <Mail className="h-5 w-5 shrink-0 text-gold-700" aria-hidden="true" />
        Verify your email
      </h3>
      <p className="mt-1.5 text-sm leading-relaxed text-ink-muted">
        We email a six digit code to confirm this address. It keeps your order updates and order
        history private to you.
      </p>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <span className="rounded-full bg-cream-100 px-3 py-1 text-xs font-semibold text-navy-700">
          {normalized ? normalized : "Add your email address above"}
        </span>
        {!emailValid && normalized ? (
          <span className="text-xs font-medium text-terracotta-700">Enter a valid email address</span>
        ) : null}
      </div>

      {!showCodeEntry ? (
        <div className="mt-4">
          <Button type="button" variant="outline" onClick={() => void send()} disabled={!canSend}>
            {phase === "sending" ? (
              <>
                <Loader2 className="h-4 w-4 motion-safe:animate-spin" aria-hidden="true" />
                Sending code
              </>
            ) : (
              "Send verification code"
            )}
          </Button>
          <p className="mt-2 text-xs leading-relaxed text-ink-muted">
            Check your inbox and the spam folder. The code expires after ten minutes.
          </p>
        </div>
      ) : (
        <form
          className="mt-4"
          onSubmit={(event) => {
            event.preventDefault();
            void verify();
          }}
        >
          <label htmlFor={codeId} className="text-sm font-semibold text-navy">
            Six digit code
          </label>
          <div className="mt-1.5 flex flex-col gap-2 sm:flex-row">
            <input
              ref={inputRef}
              id={codeId}
              name="verification-code"
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9]*"
              maxLength={6}
              value={code}
              onChange={(event) => {
                setCode(event.target.value.replace(/\D/g, "").slice(0, 6));
                setError(null);
              }}
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? errorId : undefined}
              placeholder="123456"
              className={cn(
                "focus-gold w-full rounded-xl border border-border bg-cream-100 px-4 py-2.5 text-center font-sans text-lg tracking-[0.4em] text-navy tabular-nums sm:max-w-[12rem]",
                error && "border-terracotta-700",
              )}
              disabled={disabled || phase === "verifying"}
            />
            <Button
              type="submit"
              variant="primary"
              disabled={!SIX_DIGITS.test(code) || disabled || phase === "verifying"}
            >
              {phase === "verifying" ? (
                <>
                  <Loader2 className="h-4 w-4 motion-safe:animate-spin" aria-hidden="true" />
                  Checking
                </>
              ) : (
                "Verify email"
              )}
            </Button>
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs">
            <button
              type="button"
              className="focus-gold rounded font-semibold text-navy-700 underline underline-offset-4 hover:text-navy disabled:cursor-not-allowed disabled:opacity-60"
              onClick={() => void send()}
              disabled={!canSend}
            >
              {remaining > 0 ? `Resend code in ${remaining}s` : "Resend code"}
            </button>
            <button
              type="button"
              className="focus-gold rounded font-semibold text-navy-700 underline underline-offset-4 hover:text-navy"
              onClick={() => {
                setPhase("idle");
                setCode("");
                setError(null);
                setNotice(null);
                setSentTo(null);
                document.getElementById("checkout-email")?.focus();
              }}
            >
              Change email
            </button>
          </div>
        </form>
      )}

      {notice ? (
        <p role="status" aria-live="polite" className="mt-3 text-xs leading-relaxed text-leaf-700">
          {notice}
        </p>
      ) : null}

      {error ? (
        <p
          id={errorId}
          role="alert"
          className="mt-3 flex items-start gap-2 rounded-xl bg-terracotta-100 px-3 py-2 text-sm font-medium text-terracotta-700"
        >
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          {error}
        </p>
      ) : null}
    </section>
  );
}
