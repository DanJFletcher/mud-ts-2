import { describe, expect, it, vi } from 'vitest';
import { createCharacterOwnershipCheck } from './character-authorization.js';

const baseSession = {
  sessionId: 'session-1',
  playerId: 'player-1',
  actorId: 'player-1',
  worldInstanceId: 'world-1',
  grantedPermissions: [],
  authenticated: true,
};

describe('character ownership authorization', () => {
  it('uses the character bound to the active world session without another lookup', async () => {
    const lookup = vi.fn(async () => false);
    const ownsCharacter = createCharacterOwnershipCheck(lookup);
    const session = { ...baseSession, selectedCharacterId: 'character-1' };

    await expect(ownsCharacter(session, 'character-1')).resolves.toBe(true);
    await expect(ownsCharacter(session, 'character-2')).resolves.toBe(false);
    expect(lookup).not.toHaveBeenCalled();
  });

  it('retains the database ownership lookup when no character is bound to the session', async () => {
    const lookup = vi.fn(async (playerId: string, characterId: string) =>
      playerId === 'player-1' && characterId === 'character-1');
    const ownsCharacter = createCharacterOwnershipCheck(lookup);

    await expect(ownsCharacter(baseSession, 'character-1')).resolves.toBe(true);
    await expect(ownsCharacter(baseSession, 'character-2')).resolves.toBe(false);
    expect(lookup).toHaveBeenCalledTimes(2);
  });
});
