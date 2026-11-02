import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { ActivityHistoryWindow } from "./ActivityHistoryWindow.js";
afterEach(cleanup);
const entries = (start: number, end: number) => Array.from({ length: end - start }, (_, i) => ({
  id: String(start + i), kind: "narration" as const, text: `Activity ${start + i}`,
}));
describe("bounded activity presentation", () => {
  it("mounts only a finite window and navigates older/newer/latest with keyboard controls", async () => {
    const user = userEvent.setup();
    const view = render(<ActivityHistoryWindow entries={entries(0, 1000)} label="History" />);
    expect(within(screen.getByRole("region", { name: "History" })).getAllByRole("listitem")).toHaveLength(200);
    const older = screen.getByRole("button", { name: "Older" });
    older.focus(); await user.keyboard("{Enter}");
    expect(screen.getByText("Activity 600")).toBeVisible();
    expect(screen.queryByText("Activity 999")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Newer" }));
    expect(screen.getByText("Activity 999")).toBeVisible();
    fireEvent.click(older);
    fireEvent.click(screen.getByRole("button", { name: "Latest" }));
    expect(screen.getByText("Activity 999")).toBeVisible();
    expect(view.container.querySelectorAll("[data-activity-entry]")).toHaveLength(200);
  });
  it("keeps a retained ID anchored when activity arrives and signals eviction", () => {
    const { rerender } = render(<ActivityHistoryWindow entries={entries(0, 12)} windowSize={4} label="History" />);
    fireEvent.click(screen.getByRole("button", { name: "Older" }));
    expect(screen.getByText("Activity 4")).toBeVisible();
    rerender(<ActivityHistoryWindow entries={entries(1, 13)} windowSize={4} label="History" />);
    expect(screen.getByText("Activity 4")).toBeVisible();
    expect(screen.queryByText("Activity 12")).not.toBeInTheDocument();
    rerender(<ActivityHistoryWindow entries={entries(5, 17)} windowSize={4} label="History" />);
    expect(screen.getByText(/Earlier activity is no longer retained/)).toBeVisible();
    expect(screen.getByText("Activity 5")).toBeVisible();
  });
  it("renders notes in reverse order without live-announcing history navigation", () => {
    const view = render(<ActivityHistoryWindow entries={entries(0, 12)} windowSize={4} reverse label="Notes" />);
    const region = screen.getByRole("region", { name: "Notes" });
    expect(region).toHaveAttribute("aria-live", "off");
    expect(within(region).getAllByRole("listitem")[0]).toHaveTextContent("Activity 11");
    fireEvent.click(screen.getByRole("button", { name: "Older" }));
    expect(within(region).getAllByRole("listitem")[0]).toHaveTextContent("Activity 7");
    expect(region).toHaveAttribute("aria-live", "off");
    expect(view.container.querySelectorAll("[data-activity-entry]")).toHaveLength(4);
  });
  it("freezes reverse notes when the document scrolls into older visible rows", () => {
    const rect = vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
      const id = this.dataset.activityEntry;
      const top = id ? (9 - Number(id)) * 30 : 0;
      return { x: 0, y: top, top, bottom: top + 20, left: 0, right: 100, width: 100, height: 20, toJSON() {} };
    });
    try {
      const { rerender } = render(<ActivityHistoryWindow entries={entries(0, 12)} windowSize={4} reverse label="Notes" />);
      fireEvent.scroll(document);
      rerender(<ActivityHistoryWindow entries={entries(0, 13)} windowSize={4} reverse label="Notes" />);
      expect(within(screen.getByRole("region", { name: "Notes" })).getAllByRole("listitem")[0]).toHaveTextContent("Activity 11");
      expect(screen.queryByText("Activity 12")).not.toBeInTheDocument();
    } finally { rect.mockRestore(); }
  });

});
