import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => { vi.unstubAllEnvs(); vi.resetModules(); });
describe('entry routes under a mounted application', () => {
  it('keeps links/auth returns under the app base without accepting outside destinations', async () => {
    vi.stubEnv('BASE_URL', '/mudd/');
    const { appHref, worldPath, playPath, characterPath, safeEntryIntent, rememberEntryIntent, entryIntent } = await import('./navigation.js');
    expect(appHref(worldPath('world'))).toBe('/mudd/worlds/world');
    expect(appHref(playPath('world'))).toBe('/mudd/worlds/world/play');
    expect(appHref(characterPath('character/id'))).toBe('/mudd/character/character%2Fid');
    rememberEntryIntent('/worlds/world?create=1');
    expect(appHref(entryIntent())).toBe('/mudd/worlds/world?create=1');
    for (const invalid of ['https://evil.test', '//evil.test', '/worlds/world/play', '/worlds/../sign-out', '/worlds/world?redirect=https://evil.test']) {
      expect(safeEntryIntent(invalid)).toBe('/');
    }
  });
});
