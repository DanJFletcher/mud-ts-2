import { useCallback, useEffect, useState } from 'react';
import { useUser } from '@clerk/react';
import { MuddHttpClient, MuddHttpError, type CharacterRosterSnapshot, type WorldSummary } from '@mudd/client-sdk';
import { basePath, playPath } from './navigation.js';

export const worldClient = (worldInstanceId = 'mudd-demo-instance') => new MuddHttpClient({ worldInstanceId, basePath });
export type LobbyCharacter = CharacterRosterSnapshot['characters'][number];
export const entryDisabled = (character: LobbyCharacter) => Boolean(
  character.archived || character.combat?.status === 'defeat' || character.health?.current === 0,
);
export function sortCharactersByActivity(characters: LobbyCharacter[]) {
  return characters.slice().sort((a, b) =>
    (b.lastPlayedAt ? Date.parse(b.lastPlayedAt) : 0) - (a.lastPlayedAt ? Date.parse(a.lastPlayedAt) : 0)
    || a.name.localeCompare(b.name),
  );
}
export function recentCharacters(characters: LobbyCharacter[]) {
  return sortCharactersByActivity(characters.filter((character) => !character.archived));
}

/** Refreshes authoritative roster/session state before joining, and never switches an occupied world implicitly. */
export async function enterCharacter(
  characterId: string,
  characterWorld: string,
  refreshRoster: () => Promise<Awaited<ReturnType<ReturnType<typeof worldClient>['getCharacters']>> | null>,
  onSwitchRequired: (character: LobbyCharacter) => void,
  navigate: (path: string) => void,
) {
  const fresh = await refreshRoster();
  const character = fresh?.characters.find((item) => item.characterId === characterId && item.worldInstanceId === characterWorld);
  if (!character || entryDisabled(character)) throw new Error('That character is unavailable. Refresh your characters and choose another.');
  const occupied = fresh?.activeWorldSessions?.find((session) => session.worldInstanceId === characterWorld);
  if (occupied && occupied.characterId !== characterId) { onSwitchRequired(character); return; }
  try {
    await worldClient(characterWorld).joinWorld(characterId);
  } catch (failure) {
    const latest = await refreshRoster().catch(() => null);
    const occupiedNow = latest?.activeWorldSessions?.find((session) => session.worldInstanceId === characterWorld);
    if (occupiedNow && occupiedNow.characterId !== characterId) { onSwitchRequired(character); return; }
    throw failure;
  }
  localStorage.setItem('mudd-world-instance-id', characterWorld);
  window.location.hash = '/play';
  navigate(playPath(characterWorld));
}

export function useLobby({ skipCatalog = false }: { skipCatalog?: boolean } = {}) {
  const { isLoaded, isSignedIn } = useUser();
  const [worlds, setWorlds] = useState<WorldSummary[]>([]);
  const [roster, setRoster] = useState<CharacterRosterSnapshot | null>(null);
  const [anonymous, setAnonymous] = useState(false);
  const [catalogLoading, setCatalogLoading] = useState(!skipCatalog);
  const [rosterLoading, setRosterLoading] = useState(true);
  const [catalogError, setCatalogError] = useState('');
  const [rosterError, setRosterError] = useState('');
  const loadCatalog = useCallback(async () => {
    if (skipCatalog) {
      setCatalogLoading(false);
      return;
    }
    setCatalogLoading(true);
    try {
      const result = await worldClient().getWorlds();
      setWorlds(result);
      setCatalogError('');
    } catch (error) {
      setCatalogError(error instanceof Error ? error.message : 'Could not load worlds.');
    } finally {
      setCatalogLoading(false);
    }
  }, [skipCatalog]);
  const refreshRoster = useCallback(async () => {
    setRosterLoading(true);
    try {
      const result = await worldClient().getCharacters();
      setRoster(result); setAnonymous(false); setRosterError('');
      return result;
    } catch (error) {
      if (error instanceof MuddHttpError && error.status === 401) {
        setRoster(null); setAnonymous(true); setRosterError(''); return null;
      }
      setRosterError(error instanceof Error ? error.message : 'Could not load your characters.');
      throw error;
    } finally {
      setRosterLoading(false);
    }
  }, []);
  const reload = useCallback(async () => {
    await Promise.all([loadCatalog(), refreshRoster().catch(() => undefined)]);
  }, [loadCatalog, refreshRoster]);
  useEffect(() => { void loadCatalog(); }, [loadCatalog]);
  useEffect(() => {
    if (isLoaded) void refreshRoster().catch(() => undefined);
  }, [isLoaded, isSignedIn, refreshRoster]);
  return {
    worlds,
    roster,
    anonymous,
    loading: catalogLoading || rosterLoading,
    catalogLoading,
    rosterLoading,
    catalogError,
    rosterError,
    refreshRoster,
    reload,
    isSignedIn,
  };
}
