import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { ActivityLog, type ActivityLogProps } from "./ActivityLog.js";
import { Button } from "./Button.js";

export const ACTIVITY_WINDOW_LIMIT = 200;
export interface ActivityHistoryWindowProps extends Omit<ActivityLogProps, "live"> {
  windowSize?: number;
  reverse?: boolean;
  followLatest?: boolean;
  readingAnchorId?: string;
  onWindowChange?: (latest: boolean, reason: "navigation" | "eviction") => void;
}

/**
 * A finite, ID-anchored view of retained chronological entries. Historical rows
 * never announce themselves; the session owner announces new activity separately.
 */
export function ActivityHistoryWindow({
  entries, windowSize = ACTIVITY_WINDOW_LIMIT, reverse = false,
  followLatest, readingAnchorId, onWindowChange, ...log
}: ActivityHistoryWindowProps) {
  const limit = Number.isFinite(windowSize) ? Math.max(1, Math.floor(windowSize)) : ACTIVITY_WINDOW_LIMIT;
  const [anchorId, setAnchorId] = useState<string>();
  const previousStart = useRef<string | undefined>(undefined);
  const root = useRef<HTMLDivElement>(null);
  const scrollAnchor = useRef<{ id: string; offset: number; scroller?: HTMLElement } | undefined>(undefined);
  useEffect(() => {
    if (followLatest !== undefined) return;
    const rememberReadingPosition = (event: Event) => {
      const node = root.current;
      if (!node) return;
      if (event.target instanceof HTMLElement && !node.contains(event.target) && !event.target.contains(node)) return;
      const scroller = event.target instanceof HTMLElement && node.contains(event.target) ? event.target : undefined;
      const top = scroller?.getBoundingClientRect().top ?? 0;
      const rows = [...node.querySelectorAll<HTMLElement>("[data-activity-entry]")];
      const bottom = scroller?.getBoundingClientRect().bottom ?? window.innerHeight;
      const visible = rows.find((row) => row.getBoundingClientRect().bottom > top && row.getBoundingClientRect().top < bottom);
      if (!visible?.dataset.activityEntry) return;
      const atLatest = reverse ? visible === rows[0]
        : scroller ? scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 32
          : Boolean(rows.at(-1) && rows.at(-1)!.getBoundingClientRect().bottom <= bottom);
      if (atLatest) { scrollAnchor.current = undefined; return; }
      scrollAnchor.current = { id: visible.dataset.activityEntry,
        offset: visible.getBoundingClientRect().top - top, scroller };
      setAnchorId((current) => current ?? previousStart.current);
    };
    document.addEventListener("scroll", rememberReadingPosition, true);
    return () => document.removeEventListener("scroll", rememberReadingPosition, true);
  }, [followLatest, reverse]);
  useLayoutEffect(() => {
    const anchor = scrollAnchor.current;
    const node = root.current;
    if (!anchor || !node) return;
    const row = [...node.querySelectorAll<HTMLElement>("[data-activity-entry]")]
      .find((row) => row.dataset.activityEntry === anchor.id);
    if (row) {
      const delta = row.getBoundingClientRect().top - (anchor.scroller?.getBoundingClientRect().top ?? 0) - anchor.offset;
      if (delta && anchor.scroller) anchor.scroller.scrollTop += delta;
      else if (delta) window.scrollBy({ top: delta, behavior: "auto" });
    } else if (!entries.some((entry) => entry.id === anchor.id)) {
      scrollAnchor.current = undefined;
      const oldest = [...node.querySelectorAll<HTMLElement>("[data-activity-entry]")]
        .find((row) => row.dataset.activityEntry === entries[0]?.id);
      oldest?.scrollIntoView?.({ block: "start" });
    }
  }, [entries]);
  const callbacks = useRef(onWindowChange);
  callbacks.current = onWindowChange;
  useLayoutEffect(() => {
    if (followLatest === true) setAnchorId(undefined);
    else if (followLatest === false) setAnchorId((current) => current ?? readingAnchorId ?? previousStart.current);
  }, [followLatest, readingAnchorId]);
  const requested = anchorId ?? (followLatest === false ? readingAnchorId ?? previousStart.current : undefined);
  const index = requested ? entries.findIndex((entry) => entry.id === requested) : -1;
  const evicted = Boolean(requested && index === -1);
  const start = requested ? Math.max(0, index) : Math.max(0, entries.length - limit);
  const end = Math.min(entries.length, start + limit);
  const visible = entries.slice(start, end);
  previousStart.current = visible[0]?.id;
  const actualAnchorEvicted = Boolean(readingAnchorId && !entries.some((entry) => entry.id === readingAnchorId));
  useLayoutEffect(() => {
    if (evicted && (!readingAnchorId || actualAnchorEvicted)) callbacks.current?.(false, "eviction");
  }, [evicted, readingAnchorId, actualAnchorEvicted]);
  const navigate = (next: number | undefined) => {
    scrollAnchor.current = undefined;
    setAnchorId(next === undefined ? undefined : entries[next]?.id);
    callbacks.current?.(next === undefined, "navigation");
  };
  return (
    <div className="mudd-history" ref={root}>
      <p className="mudd-history__retention">Only recent session activity is retained.</p>
      {entries.length > limit && (
        <nav className="mudd-history__navigation" aria-label={`${log.label ?? "Activity"} history navigation`}>
          <Button type="button" variant="quiet" disabled={start === 0}
            onClick={() => navigate(Math.max(0, start - limit))}>Older</Button>
          <Button type="button" variant="quiet" disabled={end === entries.length}
            onClick={() => end + limit >= entries.length ? navigate(undefined) : navigate(start + limit)}>Newer</Button>
          <Button type="button" variant="quiet" disabled={!requested}
            onClick={() => navigate(undefined)}>Latest</Button>
          <span className="mudd-history__range">{start + 1}–{end} of {entries.length}</span>
        </nav>
      )}
      {evicted && (!readingAnchorId || actualAnchorEvicted) && (
        <p className="mudd-history__notice" role="status">Earlier activity is no longer retained. Showing the oldest available entries.</p>
      )}
      <ActivityLog {...log} entries={reverse ? [...visible].reverse() : visible} live="off" />
    </div>
  );
}
