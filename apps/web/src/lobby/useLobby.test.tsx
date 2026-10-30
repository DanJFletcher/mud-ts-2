import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CharacterRosterSnapshot } from '@mudd/client-sdk';
import type { LobbyCharacter } from './useLobby.js';

const sdk = vi.hoisted(() => ({
  getWorlds: vi.fn(),
  getCharacters: vi.fn(),
  joinWorld: vi.fn(),
  leaveWorld: vi.fn(),
}));

vi.mock('@clerk/react', () => ({
  useUser: () => ({ isLoaded: true, isSignedIn: false }),
}));

vi.mock('@mudd/client-sdk', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@mudd/client-sdk')>();
  return {
    ...actual,
    MuddHttpClient: class {
      getWorlds = sdk.getWorlds;
      getCharacters = sdk.getCharacters;
      joinWorld = sdk.joinWorld;
      leaveWorld = sdk.leaveWorld;
    },
  };
});

import { enterCharacter, useLobby } from './useLobby.js';

const character = {
  characterId: 'traveler-1',
  worldInstanceId: 'world-1',
  name: 'Arin',
  archived: false,
  inventory: [],
} as unknown as LobbyCharacter;

function roster(
  characters: LobbyCharacter[] = [character],
  activeCharacterId?: string,
): CharacterRosterSnapshot {
  return {
    player: { id: 'player-1', displayName: 'Arin' },
    characters,
    activeWorldSession: activeCharacterId
      ? { id: 'session-1', characterId: activeCharacterId }
      : null,
    activeWorldSessions: activeCharacterId
      ? [{ worldInstanceId: 'world-1', id: 'session-1', characterId: activeCharacterId }]
      : [],
  };
}

describe('lobby character entry', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    window.location.hash = '';
    sdk.getWorlds.mockResolvedValue([]);
    sdk.getCharacters.mockResolvedValue(roster());
    sdk.joinWorld.mockResolvedValue(undefined);
    sdk.leaveWorld.mockResolvedValue(undefined);
  });

  it('rejects entry when the refreshed roster no longer contains the character', async () => {
    await expect(enterCharacter(
      character.characterId,
      character.worldInstanceId,
      async () => roster([]),
      vi.fn(),
      vi.fn(),
    )).rejects.toThrow('That character is unavailable.');
    expect(sdk.joinWorld).not.toHaveBeenCalled();
  });

  it('asks before switching away from a different active character', async () => {
    const onSwitchRequired = vi.fn();
    await enterCharacter(
      character.characterId,
      character.worldInstanceId,
      async () => roster([character], 'another-character'),
      onSwitchRequired,
      vi.fn(),
    );

    expect(onSwitchRequired).toHaveBeenCalledWith(character);
    expect(sdk.joinWorld).not.toHaveBeenCalled();
  });

  it('rechecks the roster after a failed join and asks to switch if another session appeared', async () => {
    const onSwitchRequired = vi.fn();
    const refreshRoster = vi.fn()
      .mockResolvedValueOnce(roster())
      .mockResolvedValueOnce(roster([character], 'another-character'));
    sdk.joinWorld.mockRejectedValueOnce(new Error('Session already active.'));

    await enterCharacter(
      character.characterId,
      character.worldInstanceId,
      refreshRoster,
      onSwitchRequired,
      vi.fn(),
    );

    expect(refreshRoster).toHaveBeenCalledTimes(2);
    expect(onSwitchRequired).toHaveBeenCalledWith(character);
  });

  it('preserves the original join error when the follow-up roster refresh also fails', async () => {
    const joinFailure = new Error('Join request failed.');
    const refreshRoster = vi.fn()
      .mockResolvedValueOnce(roster())
      .mockRejectedValueOnce(new Error('Roster unavailable.'));
    sdk.joinWorld.mockRejectedValueOnce(joinFailure);

    await expect(enterCharacter(
      character.characterId,
      character.worldInstanceId,
      refreshRoster,
      vi.fn(),
      vi.fn(),
    )).rejects.toBe(joinFailure);
  });

  it('persists the selected world and navigates after a successful join', async () => {
    const navigate = vi.fn();
    await enterCharacter(
      character.characterId,
      character.worldInstanceId,
      async () => roster(),
      vi.fn(),
      navigate,
    );

    expect(sdk.joinWorld).toHaveBeenCalledWith(character.characterId);
    expect(localStorage.getItem('mudd-world-instance-id')).toBe(character.worldInstanceId);
    expect(window.location.hash).toBe('#/play');
    expect(navigate).toHaveBeenCalledWith('/worlds/world-1/play');
  });

  it('reloads the roster without fetching a catalog when the catalog is skipped', async () => {
    const { result } = renderHook(() => useLobby({ skipCatalog: true }));
    await waitFor(() => expect(result.current.roster).not.toBeNull());
    expect(result.current.catalogLoading).toBe(false);
    expect(sdk.getWorlds).not.toHaveBeenCalled();

    await act(async () => { await result.current.reload(); });

    expect(sdk.getCharacters).toHaveBeenCalledTimes(2);
    expect(sdk.getWorlds).not.toHaveBeenCalled();
  });
});
