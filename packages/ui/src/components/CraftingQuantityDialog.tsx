import { useEffect, useRef } from 'react';
import { Button } from './Button.js';

export interface CraftingQuantityChoice {
  quantity: 1 | 5 | 10;
  disabled?: boolean;
}

export interface CraftingQuantityDialogProps {
  itemLabel: string;
  choices: readonly CraftingQuantityChoice[];
  busy?: boolean;
  onSelect: (quantity: CraftingQuantityChoice['quantity']) => void;
  onClose: () => void;
}

/** Accessible quantity picker used after a player chooses a crafting recipe. */
export function CraftingQuantityDialog({
  itemLabel,
  choices,
  busy = false,
  onSelect,
  onClose,
}: CraftingQuantityDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const supportsNativeModal = typeof dialog.showModal === 'function';
    if (supportsNativeModal) dialog.showModal();
    else dialog.setAttribute('open', '');
    return () => {
      if (supportsNativeModal && dialog.open) dialog.close();
      else dialog.removeAttribute('open');
    };
  }, []);

  return (
    <dialog
      ref={dialogRef}
      className="mudd-interaction-options-dialog"
      aria-labelledby="mudd-crafting-quantity-title"
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
            <h2 id="mudd-crafting-quantity-title">How many?</h2>
            <p>{itemLabel}</p>
          </div>
          <Button type="button" variant="quiet" onClick={onClose} disabled={busy}>
            Close
          </Button>
        </header>
        <div className="mudd-interaction-options__list" role="group" aria-label={`Crafting quantity for ${itemLabel}`}>
          {choices.map(({ quantity, disabled }) => (
            <Button
              key={quantity}
              type="button"
              variant="secondary"
              className="mudd-interaction-options__action"
              disabled={busy || disabled}
              onClick={() => onSelect(quantity)}
            >
              {itemLabel} ×{quantity}
            </Button>
          ))}
        </div>
      </section>
    </dialog>
  );
}
