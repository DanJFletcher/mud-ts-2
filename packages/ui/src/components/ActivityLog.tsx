export interface ActivityEntry {
  id: string;
  kind: 'narration' | 'location' | 'system' | 'error';
  text: string;
}

export interface ActivityLogProps {
  entries: readonly ActivityEntry[];
  label?: string;
}

export function ActivityLog({ entries, label = 'Adventure log' }: ActivityLogProps) {
  return (
    <section className="mudd-log" aria-label={label} aria-live="polite" aria-relevant="additions text">
      {entries.length === 0 ? (
        <p className="mudd-log__empty">Your journey begins here.</p>
      ) : (
        <ol className="mudd-log__entries">
          {entries.map((entry) => (
            <li className={`mudd-log__entry mudd-log__entry--${entry.kind}`} key={entry.id}>
              {entry.text}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
