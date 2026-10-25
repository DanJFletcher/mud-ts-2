import type { SessionContext } from '@mudd/contracts';

export type CharacterOwnershipLookup = (playerId: string, characterId: string) => Promise<boolean>;

/**
 * Active world contexts are already bound to a character selected from a
 * player-owned world session. Keep the database ownership lookup for contexts
 * that are not bound to an active character, such as character management.
 */
export function createCharacterOwnershipCheck(lookup: CharacterOwnershipLookup) {
  return async (session: SessionContext, characterId: string): Promise<boolean> => {
    if (session.selectedCharacterId !== undefined) {
      return session.selectedCharacterId === characterId;
    }
    return lookup(session.playerId, characterId);
  };
}
