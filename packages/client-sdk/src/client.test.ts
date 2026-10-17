import { describe, expect, it } from 'vitest';
import { MuddHttpClient } from './index.js';
import { EngineHost, InMemoryEventStore } from '@mudd/engine-core';
import { characterPlugin, movementPlugin } from '@mudd/core-plugins';
import { DEMO_WORLD_INSTANCE_ID, demoWorld } from '@mudd/world-demo';

describe('MuddHttpClient', () => {
  it('sends Zod-validated commands and queries to the authoritative engine', async () => {
    const session = {
      sessionId: 'session-1',
      playerId: 'player-1',
      actorId: 'player-1',
      worldInstanceId: DEMO_WORLD_INSTANCE_ID,
      grantedPermissions: [],
      authenticated: true,
    } as const;
    const engine = new EngineHost(
      [characterPlugin, movementPlugin],
      new InMemoryEventStore(),
      { canAccessInstance: async () => true, ownsCharacter: async () => true },
      demoWorld,
    );
    await engine.start();
    const fetcher: typeof fetch = async (input, init = {}) => {
      const path = String(input);
      const body = JSON.parse(String(init.body ?? '{}')) as unknown;
      const result = path.endsWith('/commands')
        ? await engine.dispatch(body, session)
        : await engine.query(body, session);
      return Response.json(result);
    };
    const client = new MuddHttpClient({ worldInstanceId: DEMO_WORLD_INSTANCE_ID, fetcher });
    const created = await client.createCharacter('Fern', 'sdk-create');
    expect(created.receipt.ok).toBe(true);
    const characterId = created.streamId!;
    const firstRoom = await client.look(characterId, 'sdk-look-1');
    expect(firstRoom.title).toBe('Mossgate Clearing');
    expect(firstRoom.description).toContain('One loose stone bears a pale stripe.');
    expect(firstRoom.objects).toEqual([
      {
        id: 'mossgate-marker',
        label: 'Weathered marker',
        description: 'A weathered stone marker, its carved arrow worn but still pointing east.',
        readable: true,
        takeable: false,
      },
      {
        id: 'mossgate-loose-stone',
        label: 'Loose stone',
        description: 'A smooth, palm-sized stone with a pale stripe running through it.',
        readable: false,
        takeable: true,
      },
    ]);
    const marker = await client.read(characterId, 'mossgate-marker', 'sdk-read');
    expect(marker).toEqual({
      id: 'mossgate-marker',
      label: 'Weathered marker',
      text: 'OLD BELL TOWER — EAST',
    });
    await expect(client.read(characterId, 'unknown-object', 'sdk-read-missing'))
      .rejects.toThrow('That object is not readable from here.');
    const taken = await client.take(characterId, 'mossgate-loose-stone', firstRoom.revision, 'sdk-take');
    expect(taken.receipt).toMatchObject({ ok: true, newAggregateVersion: 2 });
    await expect(client.inspect(characterId, 'mossgate-loose-stone', 'sdk-inspect-carried'))
      .resolves.toEqual({
        id: 'mossgate-loose-stone',
        label: 'Loose stone',
        description: 'A smooth, palm-sized stone with a pale stripe running through it.',
      });
    const afterTake = await client.look(characterId, 'sdk-look-after-take');
    expect(afterTake.revision).toBe(2);
    expect(afterTake.objects).not.toContainEqual(expect.objectContaining({ id: 'mossgate-loose-stone' }));
    expect(afterTake.description).not.toContain('One loose stone bears a pale stripe.');
    const dropped = await client.drop(characterId, 'mossgate-loose-stone', afterTake.revision, 'sdk-drop');
    expect(dropped.receipt).toMatchObject({ ok: true, newAggregateVersion: 3 });
    const afterDrop = await client.look(characterId, 'sdk-look-after-drop');
    expect(afterDrop.description).toContain('One loose stone bears a pale stripe.');
    expect(afterDrop.objects).toContainEqual(expect.objectContaining({
      id: 'mossgate-loose-stone',
      takeable: true,
    }));
    const takenAgain = await client.take(characterId, 'mossgate-loose-stone', afterDrop.revision, 'sdk-take-again');
    expect(takenAgain.receipt).toMatchObject({ ok: true, newAggregateVersion: 4 });
    const moved = await client.move(characterId, 'clearing-to-bridge', 4, 'sdk-move');
    expect(moved.receipt.ok).toBe(true);
    const nextRoom = await client.look(characterId, 'sdk-look-2');
    expect(nextRoom.title).toBe('Glasswater Bridge');
    await expect(client.inspect(characterId, 'mossgate-loose-stone', 'sdk-inspect-carried-away'))
      .resolves.toMatchObject({ id: 'mossgate-loose-stone', label: 'Loose stone' });
    await expect(client.inspect(characterId, 'mossgate-marker', 'sdk-inspect-unavailable'))
      .rejects.toThrow('That object is not here or in your pack.');
    await expect(client.read(characterId, 'mossgate-marker', 'sdk-read-from-bridge'))
      .rejects.toThrow('That object is not readable from here.');
    await engine.stop();
  });
});
