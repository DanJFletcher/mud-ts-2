import type { ReactNode } from 'react';
import { Button } from './Button.js';

/** A world-scoped character summary with an explicit primary entry action and optional management/form slots. */
export interface CharacterEntryCardProps {
  name: string;
  worldName?: string;
  classLabel?: string;
  level?: number;
  statusLabel?: string;
  actionLabel: string;
  compact?: boolean;
  detailsHref?: string;
  onPlay: () => void;
  disabled?: boolean;
  busy?: boolean;
  secondaryActions?: ReactNode;
  children?: ReactNode;
}

export function CharacterEntryCard({
  name, worldName, classLabel, level, statusLabel, actionLabel, compact = false, detailsHref, onPlay,
  disabled = false, busy = false, secondaryActions, children,
}: CharacterEntryCardProps) {
  const details = [classLabel, typeof level === 'number' ? `Level ${level}` : undefined].filter(Boolean);
  return (
    <article className={`mudd-character-entry${compact ? ' mudd-character-entry--compact' : ''}`}>
      <div className="mudd-character-entry__top">
        <div className="mudd-character-entry__identity">
          <p className="mudd-character-entry__eyebrow">{worldName || 'Your traveler'}</p>
          <h3 className="mudd-character-entry__name">
            {detailsHref ? <a className="mudd-character-entry__name-link" href={detailsHref}>{name}</a> : name}
          </h3>
          {details.length > 0 ? <p className="mudd-character-entry__details">{details.join(' · ')}</p> : null}
          {statusLabel ? <p className="mudd-character-entry__status">{statusLabel}</p> : null}
        </div>
        {secondaryActions ? <div className="mudd-character-entry__secondary">{secondaryActions}</div> : null}
      </div>
      <div className="mudd-character-entry__actions">
        <Button
          className="mudd-character-entry__action"
          onClick={onPlay}
          disabled={disabled || busy}
          aria-busy={busy || undefined}
        >
          {busy ? 'Opening world…' : actionLabel}
        </Button>
      </div>
      {children ? <div className="mudd-character-entry__content">{children}</div> : null}
    </article>
  );
}
