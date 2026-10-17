import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { EngineHost, InMemoryEventStore, replayCharacter, type EnginePlugin } from './index.js';
import { characterPlugin, movementPlugin } from '@mudd/core-plugins';
import { DEMO_WORLD_INSTANCE_ID, demoWorld } from '@mudd/world-demo';

const session = {
  sessionId: 'session-1',
  playerId: 'player-1',
  actorId: 'player-1',
  worldInstanceId: DEMO_WORLD_INSTANCE_ID,
  grantedPermissions: [],
  authenticated: true,
} as const;
const authorization = {
  canAccessInstance: async () => true,
  ownsCharacter: async () => true,
};

function makeEngine() {
  let id = 0;
  const store = new InMemoryEventStore();
  const engine = new EngineHost(
    [movementPlugin, characterPlugin],
    store,
    authorization,
    demoWorld,
    () => `test-id-${++id}`,
    () => new Date('2026-10-17T12:00:00.000Z'),
  );
  return { engine, store };
}

describe('MUDD engine host', () => {
  it('registers typed commands and capabilities before initializing a plugin', async () => {
    let initialized = false;
    const plugin: EnginePlugin = {
      manifest: {
        id: 'mudd.lifecycle-test',
        version: '1.0.0',
        apiVersion: '1.0',
        category: 'core',
        provides: ['mudd.test.capability.v1'],
      },
      register(context) {
        context.provideCapability('mudd.test.capability.v1', { ready: true });
        const capability = context.requireCapability<{ ready: boolean }>('mudd.test.capability.v1');
        context.registerCommand('test.echo', z.object({
          type: z.literal('test.echo'),
          version: z.literal(1),
          commandId: z.string(),
          worldInstanceId: z.string(),
          payload: z.object({ text: z.string() }),
        }), async (command) => ({
          streamId: 'plugin-test-character',
          expectedVersion: 0,
          events: [{
            type: 'test.echoed',
            version: 1,
            payload: { text: command.payload.text, capabilityReady: capability.ready },
          }],
        }));
      },
      async initialize() { initialized = true; },
    };
    const engine = new EngineHost([plugin], new InMemoryEventStore(), authorization, demoWorld);
    expect(initialized).toBe(false);
    await expect(engine.start()).resolves.toBeUndefined();
    expect(initialized).toBe(true);
    const result = await engine.dispatch({
      type: 'test.echo',
      version: 1,
      commandId: 'echo-1',
      worldInstanceId: DEMO_WORLD_INSTANCE_ID,
      payload: { text: 'registered' },
    }, session);
    expect(result.receipt.ok).toBe(true);
    expect(result.events[0]?.payload).toEqual({ text: 'registered', capabilityReady: true });
    await expect(engine.stop()).resolves.toBeUndefined();
  });

  it('rejects malformed and unknown commands', async () => {
    const { engine } = makeEngine();
    await engine.start();
    const invalid = await engine.dispatch({
      type: 'character.move',
      commandId: 'bad',
      worldInstanceId: DEMO_WORLD_INSTANCE_ID,
      characterId: 'char',
      expectedVersion: 'not-a-number',
      payload: { exitId: 'missing' },
    }, session);
    expect(invalid.receipt).toMatchObject({ ok: false, code: 'INVALID_COMMAND' });
    const unknown = await engine.dispatch({ type: 'admin.teleport', commandId: 'unknown' }, session);
    expect(unknown.receipt).toMatchObject({ ok: false, code: 'UNKNOWN_COMMAND' });
    await engine.stop();
  });

  it('creates a character, moves only through a valid exit, and replays the same state', async () => {
    const { engine, store } = makeEngine();
    await engine.start();
    const created = await engine.dispatch({
      type: 'character.create',
      version: 1,
      commandId: 'create-1',
      worldInstanceId: DEMO_WORLD_INSTANCE_ID,
      payload: { name: 'Rill' },
    }, session);
    expect(created.receipt.ok).toBe(true);
    expect(created.streamId).toBe('test-id-1');

    const blocked = await engine.dispatch({
      type: 'character.move',
      version: 1,
      commandId: 'move-invalid',
      worldInstanceId: DEMO_WORLD_INSTANCE_ID,
      characterId: created.streamId,
      expectedVersion: 1,
      payload: { exitId: 'not-an-exit' },
    }, session);
    expect(blocked.receipt).toMatchObject({ ok: false, code: 'RULE_VIOLATION' });

    const moved = await engine.dispatch({
      type: 'character.take',
      version: 1,
      commandId: 'take-stone',
      worldInstanceId: DEMO_WORLD_INSTANCE_ID,
      characterId: created.streamId,
      expectedVersion: 1,
      payload: { itemId: 'mossgate-loose-stone' },
    }, session);
    expect(moved.receipt).toMatchObject({ ok: true, newAggregateVersion: 2 });
    const cannotTakeSign = await engine.dispatch({
      type: 'character.take',
      version: 1,
      commandId: 'take-marker',
      worldInstanceId: DEMO_WORLD_INSTANCE_ID,
      characterId: created.streamId,
      expectedVersion: 2,
      payload: { itemId: 'mossgate-marker' },
    }, session);
    expect(cannotTakeSign.receipt).toMatchObject({ ok: false, code: 'RULE_VIOLATION' });

    const movedAfterTake = await engine.dispatch({
      type: 'character.move',
      version: 1,
      commandId: 'move-1',
      worldInstanceId: DEMO_WORLD_INSTANCE_ID,
      characterId: created.streamId,
      expectedVersion: 2,
      payload: { exitId: 'clearing-to-bridge' },
    }, session);
    expect(movedAfterTake.receipt).toMatchObject({ ok: true, newAggregateVersion: 3 });
    const projection = replayCharacter(await store.readStream(DEMO_WORLD_INSTANCE_ID, created.streamId!));
    expect(projection).toMatchObject({
      characterId: created.streamId,
      locationId: 'glasswater-bridge',
      revision: 3,
      inventory: [{
        id: 'mossgate-loose-stone',
        label: 'Loose stone',
        description: 'A smooth, palm-sized stone with a pale stripe running through it.',
      }],
    });
    await engine.stop();
  });

  it('allows inspection of carried items after travel but not objects left behind', async () => {
    const { engine } = makeEngine();
    await engine.start();
    const created = await engine.dispatch({
      type: 'character.create',
      version: 1,
      commandId: 'inspect-create',
      worldInstanceId: DEMO_WORLD_INSTANCE_ID,
      payload: { name: 'Rill' },
    }, session);
    const characterId = created.streamId!;
    await engine.dispatch({
      type: 'character.take',
      version: 1,
      commandId: 'inspect-take',
      worldInstanceId: DEMO_WORLD_INSTANCE_ID,
      characterId,
      expectedVersion: 1,
      payload: { itemId: 'mossgate-loose-stone' },
    }, session);
    await engine.dispatch({
      type: 'character.move',
      version: 1,
      commandId: 'inspect-move',
      worldInstanceId: DEMO_WORLD_INSTANCE_ID,
      characterId,
      expectedVersion: 2,
      payload: { exitId: 'clearing-to-bridge' },
    }, session);

    const carriedItem = await engine.query({
      type: 'object.inspect',
      version: 1,
      queryId: 'inspect-carried-stone',
      worldInstanceId: DEMO_WORLD_INSTANCE_ID,
      characterId,
      payload: { objectId: 'mossgate-loose-stone' },
    }, session);
    expect(carriedItem).toMatchObject({
      ok: true,
      value: {
        id: 'mossgate-loose-stone',
        label: 'Loose stone',
        description: 'A smooth, palm-sized stone with a pale stripe running through it.',
      },
    });
    const objectLeftBehind = await engine.query({
      type: 'object.inspect',
      version: 1,
      queryId: 'inspect-room-marker',
      worldInstanceId: DEMO_WORLD_INSTANCE_ID,
      characterId,
      payload: { objectId: 'mossgate-marker' },
    }, session);
    expect(objectLeftBehind).toMatchObject({
      ok: false,
      message: 'That object is not here or in your pack.',
    });

    const droppedItem = await engine.dispatch({
      type: 'character.drop',
      version: 1,
      commandId: 'inspect-drop-stone',
      worldInstanceId: DEMO_WORLD_INSTANCE_ID,
      characterId,
      expectedVersion: 3,
      payload: { itemId: 'mossgate-loose-stone' },
    }, session);
    expect(droppedItem.receipt).toMatchObject({ ok: true, newAggregateVersion: 4 });
    await engine.dispatch({
      type: 'character.move',
      version: 1,
      commandId: 'inspect-return',
      worldInstanceId: DEMO_WORLD_INSTANCE_ID,
      characterId,
      expectedVersion: 4,
      payload: { exitId: 'bridge-to-clearing' },
    }, session);
    const itemLeftBehind = await engine.query({
      type: 'object.inspect',
      version: 1,
      queryId: 'inspect-dropped-stone-from-original-room',
      worldInstanceId: DEMO_WORLD_INSTANCE_ID,
      characterId,
      payload: { objectId: 'mossgate-loose-stone' },
    }, session);
    expect(itemLeftBehind).toMatchObject({
      ok: false,
      message: 'That object is not here or in your pack.',
    });
    await engine.stop();
  });

  it('drops a carried item into the current room and keeps its location through replay', async () => {
    const { engine, store } = makeEngine();
    await engine.start();
    const created = await engine.dispatch({
      type: 'character.create',
      version: 1,
      commandId: 'drop-create',
      worldInstanceId: DEMO_WORLD_INSTANCE_ID,
      payload: { name: 'Rill' },
    }, session);
    const characterId = created.streamId!;
    const take = await engine.dispatch({
      type: 'character.take',
      version: 1,
      commandId: 'drop-take',
      worldInstanceId: DEMO_WORLD_INSTANCE_ID,
      characterId,
      expectedVersion: 1,
      payload: { itemId: 'mossgate-loose-stone' },
    }, session);
    expect(take.receipt).toMatchObject({ ok: true, newAggregateVersion: 2 });
    const moveToBridge = await engine.dispatch({
      type: 'character.move',
      version: 1,
      commandId: 'drop-move-to-bridge',
      worldInstanceId: DEMO_WORLD_INSTANCE_ID,
      characterId,
      expectedVersion: 2,
      payload: { exitId: 'clearing-to-bridge' },
    }, session);
    expect(moveToBridge.receipt).toMatchObject({ ok: true, newAggregateVersion: 3 });
    const drop = await engine.dispatch({
      type: 'character.drop',
      version: 1,
      commandId: 'drop-stone',
      worldInstanceId: DEMO_WORLD_INSTANCE_ID,
      characterId,
      expectedVersion: 3,
      payload: { itemId: 'mossgate-loose-stone' },
    }, session);
    expect(drop.receipt).toMatchObject({ ok: true, newAggregateVersion: 4 });
    expect(drop.events[0]).toMatchObject({
      type: 'character.item_dropped',
      version: 1,
      payload: { characterId, locationId: 'glasswater-bridge', item: { id: 'mossgate-loose-stone' } },
    });
    expect(replayCharacter(await store.readStream(DEMO_WORLD_INSTANCE_ID, characterId))).toMatchObject({
      locationId: 'glasswater-bridge',
      revision: 4,
      inventory: [],
      itemLocations: [{
        item: { id: 'mossgate-loose-stone' },
        locationId: 'glasswater-bridge',
      }],
    });
    const droppedRoom = await engine.query({
      type: 'location.describe',
      version: 1,
      queryId: 'look-at-dropped-stone',
      worldInstanceId: DEMO_WORLD_INSTANCE_ID,
      characterId,
      payload: {},
    }, session);
    expect(droppedRoom).toMatchObject({
      ok: true,
      value: { objects: [expect.objectContaining({ id: 'mossgate-loose-stone', takeable: true })] },
    });
    const moveBackToClearing = await engine.dispatch({
      type: 'character.move',
      version: 1,
      commandId: 'drop-move-back-to-clearing',
      worldInstanceId: DEMO_WORLD_INSTANCE_ID,
      characterId,
      expectedVersion: 4,
      payload: { exitId: 'bridge-to-clearing' },
    }, session);
    expect(moveBackToClearing.receipt).toMatchObject({ ok: true, newAggregateVersion: 5 });
    const originalRoom = await engine.query({
      type: 'location.describe',
      version: 1,
      queryId: 'look-at-original-stone-place',
      worldInstanceId: DEMO_WORLD_INSTANCE_ID,
      characterId,
      payload: {},
    }, session);
    expect(originalRoom).not.toMatchObject({
      ok: true,
      value: { objects: expect.arrayContaining([expect.objectContaining({ id: 'mossgate-loose-stone' })]) },
    });
    const returnToBridge = await engine.dispatch({
      type: 'character.move',
      version: 1,
      commandId: 'drop-return-to-bridge',
      worldInstanceId: DEMO_WORLD_INSTANCE_ID,
      characterId,
      expectedVersion: 5,
      payload: { exitId: 'clearing-to-bridge' },
    }, session);
    expect(returnToBridge.receipt).toMatchObject({ ok: true, newAggregateVersion: 6 });
    const takeAgain = await engine.dispatch({
      type: 'character.take',
      version: 1,
      commandId: 'take-dropped-stone',
      worldInstanceId: DEMO_WORLD_INSTANCE_ID,
      characterId,
      expectedVersion: 6,
      payload: { itemId: 'mossgate-loose-stone' },
    }, session);
    expect(takeAgain.receipt).toMatchObject({ ok: true, newAggregateVersion: 7 });
    expect(replayCharacter(await store.readStream(DEMO_WORLD_INSTANCE_ID, characterId))).toMatchObject({
      inventory: [{ id: 'mossgate-loose-stone' }],
      itemLocations: [{ item: { id: 'mossgate-loose-stone' }, locationId: null }],
    });
    await engine.stop();
  });

  it('keeps multiple characters under one account and supports versioned rename and archive events', async () => {
    const { engine, store } = makeEngine();
    await engine.start();
    const first = await engine.dispatch({
      type: 'character.create',
      version: 1,
      commandId: 'create-first',
      worldInstanceId: DEMO_WORLD_INSTANCE_ID,
      payload: { name: 'Rill' },
    }, session);
    const second = await engine.dispatch({
      type: 'character.create',
      version: 1,
      commandId: 'create-second',
      worldInstanceId: DEMO_WORLD_INSTANCE_ID,
      payload: { name: 'Sedge' },
    }, session);
    expect(first.receipt.ok).toBe(true);
    expect(second.receipt.ok).toBe(true);
    expect(second.streamId).not.toBe(first.streamId);

    const renamed = await engine.dispatch({
      type: 'character.rename',
      version: 1,
      commandId: 'rename-first',
      worldInstanceId: DEMO_WORLD_INSTANCE_ID,
      characterId: first.streamId,
      expectedVersion: 1,
      payload: { name: 'Fern' },
    }, session);
    expect(renamed.receipt).toMatchObject({ ok: true, newAggregateVersion: 2 });

    const archived = await engine.dispatch({
      type: 'character.archive',
      version: 1,
      commandId: 'archive-first',
      worldInstanceId: DEMO_WORLD_INSTANCE_ID,
      characterId: first.streamId,
      expectedVersion: 2,
      payload: {},
    }, session);
    expect(archived.receipt).toMatchObject({ ok: true, newAggregateVersion: 3 });
    expect(replayCharacter(await store.readStream(DEMO_WORLD_INSTANCE_ID, first.streamId!)))
      .toMatchObject({ name: 'Fern', archived: true, revision: 3 });
    expect(replayCharacter(await store.readStream(DEMO_WORLD_INSTANCE_ID, second.streamId!)))
      .toMatchObject({ name: 'Sedge', archived: false, revision: 1 });

    const moveArchived = await engine.dispatch({
      type: 'character.move',
      version: 1,
      commandId: 'move-archived',
      worldInstanceId: DEMO_WORLD_INSTANCE_ID,
      characterId: first.streamId,
      expectedVersion: 3,
      payload: { exitId: 'clearing-to-bridge' },
    }, session);
    expect(moveArchived.receipt).toMatchObject({ ok: false, code: 'RULE_VIOLATION' });

    const restored = await engine.dispatch({
      type: 'character.restore',
      version: 1,
      commandId: 'restore-first',
      worldInstanceId: DEMO_WORLD_INSTANCE_ID,
      characterId: first.streamId,
      expectedVersion: 3,
      payload: {},
    }, session);
    expect(restored.receipt).toMatchObject({ ok: true, newAggregateVersion: 4 });
    expect(replayCharacter(await store.readStream(DEMO_WORLD_INSTANCE_ID, first.streamId!)))
      .toMatchObject({ name: 'Fern', archived: false, revision: 4 });

    const movedAfterRestore = await engine.dispatch({
      type: 'character.move',
      version: 1,
      commandId: 'move-restored',
      worldInstanceId: DEMO_WORLD_INSTANCE_ID,
      characterId: first.streamId,
      expectedVersion: 4,
      payload: { exitId: 'clearing-to-bridge' },
    }, session);
    expect(movedAfterRestore.receipt.ok).toBe(true);
    await engine.stop();
  });

  it('prevents stale concurrent writes and makes command retries idempotent', async () => {
    const { engine, store } = makeEngine();
    await engine.start();
    const created = await engine.dispatch({
      type: 'character.create',
      version: 1,
      commandId: 'create-1',
      worldInstanceId: DEMO_WORLD_INSTANCE_ID,
      payload: { name: 'Rill' },
    }, session);
    const command = {
      type: 'character.move',
      version: 1,
      commandId: 'move-race-a',
      worldInstanceId: DEMO_WORLD_INSTANCE_ID,
      characterId: created.streamId,
      expectedVersion: 1,
      payload: { exitId: 'clearing-to-bridge' },
    };
    const [first, duplicate] = await Promise.all([
      engine.dispatch(command, session),
      engine.dispatch(command, session),
    ]);
    expect(first.receipt.ok).toBe(true);
    expect(duplicate.receipt).toMatchObject({ ok: true, newAggregateVersion: 2 });
    const competing = await engine.dispatch({ ...command, commandId: 'move-race-b', payload: { exitId: 'clearing-to-tower' } }, session);
    expect(competing.receipt).toMatchObject({ ok: false, code: 'VERSION_CONFLICT' });
    expect((await store.readStream(DEMO_WORLD_INSTANCE_ID, created.streamId!))).toHaveLength(2);
    await engine.stop();
  });

  it('rejects plugins with missing dependencies', () => {
    const plugin: EnginePlugin = {
      manifest: {
        id: 'mudd.needs-missing',
        version: '1.0.0',
        apiVersion: '1.0',
        category: 'core',
        requiredPlugins: { 'mudd.not-installed': '^1.0.0' },
      },
      register() {},
    };
    expect(() => new EngineHost([plugin], new InMemoryEventStore(), authorization, demoWorld))
      .toThrow(/missing plugin/i);
  });
});
