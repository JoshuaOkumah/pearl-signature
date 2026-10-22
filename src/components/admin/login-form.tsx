"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { Eye, EyeOff, Loader2, LockKeyhole } from "lucide-react";
import { loginAction, type LoginState } from "@/lib/actions/auth";
import { Button } from "@/components/ui/button";
import { FormAlert, TextField } from "@/components/admin/field";

const initialState: LoginState = { error: null };

/**
 * Admin sign-in form (Phase 3).
 *
 * All decisions (credentials, rate limiting, session creation) happen in
 * the server action; this component only renders the state it returns.
 * The password field is a masked `<input type="password">` with a
 * visibility toggle; nothing is ever written to localStorage.
 */
export function LoginForm() {
  const [state, formAction, pending] = useActionState(loginAction, initialState);
  const [revealed, setRevealed] = useState(false);

  return (
    <form action={formAction} className="space-y-5" noValidate>
      {state.error ? <FormAlert tone="error">{state.error}</FormAlert> : null}

      <TextField
        id="email"
        name="email"
        type="email"
        label="Email"
        required
        autoComplete="username"
        autoFocus
        placeholder="you@example.com"
        error={state.fieldErrors?.email}
      />

      <div className="relative">
        <TextField
          id="password"
          name="password"
          type={revealed ? "text" : "password"}
          label="Password"
          required
          autoComplete="current-password"
          placeholder="Your password"
          error={state.fieldErrors?.password}
          className="pr-12"
        />
        <button
          type="button"
          onClick={() => setRevealed((value) => !value)}
          aria-pressed={revealed}
          aria-label={revealed ? "Hide password" : "Show password"}
          className="absolute right-2 top-[28px] flex size-9 items-center justify-center rounded-full text-ink-muted transition-colors hover:bg-cream-200 hover:text-navy focus-gold"
        >
          {revealed ? <EyeOff className="size-4.5" /> : <Eye className="size-4.5" />}
        </button>
      </div>

      <input type="hidden" name="next" value="/admin" />

      <Button type="submit" variant="primary" size="lg" className="w-full" disabled={pending}>
        {pending ? (
          <>
            <Loader2 className="size-4 motion-safe:animate-spin" aria-hidden="true" />
            Signing in…
          </>
        ) : (
          <>
            <LockKeyhole className="size-4" aria-hidden="true" />
            Sign in
          </>
        )}
      </Button>

      <p className="text-center font-sans text-[13px] text-ink-muted">
        <Link href="/" className="underline-offset-2 hover:underline focus-gold rounded">
          Back to the storefront
        </Link>
      </p>
    </form>
  );
}
