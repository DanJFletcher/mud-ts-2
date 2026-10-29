import { Skeleton } from './Skeleton.js';

/** Decorative placeholder matching the world discovery card. */
export function WorldCardSkeleton() {
  return (
    <article aria-hidden="true" className="mudd-world-card mudd-world-card--skeleton">
      <div className="mudd-world-card__content">
        <Skeleton variant="text" className="mudd-world-card__skeleton-kicker" />
        <Skeleton variant="block" className="mudd-world-card__skeleton-title" />
        <Skeleton variant="text" className="mudd-world-card__skeleton-summary" />
        <Skeleton variant="text" className="mudd-world-card__skeleton-summary mudd-world-card__skeleton-summary--short" />
        <div className="mudd-world-card__link-cue">
          <Skeleton variant="text" className="mudd-world-card__skeleton-link" />
          <Skeleton variant="circle" className="mudd-world-card__skeleton-arrow" />
        </div>
      </div>
    </article>
  );
}
