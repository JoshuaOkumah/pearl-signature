import { describe, expect, it } from "vitest";
import {
  CANADIAN_PROVINCES,
  checkoutFieldErrors,
  checkoutFormSchema,
  normalizeCanadianPhone,
  normalizePostalCode,
  EMPTY_CHECKOUT_VALUES,
  type CheckoutFormValues,
} from "./checkout";

/** A complete, valid delivery order — each test overrides one field. */
function deliveryValues(overrides: Partial<CheckoutFormValues> = {}): CheckoutFormValues {
  return {
    ...EMPTY_CHECKOUT_VALUES,
    fullName: "Ada Okonkwo",
    email: "Ada.Okonkwo@Example.com",
    phone: "416 555 0123",
    fulfillment: "delivery",
    addressLine1: "123 Queen Street W",
    city: "Toronto",
    province: "ON",
    postalCode: "M5H 2N2",
    ...overrides,
  };
}

function pickupValues(overrides: Partial<CheckoutFormValues> = {}): CheckoutFormValues {
  return { ...deliveryValues({ fulfillment: "pickup" }), ...overrides };
}

/* ── phone ──────────────────────────────────────────────────────────── */

describe("normalizeCanadianPhone", () => {
  it("accepts the usual written forms and normalises them", () => {
    expect(normalizeCanadianPhone("4165550123")).toBe("+14165550123");
    expect(normalizeCanadianPhone("416 555 0123")).toBe("+14165550123");
    expect(normalizeCanadianPhone("(416) 555-0123")).toBe("+14165550123");
    expect(normalizeCanadianPhone("416.555.0123")).toBe("+14165550123");
    expect(normalizeCanadianPhone("1-416-555-0123")).toBe("+14165550123");
    expect(normalizeCanadianPhone("+1 416 555 0123")).toBe("+14165550123");
    expect(normalizeCanadianPhone("  4165550123  ")).toBe("+14165550123");
  });

  it("rejects anything that is not a plausible NANP number", () => {
    for (const raw of [
      "",
      "416",
      "416555",
      "41655501234567",
      "0000000000",
      "call me",
      "+44 20 7946 0958",
      "416-555-012a",
      "+1234567890",
    ]) {
      expect(normalizeCanadianPhone(raw), `expected "${raw}" to be rejected`).toBeNull();
    }
  });

  it("treats an 11-digit number as valid only when it starts with 1", () => {
    expect(normalizeCanadianPhone("24165550123")).toBeNull();
  });
});

/* ── postal code ────────────────────────────────────────────────────── */

describe("normalizePostalCode", () => {
  it("normalises to upper case with one space", () => {
    expect(normalizePostalCode("m5h2n2")).toBe("M5H 2N2");
    expect(normalizePostalCode("m5h 2n2")).toBe("M5H 2N2");
    expect(normalizePostalCode("M5H-2N2")).toBe("M5H 2N2");
    expect(normalizePostalCode("  K1A0B1 ")).toBe("K1A 0B1");
  });

  it("rejects malformed and impossible codes", () => {
    // D, F, I, O, Q, U are never used in Canadian postal codes.
    for (const raw of ["", "M5H2N", "M5H2N22", "D5H 2N2", "M5I 2N2", "123456", "K1A 0B!", "m5h2n"]) {
      expect(normalizePostalCode(raw), `expected "${raw}" to be rejected`).toBeNull();
    }
  });
});

/* ── province list ──────────────────────────────────────────────────── */

describe("CANADIAN_PROVINCES", () => {
  it("covers every province and territory exactly once", () => {
    expect(CANADIAN_PROVINCES).toHaveLength(13);
    const codes = CANADIAN_PROVINCES.map((province) => province.code);
    expect(new Set(codes).size).toBe(13);
    expect(codes).toEqual([...codes].sort());
  });
});

/* ── full form ──────────────────────────────────────────────────────── */

describe("checkoutFormSchema: happy paths", () => {
  it("accepts a complete delivery order and normalises its fields", () => {
    const parsed = checkoutFormSchema.parse(deliveryValues());

    expect(parsed.email).toBe("ada.okonkwo@example.com");
    expect(parsed.phone).toBe("+14165550123");
    expect(parsed.postalCode).toBe("M5H 2N2");
  });

  it("accepts a pickup order with every address field left blank", () => {
    const parsed = checkoutFormSchema.parse(
      pickupValues({ addressLine1: "", addressLine2: "", city: "", province: "", postalCode: "" }),
    );

    expect(parsed.fulfillment).toBe("pickup");
    expect(parsed.addressLine1).toBeNull();
    expect(parsed.city).toBeNull();
  });

  it("accepts every listed province and territory for delivery", () => {
    for (const province of CANADIAN_PROVINCES) {
      const parsed = checkoutFormSchema.safeParse(
        deliveryValues({ province: province.code, postalCode: "K1A 0B1" }),
      );
      expect(parsed.success, `expected ${province.code} to be accepted`).toBe(true);
    }
  });
});

describe("checkoutFormSchema: required fields", () => {
  it("requires a name, a valid email and a phone number regardless of fulfilment", () => {
    for (const values of [deliveryValues(), pickupValues()]) {
      expect(checkoutFormSchema.safeParse({ ...values, fullName: "  " }).success).toBe(false);
      expect(checkoutFormSchema.safeParse({ ...values, email: "not-an-email" }).success).toBe(false);
      expect(checkoutFormSchema.safeParse({ ...values, phone: "12345" }).success).toBe(false);
    }
  });

  it("requires the address only when delivery is chosen", () => {
    const missingAddress = deliveryValues({ addressLine1: "", city: "", province: "", postalCode: "" });
    const result = checkoutFormSchema.safeParse(missingAddress);
    expect(result.success).toBe(false);

    // The very same blanks are fine for pickup.
    expect(checkoutFormSchema.safeParse(pickupValues({ addressLine1: "", city: "", province: "", postalCode: "" })).success).toBe(true);
  });

  it("rejects an unknown fulfilment method", () => {
    // A tampered value must not slip through as a third option.
    const result = checkoutFormSchema.safeParse({
      ...deliveryValues(),
      fulfillment: "drone",
    });
    expect(result.success).toBe(false);
  });

  it("rejects an over-long note or name", () => {
    expect(checkoutFormSchema.safeParse(deliveryValues({ fullName: "x".repeat(121) })).success).toBe(false);
    expect(checkoutFormSchema.safeParse(deliveryValues({ notes: "x".repeat(601) })).success).toBe(false);
    expect(checkoutFormSchema.safeParse(deliveryValues({ deliveryInstructions: "x".repeat(401) })).success).toBe(false);
  });

  it("accepts real-world punctuation in names rather than rejecting customers", () => {
    for (const fullName of ["Anne-Marie O'Brien", "José Ángel Núñez", "Chidi Okonkwo-Smith Jr.", "李 明"]) {
      expect(checkoutFormSchema.safeParse(deliveryValues({ fullName })).success, fullName).toBe(true);
    }
  });
});

/* ── error mapping ──────────────────────────────────────────────────── */

describe("checkoutFieldErrors", () => {
  it("maps each problem to the field the form renders", () => {
    const result = checkoutFormSchema.safeParse(
      deliveryValues({ fullName: "", email: "nope", phone: "1", city: "" }),
    );
    expect(result.success).toBe(false);
    if (result.success) return;

    const errors = checkoutFieldErrors(result.error);
    expect(errors.fullName).toBe("Enter your full name");
    expect(errors.email).toBe("Enter a valid email address");
    expect(errors.phone).toContain("Canadian phone number");
    expect(errors.city).toBe("Enter your city or town");
  });

  it("keeps only the first error per field", () => {
    const result = checkoutFormSchema.safeParse(
      deliveryValues({ email: "nope", phone: "1" }),
    );
    if (result.success) throw new Error("expected the form to be invalid");

    const errors = checkoutFieldErrors(result.error);
    expect(Object.keys(errors).sort()).toEqual(["email", "phone"]);
  });

  it("reports an invalid province as a province problem", () => {
    const result = checkoutFormSchema.safeParse(deliveryValues({ province: "ZZ" }));
    if (result.success) throw new Error("expected the form to be invalid");

    expect(checkoutFieldErrors(result.error).province).toBe("Choose your province or territory");
  });
});
