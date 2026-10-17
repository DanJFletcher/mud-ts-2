import type { StoredGameEvent } from './types.js';
import { CharacterProjectionSchema, CharacterCreatedEventSchema, CharacterMovedEventSchema } from '@mudd/contracts';

export function replayCharacter(events: readonly StoredGameEvent[]) {
  let state: ReturnType<typeof CharacterProjectionSchema.parse> | undefined;

  for (const event of events) {
    const { streamId: _streamId, ...publicEvent } = event;
    if (event.type === 'character.created') {
      const created = CharacterCreatedEventSchema.parse(publicEvent);
      state = CharacterProjectionSchema.parse({
        worldInstanceId: event.worldInstanceId,
        characterId: created.payload.characterId,
        name: created.payload.name,
        locationId: created.payload.startingLocationId,
        revision: event.aggregateVersion,
      });
    } else if (event.type === 'character.moved') {
      if (!state) throw new Error('Movement event encountered before character creation.');
      const moved = CharacterMovedEventSchema.parse(publicEvent);
      if (moved.payload.characterId !== state.characterId || moved.payload.fromLocationId !== state.locationId) {
        throw new Error(`Invalid movement event at revision ${event.aggregateVersion}.`);
      }
      state = CharacterProjectionSchema.parse({
        ...state,
        locationId: moved.payload.toLocationId,
        revision: event.aggregateVersion,
      });
    }
  }
  return state;
}
