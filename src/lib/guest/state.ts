import "server-only";
import type { GuestSessionState } from "@/lib/validations/guest";
import { isCheckoutVerificationFresh } from "./policy";
import { guestVerificationReadiness } from "./readiness";
import { getGuestIdentity } from "./session";

/**
 * Read the current remembered-device state (Phase 7B).
 *
 * A plain server function rather than a Server Action so a Server Component can
 * await it during render. It only READS cookies: writing them is reserved for
 * Server Actions, which is why every mutation lives in
 * `src/lib/actions/guest-verification.ts`.
 *
 * The returned email is the caller's own verified address and nothing else.
 * `checkoutFresh` says whether a NEW order can be placed without another code;
 * it never implies that order history is still open, which every read re-checks
 * against a live, unrevoked, unexpired session.
 */
export async function readGuestSessionState(now = Date.now()): Promise<GuestSessionState> {
  const readiness = guestVerificationReadiness();
  const identity = await getGuestIdentity(now);

  if (!identity) {
    return {
      authenticated: false,
      email: null,
      verifiedAtIso: null,
      sessionExpiresAtIso: null,
      checkoutFresh: false,
      verificationAvailable: readiness.ready,
    };
  }

  return {
    authenticated: true,
    email: identity.email,
    verifiedAtIso: identity.verifiedAt.toISOString(),
    sessionExpiresAtIso: identity.expiresAt.toISOString(),
    checkoutFresh: isCheckoutVerificationFresh(identity, now),
    verificationAvailable: readiness.ready,
  };
}
