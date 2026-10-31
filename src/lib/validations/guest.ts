import { z } from "zod";
import type { FulfillmentMethod } from "@/lib/validations/checkout";
import type { CheckoutSettings } from "@/lib/validations/store-config";
import type { OrderStatus, PaymentMethod, PaymentStatus } from "@/lib/validations/order";

/**
 * Guest verification and order-history contract (Phase 7B).
 *
 * Isomorphic and free of mongoose, so the browser renders exactly the shapes
 * the Server Actions return. No type here carries a session token, a raw code
 * or a full email address for another identity.
 */

/**
 * Checkout settings plus the ONE server-only fact the checkout UI needs: whether
 * a verification code can actually be delivered. Kept separate from
 * `CheckoutSettings` so the owner-configuration contract stays pure.
 */
export type CheckoutSettingsWithVerification = CheckoutSettings & {
  emailVerificationAvailable: boolean;
};

/** Canonical email input: trim and lower case, then ordinary validation. */
export const guestEmailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .email("Enter a valid email address")
  .max(254, "Email address is too long");

export const guestCodeSchema = z
  .string()
  .trim()
  .regex(/^\d{6}$/, "Enter the six digit code");

export const requestCodeSchema = z.object({ email: guestEmailSchema });

export const verifyCodeSchema = z.object({
  email: guestEmailSchema,
  code: guestCodeSchema,
});

export type RequestCodeResponse =
  | { ok: true }
  | {
      ok: false;
      reason: "invalid" | "rate_limited" | "unavailable" | "cooldown";
      retryAfterSeconds?: number;
    };

export type VerifyCodeResponse =
  | {
      ok: true;
      email: string;
      verifiedAtIso: string;
      sessionExpiresAtIso: string;
    }
  | {
      ok: false;
      reason: "invalid" | "expired" | "attempts" | "rate_limited" | "unavailable";
    };

export interface GuestSessionState {
  authenticated: boolean;
  /** The remembered identity's own address; never another user's. */
  email: string | null;
  verifiedAtIso: string | null;
  sessionExpiresAtIso: string | null;
  /** True when the verification is recent enough for a NEW order. */
  checkoutFresh: boolean;
  /** False when OTP delivery or its secret is not configured. */
  verificationAvailable: boolean;
}

export interface MyOrderSummary {
  reference: string;
  status: OrderStatus;
  placedAtIso: string;
  itemsSummary: string;
  itemCount: number;
  paymentMethod: PaymentMethod;
  paymentStatus: PaymentStatus;
  totalCents: number;
  fulfillmentMethod: FulfillmentMethod;
}

export interface MyOrdersPage {
  emailMasked: string;
  page: number;
  pageSize: number;
  hasMore: boolean;
  counts: {
    active: number;
    completed: number;
    cancelled: number;
    total: number;
  };
  orders: MyOrderSummary[];
}

export type MyOrdersResponse =
  | { ok: true; data: MyOrdersPage }
  | { ok: false; reason: "unauthenticated" | "rate_limited" | "unavailable" };

export const myOrdersRequestSchema = z.object({
  page: z.coerce.number().int().min(1).max(100).default(1),
});

export type MyOrdersRequest = z.output<typeof myOrdersRequestSchema>;
