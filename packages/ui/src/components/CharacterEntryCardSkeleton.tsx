import { Skeleton } from './Skeleton.js';

export interface CharacterEntryCardSkeletonProps {
  compact?: boolean;
  showWorldName?: boolean;
}

/** Placeholder matching CharacterEntryCard's compact lobby layout. */
export function CharacterEntryCardSkeleton({
  compact = false,
  showWorldName = true,
}: CharacterEntryCardSkeletonProps) {
  return (
    <article
      aria-hidden="true"
      className={`mudd-character-entry mudd-character-entry--skeleton${compact ? ' mudd-character-entry--compact' : ''}`}
    >
      <div className="mudd-character-entry__top">
        <div className="mudd-character-entry__identity">
          {showWorldName && <p className="mudd-character-entry__eyebrow">
            <Skeleton variant="text" width="92%" height="1.4em" className="mudd-character-entry__skeleton-world" />
          </p>}
          <h3 className="mudd-character-entry__name">
            <Skeleton variant="text" width="52%" height="1.15em" className="mudd-character-entry__skeleton-name" />
          </h3>
          <p className="mudd-character-entry__details">
            <Skeleton variant="text" width="90%" height="1.35em" className="mudd-character-entry__skeleton-details" />
          </p>
        </div>
        <div className="mudd-character-entry__secondary">
          <span className="mudd-character-entry__skeleton-manage">
            <Skeleton variant="block" className="mudd-character-entry__skeleton-manage-mark" />
          </span>
        </div>
      </div>
      <div className="mudd-character-entry__actions">
        <Skeleton variant="block" className="mudd-character-entry__action mudd-character-entry__skeleton-action" />
      </div>
    </article>
  );
}
