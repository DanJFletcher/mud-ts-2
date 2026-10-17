import { useId, type HTMLAttributes, type ReactNode } from 'react';

export interface PanelProps extends HTMLAttributes<HTMLElement> {
  children: ReactNode;
  title?: string;
  eyebrow?: string;
}

export function Panel({ children, title, eyebrow, className = '', ...props }: PanelProps) {
  const titleId = useId();
  const ariaLabelledBy = props['aria-labelledby'];
  return (
    <section className={`mudd-panel ${className}`.trim()} {...props} aria-labelledby={title ? titleId : ariaLabelledBy}>
      {eyebrow && <p className="mudd-text mudd-text--eyebrow">{eyebrow}</p>}
      {title && <h2 className="mudd-panel__title" id={titleId}>{title}</h2>}
      {children}
    </section>
  );
}
