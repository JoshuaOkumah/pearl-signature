import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { Button, ButtonLink } from "./button";

describe("Button", () => {
  it("renders children and handles clicks", async () => {
    const onClick = vi.fn();
    const user = userEvent.setup();
    render(<Button onClick={onClick}>Order now</Button>);

    await user.click(screen.getByRole("button", { name: "Order now" }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("applies variant and size styling", () => {
    render(
      <Button variant="outline" size="lg">
        Outline
      </Button>,
    );
    const button = screen.getByRole("button", { name: "Outline" });
    expect(button.className).toContain("border");
    expect(button.className).toContain("px-8");
  });

  it("is inert when disabled", async () => {
    const onClick = vi.fn();
    const user = userEvent.setup();
    render(
      <Button disabled onClick={onClick}>
        Disabled
      </Button>,
    );

    const button = screen.getByRole("button", { name: "Disabled" });
    expect(button).toBeDisabled();
    await user.click(button);
    expect(onClick).not.toHaveBeenCalled();
  });
});

describe("ButtonLink", () => {
  it("renders a navigable link", () => {
    render(<ButtonLink href="/menu">Explore</ButtonLink>);
    expect(screen.getByRole("link", { name: "Explore" })).toHaveAttribute("href", "/menu");
  });
});
