import type { CSSProperties, HTMLAttributes } from 'react';

export type SkeletonVariant = 'text' | 'block' | 'circle';

/** A decorative placeholder. Keep loading announcements on the parent region, not each shape. */
export interface SkeletonProps extends Omit<HTMLAttributes<HTMLSpanElement>, 'children'> {
  variant?: SkeletonVariant;
  width?: CSSProperties['width'];
  height?: CSSProperties['height'];
}

export function Skeleton({
  variant = 'text',
  width,
  height,
  className = '',
  style,
  ...props
}: SkeletonProps) {
  const dimensions: CSSProperties = {
    ...(width !== undefined ? { width } : {}),
    ...(height !== undefined ? { height } : {}),
  };
  return (
    <span
      {...props}
      aria-hidden="true"
      className={`mudd-skeleton mudd-skeleton--${variant} ${className}`.trim()}
      style={{ ...style, ...dimensions }}
    />
  );
}
