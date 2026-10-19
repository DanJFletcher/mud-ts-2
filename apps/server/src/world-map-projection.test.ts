import { describe, expect, it } from 'vitest';
import { EngineHost, InMemoryEventStore, replayCharacter } from '@mudd/engine-core';
import { characterPlugin, combatPlugin, interactionPlugin, merchantPlugin, movementPlugin } from '@mudd/core-plugins';
import { DEMO_WORLD_INSTANCE_ID, demoWorld } from '@mudd/world-demo';
import { MuddHttpClient } from '@mudd/client-sdk';
import { projectWorldMap } from './world-map-projection.js';

const session = {
  sessionId: 'world-map-session',
  playerId: 'world-map-player',
  actorId: 'world-map-player',
  worldInstanceId: DEMO_WORLD_INSTANCE_ID,
  grantedPermissions: [],
  authenticated: true,
} as const;

describe('visited world map projection', () => {
  it('reveals Willowrest Inn and its Reedbank connection only after the traveler arrives', async () => {
    const store = new InMemoryEventStore();
    const engine = new EngineHost(
      [characterPlugin, combatPlugin, interactionPlugin, merchantPlugin, movementPlugin],
      store,
      { canAccessInstance: async () => true, ownsCharacter: async () => true },
      demoWorld,
    );
    const ready = engine.start();
    const activeCharacter: { id?: string } = {};
    const fetcher: typeof fetch = async (input, init = {}) => {
      await ready;
      const path = String(input);
      if (path === '/api/game') {
        if (!activeCharacter.id) throw new Error('Create a character before requesting the game snapshot.');
        const character = replayCharacter(await store.readStream(DEMO_WORLD_INSTANCE_ID, activeCharacter.id));
        if (!character) throw new Error('The character stream is missing.');
        return Response.json({
          player: { id: session.playerId, displayName: 'Traveler' },
          character,
          map: projectWorldMap(character),
        });
      }

      const body = JSON.parse(String(init.body ?? '{}')) as unknown;
      return Response.json(path.endsWith('/commands')
        ? await engine.dispatch(body, session)
        : await engine.query(body, session));
    };
    const client = new MuddHttpClient({ worldInstanceId: DEMO_WORLD_INSTANCE_ID, fetcher });
    const created = await client.createCharacter('Briar', 'map-journey-create');
    activeCharacter.id = created.streamId!;

    const initialSnapshot = await client.getGame();
    expect(initialSnapshot.map?.locations.map(({ id }) => id)).toContain('mossgate-clearing');
    expect(initialSnapshot.map?.locations.map(({ id }) => id)).not.toContain('willowrest-inn');

    let character = replayCharacter(await store.readStream(DEMO_WORLD_INSTANCE_ID, activeCharacter.id))!;
    for (const [index, exitId] of ['clearing-to-bridge', 'bridge-to-reedbank'].entries()) {
      await client.move(activeCharacter.id, exitId, character.revision, `map-journey-to-reedbank-${index}`);
      character = replayCharacter(await store.readStream(DEMO_WORLD_INSTANCE_ID, activeCharacter.id))!;
    }

    const reedbankSnapshot = await client.getGame();
    expect(reedbankSnapshot.map?.currentLocationId).toBe('reedbank-stalls');
    expect(reedbankSnapshot.map?.locations.map(({ id }) => id)).toContain('reedbank-stalls');
    expect(reedbankSnapshot.map?.locations.map(({ id }) => id)).not.toContain('willowrest-inn');
    expect(reedbankSnapshot.map?.connections).not.toContainEqual({
      fromLocationId: 'reedbank-stalls',
      toLocationId: 'willowrest-inn',
    });

    await client.move(activeCharacter.id, 'reedbank-to-willowrest', character.revision, 'map-journey-to-willowrest');
    const innSnapshot = await client.getGame();
    expect(innSnapshot.map?.currentLocationId).toBe('willowrest-inn');
    expect(innSnapshot.map?.locations).toContainEqual({
      id: 'willowrest-inn',
      name: 'Willowrest Inn',
      x: 2,
      y: 2,
    });
    expect(innSnapshot.map?.connections).toContainEqual({
      fromLocationId: 'reedbank-stalls',
      toLocationId: 'willowrest-inn',
    });
  });
});
