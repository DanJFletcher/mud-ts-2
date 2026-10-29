import { useState, type ReactNode } from 'react';

/** A world-selection tile with an optional client-side link renderer. Image art is decorative; title and summary name the link. */
export interface WorldCardLinkProps {
  href: string;
  className: string;
  children: ReactNode;
}

export interface WorldCardProps {
  name: string;
  summary: string;
  href: string;
  imageSrc?: string;
  renderLink?: (props: WorldCardLinkProps) => ReactNode;
}

export function WorldCard({ name, summary, href, imageSrc, renderLink }: WorldCardProps) {
  const [imageFailed, setImageFailed] = useState(false);
  const className = `mudd-world-card${imageSrc && !imageFailed ? ' has-art' : ' is-text-cover'}`;
  const children = <>
      {imageSrc && !imageFailed ? (
        <img className="mudd-world-card__image" src={imageSrc} alt="" aria-hidden="true"
          loading="lazy" decoding="async" onError={() => setImageFailed(true)} />
      ) : null}
      <span className="mudd-world-card__veil" aria-hidden="true" />
      <span className="mudd-world-card__content">
        <span className="mudd-world-card__kicker">A world to enter</span>
        <h2 className="mudd-world-card__title">{name}</h2>
        <span className="mudd-world-card__summary">{summary}</span>
        <span className="mudd-world-card__link-cue" aria-hidden="true">Explore world <span>↗</span></span>
      </span>
  </>;
  return renderLink
    ? renderLink({ href, className, children })
    : <a className={className} href={href}>{children}</a>;
}
