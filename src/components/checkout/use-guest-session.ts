"use client";

import { useCallback, useEffect, useState } from "react";
import { getGuestSessionStateAction } from "@/lib/actions/guest-verification";
import type { GuestSessionState } from "@/lib/validations/guest";

/**
 * Remembered-device state for the checkout UI (Phase 7B).
 *
 * The server is the only authority: this hook merely asks whether a live,
 * unexpired session exists and whether its verification is recent enough for a
 * new order. Nothing here can grant access by itself; `placeOrderAction`
 * re-reads the HttpOnly cookie and re-checks freshness on every submission.
 */

export type GuestSessionStatus = "loading" | "ready" | "error";

export interface GuestSessionController {
  status: GuestSessionStatus;
  session: GuestSessionState | null;
  refresh: () => Promise<void>;
}

const UNKNOWN: GuestSessionState = {
  authenticated: false,
  email: null,
  verifiedAtIso: null,
  sessionExpiresAtIso: null,
  checkoutFresh: false,
  verificationAvailable: false,
};

export function useGuestSession(): GuestSessionController {
  const [status, setStatus] = useState<GuestSessionStatus>("loading");
  const [session, setSession] = useState<GuestSessionState | null>(null);

  const refresh = useCallback(async (): Promise<void> => {
    try {
      const next = await getGuestSessionStateAction();
      setSession(next);
      setStatus("ready");
    } catch {
      // A failed read is an honest error, never an assumed session.
      setSession(UNKNOWN);
      setStatus("error");
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    getGuestSessionStateAction()
      .then((next) => {
        if (cancelled) return;
        setSession(next);
        setStatus("ready");
      })
      .catch(() => {
        if (cancelled) return;
        setSession(UNKNOWN);
        setStatus("error");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return { status, session, refresh };
}
