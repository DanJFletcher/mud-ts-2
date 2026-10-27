import { useEffect, useRef } from 'react';
import { Button } from './Button.js';

export interface NpcDialogueChoice {
  id: string;
  label: string;
}

export interface NpcDialogueDialogProps {
  npcName: string;
  dialogue: string;
  choices: readonly NpcDialogueChoice[];
  farewellLabel: string;
  busy?: boolean;
  onSelect: (choiceId: string) => void;
  onClose: () => void;
}

/** Presents a private NPC conversation and its currently available replies. */
export function NpcDialogueDialog({
  npcName,
  dialogue,
  choices,
  farewellLabel,
  busy = false,
  onSelect,
  onClose,
}: NpcDialogueDialogProps) {
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

  const dismiss = () => {
    if (!busy) onClose();
  };

  return (
    <dialog
      ref={dialogRef}
      className="mudd-npc-dialogue-dialog"
      aria-labelledby="mudd-npc-dialogue-title"
      aria-describedby="mudd-npc-dialogue-text"
      aria-modal="true"
      onCancel={(event) => {
        event.preventDefault();
        dismiss();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) dismiss();
      }}
    >
      <section className="mudd-npc-dialogue">
        <header className="mudd-npc-dialogue__header">
          <h2 id="mudd-npc-dialogue-title">Conversation with {npcName}</h2>
          <Button type="button" variant="quiet" onClick={dismiss} disabled={busy}>
            Close conversation
          </Button>
        </header>
        <div className="mudd-npc-dialogue__speech" id="mudd-npc-dialogue-text">
          <p className="mudd-npc-dialogue__speaker">{npcName}</p>
          <p>{dialogue}</p>
        </div>
        {choices.length ? (
          <div
            className="mudd-npc-dialogue__choices"
            role="group"
            aria-label={`${npcName} response options`}
          >
            {choices.map((choice) => (
              <Button
                key={choice.id}
                type="button"
                variant="secondary"
                className="mudd-npc-dialogue__choice"
                disabled={busy}
                onClick={() => onSelect(choice.id)}
              >
                {choice.label}
              </Button>
            ))}
          </div>
        ) : (
          <p className="mudd-npc-dialogue__end">The conversation has ended.</p>
        )}
        <div
          className="mudd-npc-dialogue__farewells"
          role="group"
          aria-label="End conversation"
        >
          <Button type="button" variant="secondary" onClick={dismiss} disabled={busy}>
            {farewellLabel}
          </Button>
        </div>
      </section>
    </dialog>
  );
}
