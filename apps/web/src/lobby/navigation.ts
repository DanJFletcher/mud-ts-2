export const basePath = import.meta.env.BASE_URL.replace(/\/$/, '');
export const appHref = (path: string) => `${basePath}${path}`;
export const worldPath = (id: string) => `/worlds/${encodeURIComponent(id)}`;
export const playPath = (id: string) => `${worldPath(id)}/play`;
export const worldCharactersPath = (worldId: string) => `${worldPath(worldId)}/characters`;
export const characterPath = (worldId: string, characterId: string) =>
  `${worldCharactersPath(worldId)}/${encodeURIComponent(characterId)}`;
const intentKey = 'mudd-entry-intent';

/** Only browsing/creation destinations, never external URLs or auto-play. */
export function safeEntryIntent(value: string | null): string {
  return value && (/^\/worlds$/.test(value) || /^\/worlds\/[a-zA-Z0-9_-]+(?:\?create=1)?$/.test(value)) ? value : '/';
}
export function rememberEntryIntent(path: string) {
  sessionStorage.setItem(intentKey, safeEntryIntent(path));
}
export function entryIntent() {
  return safeEntryIntent(sessionStorage.getItem(intentKey));
}
