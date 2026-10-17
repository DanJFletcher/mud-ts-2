import type { ComponentPropsWithRef } from 'react';

type Variant = 'primary' | 'secondary';

type ButtonProps = ComponentPropsWithRef<'button'> & {
  variant?: Variant;
  isLoading?: boolean;
};

const variantClasses: Record<Variant, string> = {
  primary: 'bg-action text-action-foreground hover:bg-action-hover',
  secondary: 'border border-border bg-surface text-content hover:bg-surface-raised',
};

/** Generic presentation-only button; cannot issue gameplay commands itself. */
export function Button({
  variant = 'primary',
  isLoading = false,
  disabled,
  type = 'button',
  className = '',
  children,
  ...rest
}: ButtonProps) {
  return (
    <button
      {...rest}
      type={type}
      disabled={disabled || isLoading}
      aria-busy={isLoading || undefined}
      className={[
        'inline-flex min-h-11 min-w-11 items-center justify-center gap-2',
        'rounded-control px-4 py-2 text-sm font-semibold',
        'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring',
        'disabled:cursor-not-allowed disabled:opacity-60',
        variantClasses[variant],
        className,
      ].join(' ')}
    >
      {isLoading ? <span aria-hidden="true">…</span> : null}
      {children}
    </button>
  );
}
