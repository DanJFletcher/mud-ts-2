import { useMemo } from 'react';

export interface ActivityEntry {
  id: string;
  kind: 'narration' | 'location' | 'system' | 'error';
  text: string;
  locationId?: string;
}

export interface ActivityLogAction {
  id: string;
  label: string;
}

export interface ActivityLogTarget {
  id: string;
  label: string;
  actions?: readonly ActivityLogAction[];
}

export interface ActivityLogProps {
  entries: readonly ActivityEntry[];
  label?: string;
  currentLocationId?: string;
  lookTargets?: readonly ActivityLogTarget[];
  onLookTarget?: (target: ActivityLogTarget) => void;
  actionsDisabled?: boolean;
}

const EMPTY_TARGETS: readonly ActivityLogTarget[] = [];

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function createTargetMatcher(targets: readonly ActivityLogTarget[]) {
  const targetByLabel = new Map<string, ActivityLogTarget>();
  const labels: string[] = [];
  const orderedTargets = [...targets]
    .filter((target) => target.label.trim().length > 0)
    .sort((a, b) => b.label.length - a.label.length);

  for (const target of orderedTargets) {
    const label = target.label.trim();
    const normalizedLabel = label.toLocaleLowerCase();
    if (targetByLabel.has(normalizedLabel)) continue;
    targetByLabel.set(normalizedLabel, target);
    labels.push(escapeRegExp(label));
  }

  if (!labels.length) return null;
  return {
    targetByLabel,
    pattern: new RegExp(
      `(^|[^\\p{L}\\p{N}_])(${labels.join('|')})(?=$|[^\\p{L}\\p{N}_])`,
      'giu',
    ),
  };
}

function findTargetMatches(
  text: string,
  matcher: ReturnType<typeof createTargetMatcher>,
) {
  if (!matcher) return [];
  const matches: Array<{ start: number; end: number; target: ActivityLogTarget }> = [];
  matcher.pattern.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = matcher.pattern.exec(text))) {
    const target = matcher.targetByLabel.get(match[2]!.toLocaleLowerCase());
    if (!target) continue;
    const start = match.index + match[1]!.length;
    matches.push({ start, end: start + match[2]!.length, target });
  }

  return matches;
}

export function ActivityLog({
  entries,
  label = 'Adventure log',
  currentLocationId,
  lookTargets = EMPTY_TARGETS,
  onLookTarget,
  actionsDisabled = false,
}: ActivityLogProps) {
  const targetMatcher = useMemo(() => createTargetMatcher(lookTargets), [lookTargets]);

  return (
    <section className="mudd-log" aria-label={label} aria-live="polite" aria-relevant="additions text">
      {entries.length === 0 ? (
        <p className="mudd-log__empty">Your journey begins here.</p>
      ) : (
        <ol className="mudd-log__entries">
          {entries.map((entry) => {
            const isCurrentRoomEntry = entry.locationId && entry.locationId === currentLocationId;
            const canLink = Boolean(isCurrentRoomEntry && onLookTarget && lookTargets.length) &&
              (entry.kind === 'narration' || entry.kind === 'location');
            const matches = canLink ? findTargetMatches(entry.text, targetMatcher) : [];
            let cursor = 0;
            const content = matches.length
              ? matches.flatMap(({ start, end, target }) => {
                  const parts = [
                    entry.text.slice(cursor, start),
                    <button
                      key={`${entry.id}:${start}:${target.id}`}
                      type="button"
                      className="mudd-log__interactive-target"
                      aria-label={
                        (target.actions?.length ?? 1) > 1
                          ? `Choose an action for ${target.label} in terminal`
                          : `Look at ${target.label} in terminal`
                      }
                      aria-haspopup={(target.actions?.length ?? 1) > 1 ? 'dialog' : undefined}
                      disabled={actionsDisabled}
                      onClick={() => onLookTarget?.(target)}
                    >
                      {entry.text.slice(start, end)}
                    </button>,
                  ];
                  cursor = end;
                  return parts;
                }).concat(entry.text.slice(cursor))
              : entry.text;

            return (
              <li className={`mudd-log__entry mudd-log__entry--${entry.kind}`} key={entry.id}>
                {content}
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
