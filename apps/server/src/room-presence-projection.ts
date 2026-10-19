import type { CharacterProjection, RoomOccupantProjection } from '@mudd/contracts';

export const ROOM_PRESENCE_TTL_MS = 90_000;

export type RoomPresenceCandidate = Readonly<{
  worldInstanceId: string;
  characterId: string;
  lastSeenAt: Date;
  character: Pick<
    CharacterProjection,
    'worldInstanceId' | 'characterId' | 'name' | 'locationId' | 'archived' | 'health' | 'combat'
  > | undefined;
}>;

export function projectRoomOccupants(input: Readonly<{
  candidates: readonly RoomPresenceCandidate[];
  worldInstanceId: string;
  locationId: string;
  viewerCharacterId: string;
  now?: Date;
}>): readonly RoomOccupantProjection[] {
  const onlineAfter = (input.now ?? new Date()).getTime() - ROOM_PRESENCE_TTL_MS;
  const occupants = new Map<string, RoomOccupantProjection>();

  for (const candidate of input.candidates) {
    const character = candidate.character;
    if (
      candidate.worldInstanceId !== input.worldInstanceId ||
      candidate.characterId === input.viewerCharacterId ||
      candidate.lastSeenAt.getTime() < onlineAfter ||
      !character ||
      character.worldInstanceId !== input.worldInstanceId ||
      character.characterId !== candidate.characterId ||
      character.locationId !== input.locationId ||
      character.archived ||
      character.health?.current === 0 ||
      character.combat?.status === 'defeat'
    ) {
      continue;
    }

    occupants.set(character.characterId, {
      id: character.characterId,
      displayName: character.name,
    });
  }

  return [...occupants.values()].sort((left, right) =>
    left.displayName.localeCompare(right.displayName) || left.id.localeCompare(right.id),
  );
}
