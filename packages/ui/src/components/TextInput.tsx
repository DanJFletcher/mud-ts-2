import type { InputHTMLAttributes } from 'react';

export interface TextInputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'id'> {
  id: string;
  label: string;
  hint?: string;
  error?: string;
}

export function TextInput({ id, label, hint, error, className = '', ...props }: TextInputProps) {
  const descriptionId = error ? `${id}-error` : hint ? `${id}-hint` : undefined;
  return (
    <div className="mudd-field">
      <label className="mudd-field__label" htmlFor={id}>{label}</label>
      <input
        id={id}
        className={`mudd-input ${error ? 'mudd-input--error' : ''} ${className}`.trim()}
        aria-invalid={Boolean(error)}
        aria-describedby={descriptionId}
        {...props}
      />
      {error && <p className="mudd-field__error" id={descriptionId}>{error}</p>}
      {!error && hint && <p className="mudd-field__hint" id={descriptionId}>{hint}</p>}
    </div>
  );
}
