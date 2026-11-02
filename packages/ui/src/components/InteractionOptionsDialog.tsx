import { useRef } from 'react';
import { Button } from './Button.js';
import type { ActivityLogAction } from './ActivityLog.js';
import { useModalDialog } from './use-modal-dialog.js';

export interface InteractionOptionsDialogProps {
  targetLabel: string;
  title?: string;
  options: readonly ActivityLogAction[];
  busy?: boolean;
  onSelect: (optionId: string) => void;
  onClose: () => void;
}

/** Accessible action picker for a clickable entity with multiple supported actions. */
export function InteractionOptionsDialog({
  targetLabel,
  title,
  options,
  busy = false,
  onSelect,
  onClose,
}: InteractionOptionsDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  useModalDialog(dialogRef);

  return (
    <dialog
      ref={dialogRef}
      className="mudd-interaction-options-dialog"
      aria-labelledby="mudd-interaction-options-title"
      aria-modal="true"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section className="mudd-interaction-options">
        <header className="mudd-interaction-options__header">
          <div>
            <h2 id="mudd-interaction-options-title">{title ?? `Choose an action for ${targetLabel}`}</h2>
          </div>
          <Button type="button" variant="quiet" onClick={onClose} disabled={busy}>
            Close
          </Button>
        </header>
        <div className="mudd-interaction-options__list" role="group" aria-label={`Actions for ${targetLabel}`}>
          {options.map((option) => (
            <Button
              key={option.id}
              type="button"
              variant="secondary"
              className="mudd-interaction-options__action"
              disabled={busy}
              onClick={() => onSelect(option.id)}
            >
              {option.label}
            </Button>
          ))}
        </div>
      </section>
    </dialog>
  );
}
