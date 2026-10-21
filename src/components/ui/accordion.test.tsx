import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { Accordion } from "./accordion";

const items = [
  { question: "Do you deliver?", answer: "Delivery is planned." },
  { question: "Can I pay cash?", answer: "Cash on arrival is planned." },
];

describe("Accordion", () => {
  it("starts collapsed", () => {
    render(<Accordion items={items} />);
    const trigger = screen.getByRole("button", { name: "Do you deliver?" });
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("Delivery is planned.")).not.toBeInTheDocument();
  });

  it("expands and collapses with correct aria wiring", async () => {
    const user = userEvent.setup();
    render(<Accordion items={items} />);
    const trigger = screen.getByRole("button", { name: "Do you deliver?" });

    await user.click(trigger);
    expect(trigger).toHaveAttribute("aria-expanded", "true");

    const panelId = trigger.getAttribute("aria-controls");
    expect(panelId).toBeTruthy();
    const panel = document.getElementById(panelId as string);
    expect(panel).not.toBeNull();
    expect(panel).toHaveAttribute("role", "region");
    expect(panel).toHaveTextContent("Delivery is planned.");

    await user.click(trigger);
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    await waitFor(() => expect(screen.queryByText("Delivery is planned.")).not.toBeInTheDocument());
  });

  it("toggles items independently", async () => {
    const user = userEvent.setup();
    render(<Accordion items={items} />);

    await user.click(screen.getByRole("button", { name: "Do you deliver?" }));

    expect(screen.getByText("Delivery is planned.")).toBeInTheDocument();
    expect(screen.queryByText("Cash on arrival is planned.")).not.toBeInTheDocument();
  });
});
