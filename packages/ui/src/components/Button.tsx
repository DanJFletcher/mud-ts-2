import type { ButtonHTMLAttributes, ReactNode } from 'react';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'quiet';
  children: ReactNode;
}

export function Button({ variant = 'primary', className = '', ...props }: ButtonProps) {
  return <button className={`mudd-button mudd-button--${variant} ${className}`.trim()} {...props} />;
}
