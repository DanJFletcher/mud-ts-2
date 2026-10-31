import type { CapabilityToken } from '@mudd/contracts';
import type { EventStorePort } from '@mudd/engine-core';

export type ActiveRoomCharacter = Readonly<{
  playerId: string;
  characterId: string;
  displayName: string;
}>;

export interface CombatRoomPresenceCapability {
  listActiveCharacters(
    context: Readonly<{
      worldInstanceId: string;
      store: Pick<EventStorePort, 'readStream'>;
    }>,
    locationId: string,
  ): Promise<readonly ActiveRoomCharacter[]>;
  getPresenceAnchors(
    worldInstanceId: string,
    characterIds: readonly string[],
  ): Promise<ReadonlyMap<string, Date>>;
}

export const combatRoomPresenceCapability = Object.freeze({
  id: 'mudd.combat.room-presence.v1',
  version: '1',
}) satisfies CapabilityToken<CombatRoomPresenceCapability>;
