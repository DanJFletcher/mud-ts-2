import { useCallback, useLayoutEffect, useRef, useState, type RefObject, type UIEvent } from "react";
import type { ActivityEntry } from "@mudd/ui";

type ReadingPosition = Readonly<{ id: string; offset: number }>;

export type TerminalHistoryNavigation = Readonly<{
  terminalHistoryRef: RefObject<HTMLDivElement | null>;
  isFollowingLatest: boolean;
  readingAnchorId: string | undefined;
  canScrollDown: boolean;
  handleScroll: (event: UIEvent<HTMLDivElement>) => void;
  handleWindowChange: (latest: boolean) => void;
  scrollToLatest: () => void;
}>;

type Options = Readonly<{
  active: boolean;
  entries: readonly ActivityEntry[];
}>;

// eslint-disable-next-line max-lines-per-function -- The hook keeps viewport state and its layout lifecycle together.
export function useTerminalHistoryNavigation({ active, entries }: Options): TerminalHistoryNavigation {
  const terminalHistoryRef = useRef<HTMLDivElement | null>(null);
  const followsLatestRef = useRef(true);
  const readingPositionRef = useRef<ReadingPosition | undefined>(undefined);
  const [isFollowingLatest, setIsFollowingLatest] = useState(true);
  const [readingAnchorId, setReadingAnchorId] = useState<string>();
  const [canScrollDown, setCanScrollDown] = useState(false);

  // eslint-disable-next-line max-lines-per-function -- Restores the captured viewport anchor after history changes.
  useLayoutEffect(() => {
    const history = terminalHistoryRef.current;
    if (!active || !history) {
      setCanScrollDown(false);
      return;
    }

    if (followsLatestRef.current) history.scrollTop = history.scrollHeight;
    else if (readingPositionRef.current) {
      const anchor = readingPositionRef.current;
      const row = [...history.querySelectorAll<HTMLElement>("[data-activity-entry]")]
        .find((candidate) => candidate.dataset.activityEntry === anchor.id);
      if (row) {
        history.scrollTop += row.getBoundingClientRect().top -
          history.getBoundingClientRect().top - anchor.offset;
      }
    }

    setCanScrollDown(history.scrollHeight - history.scrollTop - history.clientHeight > 32);
  }, [active, canScrollDown, entries, readingAnchorId]);

  // eslint-disable-next-line max-lines-per-function -- Scroll updates must capture follow state and the visible row atomically.
  const handleScroll = useCallback((event: UIEvent<HTMLDivElement>) => {
    const history = event.currentTarget;
    const distanceFromLatest = history.scrollHeight - history.scrollTop - history.clientHeight;
    const followsLatest = distanceFromLatest < 32;
    followsLatestRef.current = followsLatest;
    setIsFollowingLatest(followsLatest);

    if (!followsLatest) {
      const rows = [...history.querySelectorAll<HTMLElement>("[data-activity-entry]")];
      const top = history.getBoundingClientRect().top;
      const row = rows.find((candidate) => candidate.getBoundingClientRect().bottom > top) ?? rows[0];
      if (row?.dataset.activityEntry) {
        readingPositionRef.current = {
          id: row.dataset.activityEntry,
          offset: row.getBoundingClientRect().top - top,
        };
        setReadingAnchorId(row.dataset.activityEntry);
      }
    } else {
      readingPositionRef.current = undefined;
      setReadingAnchorId(undefined);
    }

    setCanScrollDown(distanceFromLatest > 32);
  }, []);

  // eslint-disable-next-line max-lines-per-function -- History-window navigation updates the same viewport state as scrolling.
  const handleWindowChange = useCallback((latest: boolean) => {
    followsLatestRef.current = latest;
    setIsFollowingLatest(latest);
    readingPositionRef.current = undefined;
    setReadingAnchorId(undefined);
    setCanScrollDown(!latest);

    const history = terminalHistoryRef.current;
    if (history) history.scrollTop = latest ? history.scrollHeight : 0;
    if (latest) requestAnimationFrame(() => {
      const current = terminalHistoryRef.current;
      if (current && followsLatestRef.current) current.scrollTop = current.scrollHeight;
    });
  }, []);

  // eslint-disable-next-line max-lines-per-function -- Both immediate and frame-delayed scrolling are needed for layout changes.
  const scrollToLatest = useCallback(() => {
    const history = terminalHistoryRef.current;
    if (!history) return;

    followsLatestRef.current = true;
    setIsFollowingLatest(true);
    readingPositionRef.current = undefined;
    setReadingAnchorId(undefined);
    history.scrollTop = history.scrollHeight;
    setCanScrollDown(false);
    requestAnimationFrame(() => {
      const current = terminalHistoryRef.current;
      if (current && followsLatestRef.current) current.scrollTop = current.scrollHeight;
    });
  }, []);

  return {
    terminalHistoryRef,
    isFollowingLatest,
    readingAnchorId,
    canScrollDown,
    handleScroll,
    handleWindowChange,
    scrollToLatest,
  };
}
