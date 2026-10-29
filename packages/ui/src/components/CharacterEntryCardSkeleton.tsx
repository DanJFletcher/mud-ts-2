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
          {showWorldName && <Skeleton variant="text" className="mudd-character-entry__skeleton-world" />}
          <Skeleton variant="text" className="mudd-character-entry__skeleton-name" />
          <Skeleton variant="text" className="mudd-character-entry__skeleton-details" />
        </div>
        <Skeleton variant="block" className="mudd-character-entry__skeleton-manage" />
      </div>
      <div className="mudd-character-entry__actions">
        <Skeleton variant="block" className="mudd-character-entry__skeleton-action" />
      </div>
    </article>
  );
}
