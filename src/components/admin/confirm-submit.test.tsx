import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ConfirmSubmit } from "./confirm-submit";

function setup(overrides: Partial<Parameters<typeof ConfirmSubmit>[0]> = {}) {
  const action = vi.fn();
  const utils = render(
    <>
      <ConfirmSubmit
        action={action}
        fields={{ id: "507f1f77bcf86cd799439022" }}
        buttonLabel="Archive"
        confirmLabel="Confirm archive"
        {...overrides}
      />
      <button type="button">Outside control</button>
    </>,
  );
  const form = document.querySelector("form") as HTMLFormElement;
  return { action, form, ...utils };
}

describe("ConfirmSubmit (two-step confirmation)", () => {
  it("renders the action fields as hidden inputs", () => {
    setup();
    const input = document.querySelector('input[name="id"]') as HTMLInputElement;
    expect(input).not.toBeNull();
    expect(input.type).toBe("hidden");
    expect(input.value).toBe("507f1f77bcf86cd799439022");
  });

  it("arms on the first press without firing the action", async () => {
    const user = userEvent.setup();
    const { action } = setup();

    await user.click(screen.getByRole("button", { name: "Archive" }));

    expect(action).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Confirm archive" })).toBeInTheDocument();
    // Screen readers are told what the next press will do.
    expect(
      screen.getByText("Confirm archive Press again to confirm."),
    ).toBeInTheDocument();
  });

  it("submits on the second press with the form fields", async () => {
    const user = userEvent.setup();
    const { action } = setup();

    await user.click(screen.getByRole("button", { name: "Archive" }));
    await user.click(screen.getByRole("button", { name: "Confirm archive" }));

    await waitFor(() => expect(action).toHaveBeenCalledTimes(1));
    const formData = action.mock.calls[0][0] as FormData;
    expect(formData).toBeInstanceOf(FormData);
    expect(formData.get("id")).toBe("507f1f77bcf86cd799439022");
  });

  it("disarms when focus leaves the form, so a stray click cannot fire", async () => {
    const user = userEvent.setup();
    const { action, form } = setup();

    await user.click(screen.getByRole("button", { name: "Archive" }));
    expect(screen.getByRole("button", { name: "Confirm archive" })).toBeInTheDocument();

    // Focus moves to a control OUTSIDE the form.
    fireEvent.focusOut(form, {
      relatedTarget: screen.getByRole("button", { name: "Outside control" }),
    });

    expect(screen.getByRole("button", { name: "Archive" })).toBeInTheDocument();
    // The aria-live announcement is cleared when disarmed.
    expect(document.querySelector('[aria-live="polite"]')?.textContent).toBe("");

    // The next press must ARM again, never submit.
    await user.click(screen.getByRole("button", { name: "Archive" }));
    expect(action).not.toHaveBeenCalled();
  });

  it("stays armed when focus moves within the form", () => {
    const { form } = setup();

    fireEvent.click(screen.getByRole("button", { name: "Archive" }));
    fireEvent.focusOut(form, { relatedTarget: form.querySelector('input[name="id"]') });

    expect(screen.getByRole("button", { name: "Confirm archive" })).toBeInTheDocument();
  });

  it("shows distinct armed styling per tone (still not a hex value in sight)", () => {
    const danger = setup();
    const dangerButton = screen.getByRole("button", { name: "Archive" });
    expect(dangerButton.className).toContain("border-navy/25"); // resting outline
    fireEvent.click(dangerButton);
    expect(dangerButton.className).toContain("bg-terracotta-700"); // armed fill
    expect(danger.action).not.toHaveBeenCalled();
    danger.unmount();

    setup({ tone: "neutral" });
    const neutralButton = screen.getByRole("button", { name: "Archive" });
    fireEvent.click(neutralButton);
    expect(neutralButton.className).toContain("bg-navy");
    expect(neutralButton.className).not.toContain("bg-terracotta-700");
  });

  it("respects a caller-provided className over the built-in tones", () => {
    setup({ className: "custom-archive-class" });
    const button = screen.getByRole("button", { name: "Archive" });
    expect(button.className).toContain("custom-archive-class");
  });
});
