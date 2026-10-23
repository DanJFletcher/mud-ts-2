import { describe, expect, it, vi } from 'vitest';
import { CharacterRosterSnapshotSchema, MuddHttpClient, MuddHttpError, WorldListSchema } from './index.js';

describe('lobby transport compatibility', () => {
  it('accepts older catalog/roster payloads and optional account-owned recency', () => {
    expect(WorldListSchema.parse([{ worldInstanceId: 'w', packId: 'p', name: 'World', summary: 'Summary' }])[0].introduction).toBeUndefined();
    const roster = { player: { id: '11111111-1111-4111-8111-111111111111', displayName: 'Traveler' }, characters: [], activeWorldSession: null };
    expect(CharacterRosterSnapshotSchema.parse(roster).activeWorldSessions).toBeUndefined();
  });
  it('mounts catalog, entry and leave requests under a same-origin base path', async () => {
    const characterId = '11111111-1111-4111-8111-111111111111';
    const fetcher = vi.fn().mockResolvedValueOnce(new Response('[]'))
      .mockResolvedValueOnce(new Response(JSON.stringify({ characterId, sessionId: characterId })))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    const client = new MuddHttpClient({ worldInstanceId: 'world', basePath: '/mudd/', fetcher });
    await client.getWorlds(); await client.joinWorld(characterId); await client.leaveWorld();
    expect(fetcher.mock.calls.map(([path]) => path)).toEqual(['/mudd/api/worlds', '/mudd/api/world-session', '/mudd/api/world-session']);
    expect(fetcher.mock.calls[2][1].headers['x-mudd-world-instance']).toBe('world');
  });
  it('preserves status codes so authentication failures are not confused with outages', async () => {
    const client = new MuddHttpClient({ worldInstanceId: 'world',
      fetcher: vi.fn().mockResolvedValue(new Response(JSON.stringify({ message: 'Sign in' }), { status: 401 })) });
    await expect(client.getCharacters()).rejects.toEqual(expect.objectContaining({ status: 401, message: 'Sign in' }));
    await expect(client.getCharacters()).rejects.toBeInstanceOf(MuddHttpError);
  });
});
