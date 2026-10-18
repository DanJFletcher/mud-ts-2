import type { ButtonHTMLAttributes, ReactNode } from 'react';

export interface DisclosureButtonProps
  extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'aria-controls' | 'aria-expanded' | 'children' | 'type'> {
  controls: string;
  expanded: boolean;
  children: ReactNode;
  indicator?: ReactNode;
}

export function DisclosureButton({
  controls,
  expanded,
  indicator,
  className = '',
  children,
  ...props
}: DisclosureButtonProps) {
  return (
    <button
      {...props}
      aria-controls={controls}
      aria-expanded={expanded}
      className={`mudd-disclosure-button ${className}`.trim()}
      type="button"
    >
      <span className="mudd-disclosure-button__content">{children}</span>
      <span aria-hidden="true" className="mudd-disclosure-button__indicator">
        {indicator ?? (expanded ? '▾' : '▸')}
      </span>
    </button>
  );
}
