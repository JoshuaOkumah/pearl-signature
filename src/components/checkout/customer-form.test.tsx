// @vitest-environment jsdom
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { CANADIAN_PROVINCES } from "@/lib/validations/checkout";
import { renderWithCart } from "@/test/cart-harness";
import { CustomerForm } from "./customer-form";

function renderForm() {
  renderWithCart(<CustomerForm />);
}

const name = () => screen.getByLabelText(/^Full name/);
const email = () => screen.getByLabelText(/^Email address/);
const phone = () => screen.getByLabelText(/^Phone number/);
const street = () => screen.getByLabelText(/^Street address/);
const city = () => screen.getByLabelText(/^City or town/);
const province = () => screen.getByLabelText(/^Province or territory/);
const postal = () => screen.getByLabelText(/^Postal code/);
const notes = () => screen.getByLabelText(/^Notes/);

const alerts = () => screen.queryAllByRole("alert");

describe("CustomerForm: structure", () => {
  it("renders the three sections with honest framing", () => {
    renderForm();

    expect(screen.getByRole("heading", { name: "Your details" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "How you would like to receive it" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Order notes" })).toBeInTheDocument();

    // The page states plainly that nothing is sent or stored yet.
    expect(screen.getByText(/Nothing you type on this page is sent or saved yet/)).toBeInTheDocument();
  });

  it("marks every field as required or optional rather than implying a default", () => {
    renderForm();

    // Each label carries its own marker, so no field is silently optional.
    const markers = screen.getAllByText(/\((required|optional)\)/);
    expect(markers.length).toBeGreaterThan(5);
    expect(screen.getAllByText("(required)").length).toBeGreaterThanOrEqual(5);
    expect(screen.getAllByText("(optional)").length).toBeGreaterThanOrEqual(2);
  });

  it("offers no submit control whatsoever", () => {
    renderForm();

    // Order placement is out of scope for this phase: no button, no submit.
    expect(screen.queryByRole("button", { name: /place order/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /pay/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /continue to payment/i })).not.toBeInTheDocument();
  });
});

describe("CustomerForm: fulfilment", () => {
  it("defaults to delivery and shows the address fields", () => {
    renderForm();

    expect(screen.getByRole("radio", { name: /Delivery/ })).toBeChecked();
    expect(screen.getByTestId("delivery-fields")).toBeInTheDocument();
    expect(screen.queryByTestId("pickup-fields")).not.toBeInTheDocument();
  });

  it("badges both methods as not yet confirmed", () => {
    renderForm();

    expect(screen.getAllByText("Not yet confirmed")).toHaveLength(2);
  });

  it("says service areas and fees are still being finalised", () => {
    renderForm();

    expect(screen.getByText(/Service areas, fees and pickup arrangements are still being finalised/)).toBeInTheDocument();
  });

  it("swaps the address fields for the honest pickup panel", async () => {
    const user = userEvent.setup({ delay: null });
    renderForm();

    await user.click(screen.getByRole("radio", { name: /Pickup/ }));

    expect(screen.getByTestId("pickup-fields")).toBeInTheDocument();
    expect(screen.queryByTestId("delivery-fields")).not.toBeInTheDocument();
    expect(screen.getByText(/A pickup location and collection times have not been confirmed yet/)).toBeInTheDocument();
  });

  it("restores the address fields when delivery is chosen again", async () => {
    const user = userEvent.setup({ delay: null });
    renderForm();

    await user.click(screen.getByRole("radio", { name: /Pickup/ }));
    await user.click(screen.getByRole("radio", { name: /Delivery/ }));

    expect(screen.getByTestId("delivery-fields")).toBeInTheDocument();
  });

  it("offers every province and territory, and assumes none", () => {
    renderForm();

    const select = province();
    // 13 real regions plus the placeholder.
    expect(screen.getAllByRole("option")).toHaveLength(CANADIAN_PROVINCES.length + 1);
    expect(select).toHaveValue("");
  });
});

describe("CustomerForm: validation", () => {
  it("reports required fields on blur and marks them invalid", async () => {
    const user = userEvent.setup({ delay: null });
    renderForm();

    await user.click(name());
    await user.tab();

    await waitFor(() => expect(screen.getByText("Enter your full name")).toBeInTheDocument());
    expect(name()).toHaveAttribute("aria-invalid", "true");
    expect(alerts().length).toBeGreaterThan(0);
  });

  it("links the error to its field for assistive technology", async () => {
    const user = userEvent.setup({ delay: null });
    renderForm();

    await user.click(email());
    await user.tab();

    await waitFor(() => expect(screen.getByText("Enter a valid email address")).toBeInTheDocument());
    const describedBy = email().getAttribute("aria-describedby") ?? "";
    expect(describedBy).toContain("checkout-email-error");
  });

  it("clears an error as soon as the customer fixes the field", async () => {
    const user = userEvent.setup({ delay: null });
    renderForm();

    await user.click(name());
    await user.tab();
    await waitFor(() => expect(screen.getByText("Enter your full name")).toBeInTheDocument());

    await user.type(name(), "Ada Okonkwo");
    await waitFor(() => expect(screen.queryByText("Enter your full name")).not.toBeInTheDocument());
  });

  it("rejects a phone number that is not Canadian", async () => {
    const user = userEvent.setup({ delay: null });
    renderForm();

    await user.type(phone(), "+44 20 7946 0958");
    await user.tab();

    await waitFor(() => expect(screen.getByText(/Enter a Canadian phone number/)).toBeInTheDocument());
  });

  it("accepts a Canadian phone number written in the usual way", async () => {
    const user = userEvent.setup({ delay: null });
    renderForm();

    await user.type(phone(), "(416) 555-0123");
    await user.tab();

    await waitFor(() => expect(screen.queryByText(/Enter a Canadian phone number/)).not.toBeInTheDocument());
  });

  it("requires the address only for delivery", async () => {
    const user = userEvent.setup({ delay: null });
    renderForm();

    // Fill the always-required details, then switch to pickup: no address is
    // demanded, because pickup has no address.
    await user.type(name(), "Ada Okonkwo");
    await user.type(email(), "ada@example.com");
    await user.type(phone(), "416 555 0123");
    await user.click(screen.getByRole("radio", { name: /Pickup/ }));

    await user.click(screen.getByRole("heading", { name: "Order notes" }));
    await waitFor(() => expect(screen.queryByText("Enter your street address")).not.toBeInTheDocument());

    // Switching back to delivery restores the requirement.
    await user.click(screen.getByRole("radio", { name: /Delivery/ }));
    await user.click(street());
    await user.tab();
    await waitFor(() => expect(screen.getByText("Enter your street address")).toBeInTheDocument());
  });

  it("rejects a postal code that Canada Post would not issue", async () => {
    const user = userEvent.setup({ delay: null });
    renderForm();

    await user.type(postal(), "12345");
    await user.tab();

    await waitFor(() => expect(screen.getByText("Enter a postal code like K1A 0B1")).toBeInTheDocument());
  });

  it("accepts a postal code in any usual written form", async () => {
    const user = userEvent.setup({ delay: null });
    renderForm();

    await user.type(postal(), "m5h2n2");
    await user.tab();

    await waitFor(() => expect(screen.queryByText("Enter a postal code like K1A 0B1")).not.toBeInTheDocument());
  });

  it("asks for a province rather than assuming one", async () => {
    const user = userEvent.setup({ delay: null });
    renderForm();

    await user.click(city());
    await user.tab();

    await waitFor(() => expect(screen.getByText("Choose your province or territory")).toBeInTheDocument());
  });

  it("accepts a complete valid delivery order without inventing any figure", async () => {
    const user = userEvent.setup({ delay: null });
    renderForm();

    await user.type(name(), "Ada Okonkwo");
    await user.type(email(), "ada@example.com");
    await user.type(phone(), "416 555 0123");
    await user.type(street(), "123 Queen Street W");
    await user.type(city(), "Toronto");
    await user.selectOptions(province(), "ON");
    await user.type(postal(), "M5H 2N2");
    await user.tab();

    // Valid input produces no errors anywhere on the form.
    await waitFor(() => expect(alerts()).toHaveLength(0));
    // And still no fee, total or promise appears: none is known yet.
    expect(screen.queryByText(/\$0\.00/)).not.toBeInTheDocument();
  });

  it("keeps the notes optional and never demands them", async () => {
    const user = userEvent.setup({ delay: null });
    renderForm();

    await user.click(notes());
    await user.tab();

    // Blurring revalidates the whole form (other fields may then complain),
    // but the notes field itself is optional and must never raise an error.
    await waitFor(() => expect(document.getElementById("checkout-email-error")).not.toBeNull());
    expect(document.getElementById("checkout-notes-error")).toBeNull();
    expect(notes()).not.toHaveAttribute("aria-invalid", "true");
  });
});

describe("CustomerForm: privacy", () => {
  it("holds typed values in the page only and never submits them", async () => {
    const user = userEvent.setup({ delay: null });
    renderForm();

    const form = document.querySelector("form");
    expect(form).not.toBeNull();
    // No action, no method, no submit button: nothing can be transmitted.
    expect(form).not.toHaveAttribute("action");
    expect(form).not.toHaveAttribute("method");
    expect(form!.querySelector('button[type="submit"]')).toBeNull();

    await user.type(name(), "Ada Okonkwo");
    expect(name()).toHaveValue("Ada Okonkwo");
  });

  it("uses sensible autocomplete tokens so browsers can fill the form", () => {
    renderForm();

    expect(name()).toHaveAttribute("autocomplete", "name");
    expect(email()).toHaveAttribute("autocomplete", "email");
    expect(phone()).toHaveAttribute("autocomplete", "tel");
    expect(street()).toHaveAttribute("autocomplete", "address-line1");
    expect(city()).toHaveAttribute("autocomplete", "address-level2");
    expect(province()).toHaveAttribute("autocomplete", "address-level1");
    expect(postal()).toHaveAttribute("autocomplete", "postal-code");
  });
});
