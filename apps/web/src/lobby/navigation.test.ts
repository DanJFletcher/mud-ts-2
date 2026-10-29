import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => { vi.unstubAllEnvs(); vi.resetModules(); });
describe('entry routes under a mounted application', () => {
  it('keeps links/auth returns under the app base without accepting outside destinations', async () => {
    vi.stubEnv('BASE_URL', '/mudd/');
    const { appHref, worldPath, playPath, worldCharactersPath, characterPath, safeEntryIntent, rememberEntryIntent, entryIntent } = await import('./navigation.js');
    expect(appHref(worldPath('world'))).toBe('/mudd/worlds/world');
    expect(appHref(playPath('world'))).toBe('/mudd/worlds/world/play');
    expect(appHref(worldCharactersPath('world'))).toBe('/mudd/worlds/world/characters');
    expect(appHref(characterPath('world/id', 'character/id'))).toBe('/mudd/worlds/world%2Fid/characters/character%2Fid');
    rememberEntryIntent('/worlds');
    expect(appHref(entryIntent())).toBe('/mudd/worlds');
    rememberEntryIntent('/worlds/world?create=1');
    expect(appHref(entryIntent())).toBe('/mudd/worlds/world?create=1');
    for (const invalid of ['https://evil.test', '//evil.test', '/worlds/world/play', '/worlds/../sign-out', '/worlds/world?redirect=https://evil.test']) {
      expect(safeEntryIntent(invalid)).toBe('/');
    }
  });
});
