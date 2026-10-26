import type { PaymentStatus } from "@/lib/validations/order";

/** A provider failure can never erase a previously verified settlement. */
export function paymentStatusAfterFailure(current: PaymentStatus): PaymentStatus {
  if (current === "paid" || current === "partially_refunded" || current === "refunded") return current;
  if (current === "review_required") return current;
  return "failed";
}

export function paymentStatusAfterExpiry(current: PaymentStatus): PaymentStatus {
  if (current === "paid" || current === "partially_refunded" || current === "refunded") return current;
  if (current === "review_required") return current;
  return "expired";
}

export function refundStatus(receivedCents: number, refundedCents: number): PaymentStatus {
  if (!Number.isInteger(receivedCents) || !Number.isInteger(refundedCents) || receivedCents <= 0 || refundedCents <= 0) {
    return "review_required";
  }
  if (refundedCents > receivedCents) return "review_required";
  if (refundedCents >= receivedCents) return "refunded";
  return "partially_refunded";
}
