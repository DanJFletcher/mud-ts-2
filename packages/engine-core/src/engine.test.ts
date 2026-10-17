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
      type: 'character.move',
      version: 1,
      commandId: 'move-1',
      worldInstanceId: DEMO_WORLD_INSTANCE_ID,
      characterId: created.streamId,
      expectedVersion: 1,
      payload: { exitId: 'clearing-to-bridge' },
    }, session);
    expect(moved.receipt).toMatchObject({ ok: true, newAggregateVersion: 2 });
    const projection = replayCharacter(await store.readStream(DEMO_WORLD_INSTANCE_ID, created.streamId!));
    expect(projection).toMatchObject({
      characterId: created.streamId,
      locationId: 'glasswater-bridge',
      revision: 2,
    });
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
