import { useState } from 'react';

/** A native-link tile for choosing a world. Image art is decorative; title and summary remain the link's accessible name. */
export interface WorldCardProps {
  name: string;
  summary: string;
  href: string;
  imageSrc?: string;
}

export function WorldCard({ name, summary, href, imageSrc }: WorldCardProps) {
  const [imageFailed, setImageFailed] = useState(false);
  return (
    <a className={`mudd-world-card${imageSrc && !imageFailed ? ' has-art' : ' is-text-cover'}`} href={href}>
      {imageSrc && !imageFailed ? (
        <img className="mudd-world-card__image" src={imageSrc} alt="" aria-hidden="true" onError={() => setImageFailed(true)} />
      ) : null}
      <span className="mudd-world-card__veil" aria-hidden="true" />
      <span className="mudd-world-card__content">
        <span className="mudd-world-card__kicker">A world to enter</span>
        <h2 className="mudd-world-card__title">{name}</h2>
        <span className="mudd-world-card__summary">{summary}</span>
        <span className="mudd-world-card__link-cue" aria-hidden="true">Explore world <span>↗</span></span>
      </span>
    </a>
  );
}
