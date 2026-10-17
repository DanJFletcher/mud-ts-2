import type { ElementType, HTMLAttributes, ReactNode } from 'react';

export interface TextProps extends HTMLAttributes<HTMLElement> {
  as?: ElementType;
  variant?: 'display' | 'heading' | 'body' | 'muted' | 'eyebrow';
  children: ReactNode;
}

export function Text({ as: Component = 'p', variant = 'body', className = '', ...props }: TextProps) {
  return <Component className={`mudd-text mudd-text--${variant} ${className}`.trim()} {...props} />;
}
