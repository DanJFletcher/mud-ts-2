import type { ReactNode } from 'react';
import { Button } from './Button.js';

/** A world-scoped character summary with an explicit primary entry action and optional management/form slots. */
export interface CharacterEntryCardProps {
  name: string;
  worldName?: string;
  locationLabel: string;
  classLabel?: string;
  level?: number;
  statusLabel: string;
  actionLabel: string;
  onPlay: () => void;
  disabled?: boolean;
  busy?: boolean;
  secondaryActions?: ReactNode;
  children?: ReactNode;
}

export function CharacterEntryCard({
  name, worldName, locationLabel, classLabel, level, statusLabel, actionLabel, onPlay,
  disabled = false, busy = false, secondaryActions, children,
}: CharacterEntryCardProps) {
  const details = [classLabel, typeof level === 'number' ? `Level ${level}` : undefined].filter(Boolean);
  return (
    <article className="mudd-character-entry">
      <div className="mudd-character-entry__top">
        <div className="mudd-character-entry__identity">
          <p className="mudd-character-entry__eyebrow">{worldName || 'Your traveler'}</p>
          <h3 className="mudd-character-entry__name">{name}</h3>
          {details.length > 0 ? <p className="mudd-character-entry__details">{details.join(' · ')}</p> : null}
        </div>
        {secondaryActions ? <div className="mudd-character-entry__secondary">{secondaryActions}</div> : null}
      </div>
      <dl className="mudd-character-entry__facts">
        <div><dt>Last known</dt><dd>{locationLabel}</dd></div>
        <div><dt>State</dt><dd>{statusLabel}</dd></div>
      </dl>
      <Button
        className="mudd-character-entry__action"
        onClick={onPlay}
        disabled={disabled || busy}
        aria-busy={busy || undefined}
      >
        {busy ? 'Opening world…' : actionLabel}
      </Button>
      {children ? <div className="mudd-character-entry__content">{children}</div> : null}
    </article>
  );
}
