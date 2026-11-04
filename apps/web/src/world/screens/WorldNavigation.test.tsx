import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { useState } from "react";
import { useWorldNavigation } from "../features/navigation/world-navigation.js";
import { WorldNavigation } from "./WorldNavigation.js";

function NavigationHarness() {
  const navigation = useWorldNavigation();
  const [mobileCommandInputOpen, setMobileCommandInputOpen] = useState(false);
  const [, setTerminalExpandRequest] = useState(0);

  return (
    <WorldNavigation
      navigation={navigation}
      actions={{ handleLeaveWorld: async () => undefined, leaving: false }}
      commandInput={{
        mobileCommandInputOpen,
        setMobileCommandInputOpen,
        setTerminalExpandRequest,
      }}
      view={{ snapshot: null, isAnyCombatActive: false, visiblePvp: undefined }}
    />
  );
}

beforeEach(() => {
  window.history.replaceState(null, "", "/");
  window.localStorage.clear();
});

describe("WorldNavigation menu", () => {
  it("defaults to dark and persists a selected theme", () => {
    render(<NavigationHarness />);
    expect(document.documentElement).toHaveAttribute("data-theme", "dark");
    expect(window.localStorage.getItem("mudd-theme")).toBe("dark");

    fireEvent.click(screen.getByRole("button", { name: "Open menu" }));
    fireEvent.click(screen.getByRole("button", { name: "Switch to light theme" }));

    expect(document.documentElement).toHaveAttribute("data-theme", "light");
    expect(window.localStorage.getItem("mudd-theme")).toBe("light");
  });

  it("restores a previously saved light theme", () => {
    window.localStorage.setItem("mudd-theme", "light");
    render(<NavigationHarness />);

    expect(document.documentElement).toHaveAttribute("data-theme", "light");
  });

  it("closes on Escape and restores focus to the trigger", () => {
    render(<NavigationHarness />);
    const trigger = screen.getByRole("button", { name: "Open menu" });

    fireEvent.click(trigger);
    expect(screen.getByRole("region", { name: "Menu" })).toBeVisible();
    fireEvent.keyDown(document, { key: "Enter" });
    expect(screen.getByRole("region", { name: "Menu" })).toBeVisible();
    fireEvent.keyDown(document, { key: "Escape" });

    expect(screen.queryByRole("region", { name: "Menu" })).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it("closes when the player taps outside the menu", () => {
    render(<NavigationHarness />);
    fireEvent.click(screen.getByRole("button", { name: "Open menu" }));
    expect(screen.getByRole("region", { name: "Menu" })).toBeVisible();

    fireEvent.pointerDown(document.body);

    expect(screen.queryByRole("region", { name: "Menu" })).not.toBeInTheDocument();
  });
});
