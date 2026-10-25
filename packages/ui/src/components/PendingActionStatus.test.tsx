import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { PendingActionStatus } from "./PendingActionStatus.js";

describe("PendingActionStatus", () => {
  it("announces a concise status and optional detail without implying an authoritative outcome", () => {
    const { rerender } = render(
      <PendingActionStatus state="sending" label="Traveling north…" />,
    );

    expect(screen.getByRole("status")).toHaveTextContent("Traveling north…");

    rerender(
      <PendingActionStatus
        state="uncertain"
        label="Checking your move…"
        detail="The room has not been confirmed yet."
      />,
    );
    expect(screen.getByRole("status")).toHaveTextContent("Checking your move…");
    expect(screen.getByRole("status")).toHaveTextContent("The room has not been confirmed yet.");
  });
});
