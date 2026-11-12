import { describe, expect, it } from "vitest";
import type { CheckoutSettings } from "@/lib/validations/store-config";
import { orderingCopy, UNKNOWN_ORDERING_COPY } from "./ordering-copy";

function settings(overrides: Partial<CheckoutSettings> = {}): CheckoutSettings {
  return {
    available: true,
    intakeEnabled: true,
    deliveryEnabled: false,
    serviceAreas: [],
    pickupEnabled: true,
    pickupInstructions: "Collect from the kitchen at the agreed time.",
    tax: { mode: "zero", rateBps: null, base: null, label: null },
    customerNote: null,
    onlinePaymentsEnabled: false,
    onlinePaymentsAvailable: false,
    ...overrides,
  };
}

describe("orderingCopy", () => {
  it("describes a pickup-only store honestly", () => {
    const copy = orderingCopy(settings());

    expect(copy.canOrder).toBe(true);
    expect(copy.statusBadge).toBe("Ordering now open");
    expect(copy.fulfilmentFact).toBe("Arranged pickup");
    expect(copy.fulfilmentStepTitle).toBe("Prearranged pickup");
    expect(copy.paymentFact).toBe("Cash on arrival");
    expect(copy.faqDelivery).toContain("Delivery is not available at the moment");
    expect(copy.faqOpening).toContain("Online ordering is open");
  });

  it("advertises both fulfilment methods when both are enabled", () => {
    const copy = orderingCopy(settings({ deliveryEnabled: true, pickupEnabled: true }));

    expect(copy.fulfilmentFact).toBe("Delivery or arranged pickup");
    expect(copy.fulfilmentStepTitle).toBe("Delivery or pickup");
    expect(copy.faqDelivery).toContain("home delivery and prearranged pickup");
  });

  it("advertises delivery only when delivery is the only method", () => {
    const copy = orderingCopy(settings({ deliveryEnabled: true, pickupEnabled: false }));

    expect(copy.fulfilmentFact).toBe("Home delivery");
    expect(copy.fulfilmentStepTitle).toBe("Home delivery");
    expect(copy.faqDelivery).toContain("home delivery");
  });

  it("keeps ordering closed when intake is off", () => {
    const copy = orderingCopy(settings({ intakeEnabled: false }));

    expect(copy.canOrder).toBe(false);
    expect(copy.statusBadge).toBe("Ordering opens soon");
    expect(copy.faqOpening).toContain("not open right now");
  });

  it("keeps ordering closed when tax is unconfigured", () => {
    const copy = orderingCopy(
      settings({ tax: { mode: "unconfigured", rateBps: null, base: null, label: null } }),
    );

    expect(copy.canOrder).toBe(false);
    expect(copy.statusBadge).toBe("Ordering opens soon");
  });

  it("keeps ordering closed when no fulfilment method exists", () => {
    const copy = orderingCopy(settings({ pickupEnabled: false }));

    expect(copy.canOrder).toBe(false);
    expect(copy.statusBadge).toBe("Ordering opens soon");
    expect(copy.fulfilmentFact).toBe("Fulfilment details at checkout");
  });

  it("only mentions online payment when it is genuinely available", () => {
    const offline = orderingCopy(settings());
    expect(offline.paymentFact).toBe("Cash on arrival");
    expect(offline.faqPayment).toContain("not available at the moment");

    const online = orderingCopy(settings({ onlinePaymentsEnabled: true, onlinePaymentsAvailable: true }));
    expect(online.paymentFact).toBe("Online or cash payment");
    expect(online.faqPayment).toContain("secure online payment");
  });

  it("falls back to the neutral copy when the configuration cannot be read", () => {
    const copy = orderingCopy(settings({ available: false }));

    expect(copy).toEqual(UNKNOWN_ORDERING_COPY);
    expect(copy.canOrder).toBe(false);
    expect(copy.statusBadge).toBe("Browse the full menu");
  });

  it("never claims ordering is closed once checkout can complete", () => {
    const copy = orderingCopy(settings({ deliveryEnabled: true }));

    expect(copy.canOrder).toBe(true);
    expect(copy.statusBadge).not.toContain("opens soon");
    expect(copy.faqOpening).not.toContain("not open");
  });
});
