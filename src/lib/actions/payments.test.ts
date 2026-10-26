import { beforeEach, describe, expect, it, vi } from "vitest";

const requireActionAdmin = vi.fn();
const recordAudit = vi.fn();
const reconcileStripeOrder = vi.fn();

vi.mock("@/lib/auth/guard", () => ({ requireActionAdmin: (...args: unknown[]) => requireActionAdmin(...args) }));
vi.mock("@/lib/auth/audit", () => ({ recordAudit: (...args: unknown[]) => recordAudit(...args) }));
vi.mock("@/lib/payments/reconcile", () => ({ reconcileStripeOrder: (...args: unknown[]) => reconcileStripeOrder(...args) }));

import { reconcilePaymentAction } from "./payments";

function form(reference = "PS-1A2B3C4D5E", apply = "false"): FormData {
  const value = new FormData();
  value.set("reference", reference);
  value.set("apply", apply);
  return value;
}

beforeEach(() => {
  vi.clearAllMocks();
  requireActionAdmin.mockResolvedValue({ ok: true, admin: { _id: "admin-id", email: "owner@example.test" } });
  recordAudit.mockResolvedValue(undefined);
  reconcileStripeOrder.mockResolvedValue({
    reference: "PS-1A2B3C4D5E",
    mode: "dry_run",
    result: "matched",
    summary: "Provider amount and currency match the saved order snapshot.",
    checkedAttempts: 1,
    providerPaidCents: 4_938,
    providerRefundedCents: 0,
  });
});

describe("reconcilePaymentAction", () => {
  it("requires a fresh admin session on every dry-run request", async () => {
    requireActionAdmin.mockResolvedValueOnce({ ok: false, reason: "unauthorized" });
    const result = await reconcilePaymentAction({ ok: false }, form());
    expect(result).toEqual({ ok: false, error: "Your session has expired. Please sign in again." });
    expect(reconcileStripeOrder).not.toHaveBeenCalled();
  });

  it("defaults to provider read-only mode and accepts only a valid order reference", async () => {
    const result = await reconcilePaymentAction({ ok: false }, form());
    expect(result).toMatchObject({ ok: true, report: { mode: "dry_run", result: "matched" } });
    expect(reconcileStripeOrder).toHaveBeenCalledWith("PS-1A2B3C4D5E", false);
    expect(recordAudit).not.toHaveBeenCalled();

    const invalid = await reconcilePaymentAction({ ok: false }, form("not-an-order"));
    expect(invalid.ok).toBe(false);
    expect(reconcileStripeOrder).toHaveBeenCalledTimes(1);
  });

  it("audits deliberate apply requests without accepting caller-supplied financial values", async () => {
    reconcileStripeOrder.mockResolvedValueOnce({
      reference: "PS-1A2B3C4D5E",
      mode: "applied",
      result: "matched",
      summary: "Provider amount and currency match the saved order snapshot.",
      checkedAttempts: 1,
      providerPaidCents: 4_938,
      providerRefundedCents: 0,
    });
    const payload = form("PS-1A2B3C4D5E", "true");
    payload.set("amountCents", "1");
    payload.set("paymentStatus", "paid");
    const result = await reconcilePaymentAction({ ok: false }, payload);
    expect(result).toMatchObject({ ok: true, report: { mode: "applied" } });
    expect(reconcileStripeOrder).toHaveBeenCalledWith("PS-1A2B3C4D5E", true);
    expect(recordAudit).toHaveBeenCalledWith(expect.objectContaining({
      event: "payment.reconciled",
      outcome: "success",
      target: { type: "order", id: "PS-1A2B3C4D5E", label: "PS-1A2B3C4D5E" },
    }));
  });
});
