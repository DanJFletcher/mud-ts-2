import { Button } from './Button.js';
import type { RoomExit } from './RoomDescription.js';

export interface NavigationControlsProps {
  exits: readonly RoomExit[];
  onMove: (exitId: string) => void;
  disabled?: boolean;
  pendingExitId?: string;
}

export function NavigationControls({ exits, onMove, disabled = false, pendingExitId }: NavigationControlsProps) {
  return (
    <nav className="mudd-navigation" aria-label="Move to another location">
      {exits.map((exit) => (
        <Button
          key={exit.id}
          type="button"
          variant="secondary"
          disabled={disabled || !exit.available}
          aria-busy={pendingExitId === exit.id}
          onClick={() => onMove(exit.id)}
        >
          {pendingExitId === exit.id ? 'Moving…' : exit.label}
        </Button>
      ))}
    </nav>
  );
}
