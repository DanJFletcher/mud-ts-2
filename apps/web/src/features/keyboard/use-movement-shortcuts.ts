import { useEffect } from "react";
import type { GameSnapshot } from "@mudd/client-sdk";

type Options = {
  enabled: boolean;
  modalOpen: boolean;
  snapshot: GameSnapshot | null;
  move(exitId: string): Promise<void>;
  chooseExit(): void;
};
function suppressesMovement(target: EventTarget | null): boolean {
  return target instanceof Element && Boolean(
    target.closest("dialog, [role='dialog'], input, textarea, select, [contenteditable]:not([contenteditable='false']), [role='textbox']"),
  );
}
/** Document shortcuts are subordinate to modal focus, editable context, and gameplay eligibility. */
export function useMovementShortcuts({ enabled, modalOpen, snapshot, move, chooseExit }: Options) {
  useEffect(() => {
    if (!enabled) return;
    const handleMovementKeys = (event: KeyboardEvent) => {
      if (modalOpen || event.defaultPrevented || event.repeat || event.altKey || event.ctrlKey || event.metaKey ||
          document.querySelector("dialog[open], [role='dialog'][aria-modal='true']") ||
          suppressesMovement(event.target) || suppressesMovement(document.activeElement)) return;
      let direction: string | undefined;
      if (event.shiftKey) {
        if (event.key === "ArrowUp") direction = "up";
        else if (event.key === "ArrowDown") direction = "down";
      } else {
        direction = ({ ArrowUp: "north", ArrowRight: "east", ArrowDown: "south", ArrowLeft: "west" })[
          event.key as "ArrowUp" | "ArrowRight" | "ArrowDown" | "ArrowLeft"
        ];
      }
      if (!direction || !snapshot?.character || !snapshot.location) return;
      event.preventDefault();
      const exits = snapshot.location.exits.filter((exit) =>
        exit.available && (exit.direction?.trim() || exit.label.trim()).toLocaleLowerCase() === direction);
      if (exits.length > 1) chooseExit();
      else if (exits[0]) void move(exits[0].id);
    };
    document.addEventListener("keydown", handleMovementKeys);
    return () => document.removeEventListener("keydown", handleMovementKeys);
  }, [enabled, modalOpen, snapshot, move, chooseExit]);
}
