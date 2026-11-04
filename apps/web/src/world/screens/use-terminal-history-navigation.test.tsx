import { act, renderHook } from "@testing-library/react";
import type { ActivityEntry } from "@mudd/ui";
import type { UIEvent } from "react";
import { describe, expect, it } from "vitest";
import { useTerminalHistoryNavigation } from "./use-terminal-history-navigation.js";

const entries: readonly ActivityEntry[] = [{
  id: "first",
  kind: "narration",
  text: "The room is quiet.",
}];

function box(top: number, height: number): DOMRect {
  return {
    x: 0,
    y: top,
    width: 300,
    height,
    top,
    right: 300,
    bottom: top + height,
    left: 0,
    toJSON: () => ({}),
  };
}

function makeHistory() {
  const history = document.createElement("div");
  let scrollTop = 0;
  Object.defineProperties(history, {
    scrollHeight: { configurable: true, value: 600 },
    clientHeight: { configurable: true, value: 200 },
    scrollTop: {
      configurable: true,
      get: () => scrollTop,
      set: (value: number) => { scrollTop = Math.max(0, Math.min(value, 400)); },
    },
  });
  history.getBoundingClientRect = () => box(100, 200);
  return history;
}

function addRow(history: HTMLDivElement, id: string, contentTop: () => number, height = 20) {
  const row = document.createElement("div");
  row.dataset.activityEntry = id;
  row.getBoundingClientRect = () => box(contentTop() - history.scrollTop, height);
  history.appendChild(row);
  return row;
}

function scrollTo(history: HTMLDivElement, top: number) {
  history.scrollTop = top;
  return { currentTarget: history } as UIEvent<HTMLDivElement>;
}

describe("terminal history navigation", () => {
  it("uses the 32-pixel latest threshold and returns to the latest entry", () => {
    const { result, rerender } = renderHook(
      ({ active }) => useTerminalHistoryNavigation({ active, entries }),
      { initialProps: { active: false } },
    );
    const history = makeHistory();
    act(() => { result.current.terminalHistoryRef.current = history; });
    rerender({ active: true });
    expect(history.scrollTop).toBe(400);

    act(() => { result.current.handleScroll(scrollTo(history, 369)); });
    expect(result.current.isFollowingLatest).toBe(true);
    expect(result.current.canScrollDown).toBe(false);

    act(() => { result.current.handleScroll(scrollTo(history, 367)); });
    expect(result.current.isFollowingLatest).toBe(false);
    expect(result.current.canScrollDown).toBe(true);

    act(() => { result.current.scrollToLatest(); });
    expect(result.current.isFollowingLatest).toBe(true);
    expect(result.current.readingAnchorId).toBeUndefined();
    expect(result.current.canScrollDown).toBe(false);
    expect(history.scrollTop).toBe(400);
  });

  it("anchors the first visible row and preserves its offset as entries arrive", () => {
    const { result, rerender } = renderHook(
      ({ currentEntries }) => useTerminalHistoryNavigation({ active: true, entries: currentEntries }),
      { initialProps: { currentEntries: entries } },
    );
    const history = makeHistory();
    let anchoredRowContentTop = 375;
    addRow(history, "above", () => 320, 20);
    addRow(history, "anchor", () => anchoredRowContentTop);
    act(() => { result.current.terminalHistoryRef.current = history; });
    rerender({ currentEntries: entries });

    act(() => { result.current.handleScroll(scrollTo(history, 250)); });
    expect(result.current.readingAnchorId).toBe("anchor");

    anchoredRowContentTop = 400;
    rerender({ currentEntries: [...entries, {
      id: "second",
      kind: "system",
      text: "A traveler arrives.",
    }] });
    expect(history.scrollTop).toBe(275);
  });

  it("preserves the reading anchor while inactive and restores it to a new terminal element", () => {
    const { result, rerender } = renderHook(
      ({ active }) => useTerminalHistoryNavigation({ active, entries }),
      { initialProps: { active: false } },
    );
    const firstHistory = makeHistory();
    addRow(firstHistory, "anchor", () => 370);
    act(() => { result.current.terminalHistoryRef.current = firstHistory; });
    rerender({ active: true });
    act(() => { result.current.handleScroll(scrollTo(firstHistory, 250)); });
    expect(result.current.readingAnchorId).toBe("anchor");

    rerender({ active: false });
    expect(result.current.canScrollDown).toBe(false);
    expect(result.current.readingAnchorId).toBe("anchor");

    const replacementHistory = makeHistory();
    addRow(replacementHistory, "anchor", () => 150);
    act(() => { result.current.terminalHistoryRef.current = replacementHistory; });
    rerender({ active: true });
    expect(replacementHistory.scrollTop).toBe(30);
    expect(result.current.readingAnchorId).toBe("anchor");
  });
});
