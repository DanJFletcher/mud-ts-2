import { act, fireEvent, render, renderHook, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { GameSnapshotSchema } from "@mudd/client-sdk";
import { useMovementShortcuts } from "./use-movement-shortcuts.js";
const snapshot = GameSnapshotSchema.parse({
  player: { id: "player", displayName: "Player" },
  character: { characterId: "character", worldInstanceId: "world", name: "Arin", locationId: "room", revision: 1 },
  location: {
    worldInstanceId: "world", locationId: "room", revision: 1, title: "Room", shortName: "Room",
    qualifiedName: "Room", locationGroups: [], description: "Room", occupants: [], objects: [],
    exits: [
      { id: "north", label: "North", direction: "north", available: true },
      { id: "up", label: "Up", direction: "up", available: true },
    ],
  },
});
describe("modal-safe movement shortcuts", () => {
  it.each(["Dialogue", "Interaction options", "Crafting quantity"])("suppresses arrow and Shift-arrow keys on %s dialog buttons", (name) => {
    const move = vi.fn(async () => {});
    const view = render(<dialog open aria-label={name}><button>Focused action</button></dialog>);
    const { rerender } = renderHook(({ modalOpen }) => useMovementShortcuts({
      enabled: true, modalOpen, snapshot, move, chooseExit: vi.fn(),
    }), { initialProps: { modalOpen: true } });
    const button = screen.getByRole("button");
    button.focus();
    fireEvent.keyDown(button, { key: "ArrowUp" });
    fireEvent.keyDown(button, { key: "ArrowUp", shiftKey: true });
    fireEvent.keyDown(document, { key: "ArrowUp" });
    expect(move).not.toHaveBeenCalled();
    // DOM/focus guards also protect the transition before the modal flag updates.
    rerender({ modalOpen: false });
    fireEvent.keyDown(button, { key: "ArrowUp" });
    expect(move).not.toHaveBeenCalled();
    view.unmount();
    act(() => { document.body.focus(); });
    fireEvent.keyDown(document, { key: "ArrowUp" });
    expect(move).toHaveBeenCalledWith("north");
  });
  it("respects disabled gameplay and editable focus after dismissal", () => {
    const move = vi.fn(async () => {});
    const { rerender } = renderHook(({ enabled }) => useMovementShortcuts({
      enabled, modalOpen: false, snapshot, move, chooseExit: vi.fn(),
    }), { initialProps: { enabled: false } });
    fireEvent.keyDown(document, { key: "ArrowUp" });
    expect(move).not.toHaveBeenCalled();
    rerender({ enabled: true });
    render(<input aria-label="Command" />);
    screen.getByRole("textbox").focus();
    fireEvent.keyDown(document, { key: "ArrowUp" });
    expect(move).not.toHaveBeenCalled();
  });

  it("ignores repeated, modified, prevented, and input-focused movement keys", () => {
    const move = vi.fn(async () => {});
    render(<input aria-label="Command" />);
    renderHook(() => useMovementShortcuts({
      enabled: true, modalOpen: false, snapshot, move, chooseExit: vi.fn(),
    }));

    document.dispatchEvent(new KeyboardEvent("keydown", {
      key: "ArrowUp", bubbles: true, repeat: true,
    }));
    document.dispatchEvent(new KeyboardEvent("keydown", {
      key: "ArrowUp", bubbles: true, altKey: true,
    }));
    const prevented = new KeyboardEvent("keydown", {
      key: "ArrowUp", bubbles: true, cancelable: true,
    });
    prevented.preventDefault();
    document.dispatchEvent(prevented);

    const command = screen.getByRole("textbox", { name: "Command" });
    command.focus();
    fireEvent.keyDown(command, { key: "ArrowUp" });

    expect(move).not.toHaveBeenCalled();
  });
});
