import { Button } from './Button.js';
import type { RoomExit } from './RoomDescription.js';

export interface NavigationControlsProps {
  exits: readonly RoomExit[];
  onMove: (exitId: string) => void;
  onAmbiguousDirection?: (direction: NavigationDirection) => void;
  disabled?: boolean;
  pendingExitId?: string;
}

export type NavigationDirection = 'north' | 'east' | 'south' | 'west' | 'up' | 'down';

const DIRECTIONS: readonly Readonly<{ id: NavigationDirection; label: string; area: string }>[] = [
  { id: 'west', label: 'West', area: 'west' },
  { id: 'north', label: 'North', area: 'north' },
  { id: 'south', label: 'South', area: 'south' },
  { id: 'east', label: 'East', area: 'east' },
  { id: 'up', label: 'Up', area: 'up' },
  { id: 'down', label: 'Down', area: 'down' },
];

function getExitDirection(exit: RoomExit): NavigationDirection | undefined {
  const value = (exit.direction || exit.label).trim().toLocaleLowerCase();
  return DIRECTIONS.find((direction) => direction.id === value)?.id;
}

export function NavigationControls({
  exits,
  onMove,
  onAmbiguousDirection,
  disabled = false,
  pendingExitId,
}: NavigationControlsProps) {
  const renderDirection = (direction: typeof DIRECTIONS[number]) => {
    const matchingExits = exits.filter((exit) => getExitDirection(exit) === direction.id);
    const availableExits = matchingExits.filter((exit) => exit.available);
    const exit = availableExits[0];
    const available = availableExits.length > 0;
    const ambiguous = availableExits.length > 1;
    const pending = matchingExits.some((candidate) => candidate.id === pendingExitId);
    const directionDisabled = disabled || !available || (ambiguous && !onAmbiguousDirection);

    return (
      <Button
        key={direction.id}
        type="button"
        variant="secondary"
        className={`mudd-navigation__direction mudd-navigation__direction--${direction.area}${available ? ' mudd-navigation__direction--available' : ''}`}
        disabled={directionDisabled}
        aria-busy={pending}
        aria-label={ambiguous ? `${direction.label}, choose a destination` : direction.label}
        title={ambiguous ? `Choose a ${direction.label.toLocaleLowerCase()} exit` : available ? `Go ${direction.label.toLocaleLowerCase()}` : `${direction.label} is unavailable`}
        data-direction={direction.id}
        data-available={available}
        onClick={() => {
          if (ambiguous) onAmbiguousDirection?.(direction.id);
          else if (exit) onMove(exit.id);
        }}
      >
        {direction.label}
      </Button>
    );
  };

  return (
    <nav className="mudd-navigation" aria-label="Quick navigation">
      <div className="mudd-navigation__cardinal" role="group" aria-label="Cardinal directions">
        {DIRECTIONS.filter((direction) => ['west', 'north', 'south', 'east'].includes(direction.id)).map(renderDirection)}
      </div>
      <div className="mudd-navigation__vertical" role="group" aria-label="Vertical directions">
        {DIRECTIONS.filter((direction) => direction.id === 'up' || direction.id === 'down').map(renderDirection)}
      </div>
    </nav>
  );
}
