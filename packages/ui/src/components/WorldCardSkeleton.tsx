import { Skeleton } from './Skeleton.js';

/** Decorative placeholder matching the world discovery card. */
export function WorldCardSkeleton() {
  return (
    <article aria-hidden="true" className="mudd-world-card mudd-world-card--skeleton">
      <div className="mudd-world-card__content">
        <Skeleton variant="text" width="8rem" height=".55rem" className="mudd-world-card__skeleton-kicker" />
        <Skeleton variant="block" width="72%" height="1.9rem" className="mudd-world-card__skeleton-title" />
        <Skeleton variant="text" width="92%" height=".78rem" className="mudd-world-card__skeleton-summary" />
        <Skeleton variant="text" width="70%" height=".78rem" className="mudd-world-card__skeleton-summary mudd-world-card__skeleton-summary--short" />
        <div className="mudd-world-card__link-cue">
          <Skeleton variant="text" width="6.5rem" height=".62rem" className="mudd-world-card__skeleton-link" />
          <Skeleton variant="circle" width="1rem" height="1rem" className="mudd-world-card__skeleton-arrow" />
        </div>
      </div>
    </article>
  );
}
