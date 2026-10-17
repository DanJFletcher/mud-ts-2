import { Text } from './Text.js';

export interface RoomExit {
  id: string;
  label: string;
  direction?: string;
  available: boolean;
}

export interface RoomDescriptionProps {
  title: string;
  description: string;
  exits: readonly RoomExit[];
}

export function RoomDescription({ title, description, exits }: RoomDescriptionProps) {
  return (
    <article className="mudd-room" aria-labelledby="mudd-room-title">
      <p className="mudd-text mudd-text--eyebrow">Current location</p>
      <h1 className="mudd-room__title" id="mudd-room-title">{title}</h1>
      <Text className="mudd-room__description">{description}</Text>
      <div className="mudd-room__exits" aria-label="Available exits">
        {exits.map((exit) => (
          <span className="mudd-room__exit" key={exit.id}>
            <span aria-hidden="true">{exit.direction ? `${exit.direction} · ` : ''}</span>
            {exit.label}
          </span>
        ))}
      </div>
    </article>
  );
}
