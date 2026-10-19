import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { EngineHost, InMemoryEventStore, replayCharacter, type EnginePlugin } from './index.js';
import { characterPlugin, movementPlugin } from '@mudd/core-plugins';
import { DEMO_WORLD_INSTANCE_ID, demoWorld } from '@mudd/world-demo';
import type { CapabilityToken } from '@mudd/contracts';

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

function makeEngine(world = demoWorld) {
  let id = 0;
  const store = new InMemoryEventStore();
  const engine = new EngineHost(
    [movementPlugin, characterPlugin],
    store,
    authorization,
    world,
    () => `test-id-${++id}`,
    () => new Date('2026-10-17T12:00:00.000Z'),
  );
  return { engine, store };
}

describe('MUDD engine host', () => {
  it('returns generic internal failures with a request-correlatable ID', async () => {
    const { engine, store } = makeEngine();
    await engine.start();
    const lookup = vi.spyOn(store, 'lookupCommand').mockRejectedValue(new Error('database password must not reach clients'));
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const result = await engine.dispatch({
      type: 'character.create',
      version: 1,
      commandId: 'internal-error-command',
      worldInstanceId: DEMO_WORLD_INSTANCE_ID,
      payload: { name: 'Rill' },
    }, session, 'request-correlation-id');

    expect(result.receipt).toMatchObject({
      ok: false,
      code: 'INTERNAL_ERROR',
      message: 'The server could not complete that command.',
    });
    expect(result.receipt.message).not.toContain('password');
    expect(result.correlationId).toBe('request-correlation-id');
    expect(log).toHaveBeenCalledWith(
      '[request-correlation-id] Engine command failed',
      expect.any(Error),
    );

    lookup.mockRestore();
    log.mockRestore();
    await engine.stop();
  });

  it('registers typed commands and capabilities before initializing a plugin', async () => {
    let initialized = false;
    const testCapability = { id: 'mudd.test.capability.v1', version: '1' } satisfies CapabilityToken<{ ready: boolean }>;
    const plugin: EnginePlugin = {
      manifest: {
        id: 'mudd.lifecycle-test',
        version: '1.0.0',
        apiVersion: '1.0',
        category: 'core',
        provides: ['mudd.test.capability.v1'],
      },
      register(context) {
        context.provideCapability(testCapability, { ready: true });
        const capability = context.requireCapability<{ ready: boolean }>(testCapability);
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

  it('retries versioned durable effects without duplicating a command effect', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-18T12:00:00.000Z'));
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    let attempts = 0;
    let successfulDeliveries = 0;
    const effectPlugin: EnginePlugin = {
      manifest: {
        id: 'mudd.effect-test',
        version: '1.0.0',
        apiVersion: '1.0',
        category: 'core',
      },
      register(context) {
        context.registerCommand('test.effect-command', z.object({
          type: z.literal('test.effect-command'),
          version: z.literal(1),
          commandId: z.string(),
          worldInstanceId: z.string(),
        }), async () => ({
          streamId: 'effect-test-stream',
          expectedVersion: 0,
          events: [{ type: 'test.effect-commanded', version: 1, payload: {} }],
          effects: [{ type: 'test.delivery', version: 1, payload: { value: 'persisted' } }],
        }));
        context.registerEffect('test.delivery', 1, z.object({ value: z.string() }), async (payload) => {
          attempts += 1;
          if (attempts === 1) throw new Error('temporary delivery failure');
          expect(payload.value).toBe('persisted');
          successfulDeliveries += 1;
        });
      },
    };
    const store = new InMemoryEventStore();
    const engine = new EngineHost([effectPlugin], store, authorization, demoWorld);
    await engine.start();
    const command = {
      type: 'test.effect-command',
      version: 1,
      commandId: 'effect-command-1',
      worldInstanceId: DEMO_WORLD_INSTANCE_ID,
    };
    expect((await engine.dispatch(command, session)).receipt.ok).toBe(true);
    expect((await engine.dispatch(command, session)).commitOutcome).toBe('duplicate');

    expect(await engine.processPendingEffects()).toBe(1);
    expect(successfulDeliveries).toBe(0);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(await engine.processPendingEffects()).toBe(1);
    expect(successfulDeliveries).toBe(1);
    expect(await engine.processPendingEffects()).toBe(0);

    await engine.stop();
    log.mockRestore();
    vi.useRealTimers();
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
      visitedLocationIds: ['mossgate-clearing', 'glasswater-bridge'],
      revision: 3,
      inventory: [{
        id: 'mossgate-loose-stone',
        label: 'Loose stone',
        description: 'A smooth, palm-sized stone with a pale stripe running through it.',
      }],
    });

    const returned = await engine.dispatch({
      type: 'character.move',
      version: 1,
      commandId: 'return-to-clearing',
      worldInstanceId: DEMO_WORLD_INSTANCE_ID,
      characterId: created.streamId,
      expectedVersion: 3,
      payload: { exitId: 'bridge-to-clearing' },
    }, session);
    expect(returned.receipt).toMatchObject({ ok: true, newAggregateVersion: 4 });
    expect(replayCharacter(await store.readStream(DEMO_WORLD_INSTANCE_ID, created.streamId!))?.visitedLocationIds)
      .toEqual(['mossgate-clearing', 'glasswater-bridge']);
    await engine.stop();
  });

  it('uses a supplied character projection for a consistent game snapshot', async () => {
    const { engine, store } = makeEngine();
    await engine.start();
    const createdCharacter = await engine.dispatch({
      type: 'character.create',
      version: 1,
      commandId: 'snapshot-create',
      worldInstanceId: DEMO_WORLD_INSTANCE_ID,
      payload: { name: 'Snapshot' },
    }, session);
    const characterId = createdCharacter.streamId!;
    const projection = replayCharacter(await store.readStream(DEMO_WORLD_INSTANCE_ID, characterId))!;
    const readStream = vi.spyOn(store, 'readStream');

    const location = await engine.query({
      type: 'location.describe',
      version: 1,
      queryId: 'snapshot-query',
      worldInstanceId: DEMO_WORLD_INSTANCE_ID,
      characterId,
      payload: {},
    }, session, { characterProjection: projection });

    expect(location.ok).toBe(true);
    expect(readStream).not.toHaveBeenCalled();
    await engine.stop();
  });

  it('allows inspection of carried items and prevents quest items from being dropped', async () => {
    const { engine, store } = makeEngine();
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
    expect(droppedItem.receipt).toMatchObject({
      ok: false,
      message: 'Quest items cannot be dropped.',
    });
    expect(replayCharacter(await store.readStream(DEMO_WORLD_INSTANCE_ID, characterId))?.inventory)
      .toContainEqual(expect.objectContaining({ id: 'mossgate-loose-stone', questBound: true }));
    await engine.stop();
  });

  it('drops an ordinary item into the current room and keeps its location through replay', async () => {
    const testWorld = structuredClone(demoWorld);
    testWorld.locations.find((location) => location.id === 'mossgate-clearing')!.takeables!.push({
      id: 'drop-test-pebble',
      label: 'Pebble',
      description: 'A plain pebble used to test ordinary item dropping.',
      roomDescription: 'A plain pebble lies nearby.',
    });
    const { engine, store } = makeEngine(testWorld);
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
      payload: { itemId: 'drop-test-pebble' },
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
      payload: { itemId: 'drop-test-pebble' },
    }, session);
    expect(drop.receipt).toMatchObject({ ok: true, newAggregateVersion: 4 });
    expect(drop.events[0]).toMatchObject({
      type: 'character.item_dropped',
      version: 1,
      payload: { characterId, locationId: 'glasswater-bridge', item: { id: 'drop-test-pebble' } },
    });
    expect(replayCharacter(await store.readStream(DEMO_WORLD_INSTANCE_ID, characterId))).toMatchObject({
      locationId: 'glasswater-bridge',
      revision: 4,
      inventory: [],
      itemLocations: [{
        item: { id: 'drop-test-pebble' },
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
      value: { objects: expect.arrayContaining([expect.objectContaining({ id: 'drop-test-pebble', takeable: true })]) },
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
    expect(originalRoom).toMatchObject({
      ok: true,
      value: {
        description: expect.stringContaining(
          'Mara is here. A path keeper stands beside the weathered marker, watching the northern trail.',
        ),
      },
    });
    expect(originalRoom).not.toMatchObject({
      ok: true,
      value: { objects: expect.arrayContaining([expect.objectContaining({ id: 'drop-test-pebble' })]) },
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
      commandId: 'take-dropped-pebble',
      worldInstanceId: DEMO_WORLD_INSTANCE_ID,
      characterId,
      expectedVersion: 6,
      payload: { itemId: 'drop-test-pebble' },
    }, session);
    expect(takeAgain.receipt).toMatchObject({ ok: true, newAggregateVersion: 7 });
    expect(replayCharacter(await store.readStream(DEMO_WORLD_INSTANCE_ID, characterId))).toMatchObject({
      inventory: [{ id: 'drop-test-pebble' }],
      itemLocations: [{ item: { id: 'drop-test-pebble' }, locationId: null }],
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
    const [firstAttempt, secondAttempt] = await Promise.all([
      engine.dispatch(command, session),
      engine.dispatch(command, session),
    ]);
    expect([firstAttempt.commitOutcome, secondAttempt.commitOutcome].sort()).toEqual(['committed', 'duplicate']);
    expect(firstAttempt.receipt).toMatchObject({ ok: true, newAggregateVersion: 2 });
    expect(secondAttempt.receipt).toMatchObject({ ok: true, newAggregateVersion: 2 });
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

  it.each([
    { version: '1.0.0', range: '1.5.0', label: 'exact ranges reject an older minor' },
    { version: '1.0.0', range: '^1.5.0', label: 'caret ranges reject an older minor' },
    { version: '1.5.0', range: '^1.5.1', label: 'caret ranges reject a lower patch' },
    { version: '2.0.0', range: '^1.5.0', label: 'caret ranges reject a newer major' },
    { version: '0.3.0', range: '^0.2.3', label: 'zero-major caret ranges stay within the minor' },
    { version: '0.0.4', range: '^0.0.3', label: 'zero-major caret ranges stay within the patch' },
    { version: '1.5.0', range: '~1.5.0', label: 'unsupported range syntax is rejected' },
  ])('$label', ({ version, range }) => {
    const dependency: EnginePlugin = {
      manifest: { id: 'mudd.range-dependency', version, apiVersion: '1.0', category: 'core' },
      register() {},
    };
    const dependent: EnginePlugin = {
      manifest: {
        id: 'mudd.range-dependent',
        version: '1.0.0',
        apiVersion: '1.0',
        category: 'core',
        requiredPlugins: { 'mudd.range-dependency': range },
      },
      register() {},
    };
    expect(() => new EngineHost([dependency, dependent], new InMemoryEventStore(), authorization, demoWorld))
      .toThrow(version === '1.5.0' && range.startsWith('~')
        ? /unsupported plugin dependency range/i
        : /requires mudd\.range-dependency/i);
  });

  it('accepts compatible exact, caret, wildcard, and zero-major dependency versions', () => {
    const makeDependency = (version: string): EnginePlugin => ({
      manifest: { id: 'mudd.range-dependency', version, apiVersion: '1.0', category: 'core' },
      register() {},
    });
    const makeDependent = (range: string): EnginePlugin => ({
      manifest: {
        id: 'mudd.range-dependent',
        version: '1.0.0',
        apiVersion: '1.0',
        category: 'core',
        requiredPlugins: { 'mudd.range-dependency': range },
      },
      register() {},
    });

    expect(() => new EngineHost([makeDependency('1.5.0'), makeDependent('1.5.0')], new InMemoryEventStore(), authorization, demoWorld)).not.toThrow();
    expect(() => new EngineHost([makeDependency('1.6.2'), makeDependent('^1.5.0')], new InMemoryEventStore(), authorization, demoWorld)).not.toThrow();
    expect(() => new EngineHost([makeDependency('0.2.9'), makeDependent('^0.2.3')], new InMemoryEventStore(), authorization, demoWorld)).not.toThrow();
    expect(() => new EngineHost([makeDependency('9.9.9'), makeDependent('*')], new InMemoryEventStore(), authorization, demoWorld)).not.toThrow();
  });

  it('rejects plugin dependency cycles', () => {
    const first: EnginePlugin = {
      manifest: {
        id: 'mudd.cycle-first',
        version: '1.0.0',
        apiVersion: '1.0',
        category: 'core',
        requiredPlugins: { 'mudd.cycle-second': '^1.0.0' },
      },
      register() {},
    };
    const second: EnginePlugin = {
      manifest: {
        id: 'mudd.cycle-second',
        version: '1.0.0',
        apiVersion: '1.0',
        category: 'core',
        requiredPlugins: { 'mudd.cycle-first': '^1.0.0' },
      },
      register() {},
    };

    expect(() => new EngineHost([first, second], new InMemoryEventStore(), authorization, demoWorld))
      .toThrow(/dependency cycle/i);
  });
});
