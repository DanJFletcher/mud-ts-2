import { useState } from 'react';

/** Introductory world masthead. Paragraphs are rendered as plain text and art is treated as decorative. */
export interface WorldHeroProps {
  name: string;
  summary: string;
  introduction?: string[];
  imageSrc?: string;
}

export function WorldHero({ name, summary, introduction = [], imageSrc }: WorldHeroProps) {
  const [imageFailed, setImageFailed] = useState(false);
  const hasArt = Boolean(imageSrc && !imageFailed);
  return (
    <header className={`mudd-world-hero${hasArt ? ' has-art' : ' is-text-cover'}`}>
      {hasArt ? <img className="mudd-world-hero__image" src={imageSrc} alt="" aria-hidden="true" onError={() => setImageFailed(true)} /> : null}
      <div className="mudd-world-hero__veil" aria-hidden="true" />
      <div className="mudd-world-hero__content">
        <p className="mudd-world-hero__eyebrow">World guide</p>
        <h1 className="mudd-world-hero__title">{name}</h1>
        <p className="mudd-world-hero__summary">{summary}</p>
        {introduction.length > 0 ? (
          <div className="mudd-world-hero__introduction">
            {introduction.map((paragraph, index) => <p key={`${index}-${paragraph.slice(0, 24)}`}>{paragraph}</p>)}
          </div>
        ) : null}
      </div>
    </header>
  );
}
