import { describe, expect, it } from "vitest";
import { paymentStatusAfterExpiry, paymentStatusAfterFailure, refundStatus } from "./state";

describe("payment state monotonicity", () => {
  it("does not allow older failure or expiry events to undo settlement", () => {
    for (const state of ["paid", "partially_refunded", "refunded"] as const) {
      expect(paymentStatusAfterFailure(state)).toBe(state);
      expect(paymentStatusAfterExpiry(state)).toBe(state);
    }
  });

  it("distinguishes failure, expiry, partial refund and full refund", () => {
    expect(paymentStatusAfterFailure("processing")).toBe("failed");
    expect(paymentStatusAfterExpiry("awaiting_payment")).toBe("expired");
    expect(refundStatus(4_938, 1_000)).toBe("partially_refunded");
    expect(refundStatus(4_938, 4_938)).toBe("refunded");
    expect(refundStatus(4_938, 5_000)).toBe("review_required");
  });
});
