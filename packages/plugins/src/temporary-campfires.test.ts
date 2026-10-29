import { describe, expect, it, vi } from 'vitest';
import {
  EngineHost,
  InMemoryEventStore,
  SYSTEM_ACTOR_ID,
  type EnginePlugin,
  type StoredGameEvent,
} from '@mudd/engine-core';
import { demoWorld, DEMO_WORLD_INSTANCE_ID } from '@mudd/world-demo';
import {
  characterPlugin,
  objectLifecyclePlugin,
  objectLifecycleScheduledEvent,
  objectLifecycleStreamId,
  projectObjectLifecycle,
  projectTemporaryCampfires,
  RoomAnnouncementEffectSchema,
  ROOM_ANNOUNCEMENT_EFFECT,
  roomAnnouncementEffect,
  TEMPORARY_CAMPFIRES_STREAM_ID,
  temporaryCampfiresPlugin,
  worldItemsPlugin,
} from './index.js';

const worldInstanceId = DEMO_WORLD_INSTANCE_ID;
const session = {
  sessionId: 'campfire-session',
  playerId: 'campfire-player',
  actorId: 'campfire-player',
  worldInstanceId,
  grantedPermissions: [],
  authenticated: true,
} as const;
const authorization = {
  canAccessInstance: async () => true,
  ownsCharacter: async () => true,
};
const announcementSink: EnginePlugin = {
  manifest: {
    id: 'mudd.test.room-announcement-sink',
    version: '1.0.0',
    apiVersion: '1.0',
    category: 'core',
  },
  register({ registerEffect }) {
    registerEffect(ROOM_ANNOUNCEMENT_EFFECT, 1, RoomAnnouncementEffectSchema, async () => undefined);
  },
};

function createEngine() {
  let id = 0;
  let now = new Date('2026-10-27T12:00:00.000Z');
  const store = new InMemoryEventStore();
  const engine = new EngineHost(
    [
      worldItemsPlugin,
      objectLifecyclePlugin,
      temporaryCampfiresPlugin,
      characterPlugin,
      announcementSink,
    ],
    store,
    authorization,
    demoWorld,
    () => `campfire-test-${++id}`,
    () => new Date(now),
  );
  return {
    engine,
    store,
    setNow(value: Date) { now = value; },
  };
}

async function createCharacter(engine: EngineHost, commandId = 'campfire-character-create') {
  const result = await engine.dispatch({
    type: 'character.create',
    version: 1,
    commandId,
    worldInstanceId,
    payload: { name: 'Ember' },
  }, session);
  expect(result.receipt.ok).toBe(true);
  return {
    characterId: result.streamId!,
    revision: result.events.at(-1)!.aggregateVersion,
  };
}

async function roomProjection(engine: EngineHost, characterId: string) {
  const result = await engine.query({
    type: 'location.describe',
    version: 1,
    queryId: 'campfire-room',
    worldInstanceId,
    characterId,
    payload: {},
  }, session);
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error('Could not query the campfire room.');
  return result.value as { objects: Array<{ id: string; label: string }>; description: string };
}

function storedEvent(
  streamId: string,
  type: string,
  payload: Record<string, unknown>,
  aggregateVersion: number,
): StoredGameEvent {
  return {
    eventId: `event-${aggregateVersion}`,
    worldInstanceId,
    aggregateId: streamId,
    streamId,
    aggregateVersion,
    type,
    version: 1,
    payload,
    occurredAt: '2026-10-27T12:00:00.000Z',
    actorId: SYSTEM_ACTOR_ID,
    causationCommandId: `command-${aggregateVersion}`,
    commandId: `command-${aggregateVersion}`,
    tick: aggregateVersion,
  } as unknown as StoredGameEvent;
}

describe('temporary campfires', () => {
  it('creates the campfire and schedule atomically, then removes it through generic expiry', async () => {
    const { engine, store, setNow } = createEngine();
    await engine.start();
    const character = await createCharacter(engine);
    const lit = await engine.dispatch({
      type: 'campfire.light',
      version: 1,
      commandId: 'light-campfire',
      worldInstanceId,
      characterId: character.characterId,
      expectedVersion: character.revision,
      payload: {},
    }, session);

    expect(lit.receipt.ok).toBe(true);
    const campfireId = String(lit.events[0]!.payload.campfireId);
    const lifecycleStream = objectLifecycleStreamId(campfireId);
    const lifecycleHistory = await store.readStream(worldInstanceId, lifecycleStream);
    expect(projectObjectLifecycle(lifecycleHistory)).toMatchObject({
      objectId: campfireId,
      objectType: 'campfire',
      state: 'scheduled',
    });
    expect(lifecycleHistory).toHaveLength(1);
    expect(projectTemporaryCampfires(
      await store.readStream(worldInstanceId, TEMPORARY_CAMPFIRES_STREAM_ID),
    )).toEqual([expect.objectContaining({ campfireId, extinguished: false })]);

    const roomBefore = await roomProjection(engine, character.characterId);
    expect(roomBefore.objects).toContainEqual(expect.objectContaining({
      id: campfireId,
      label: 'Campfire',
    }));
    expect(roomBefore.description).toContain('A small campfire crackles');

    const dueAt = Date.parse(String(lit.events[0]!.payload.expiresAt));
    setNow(new Date(dueAt + 1));
    const roomAtDeadline = await roomProjection(engine, character.characterId);
    expect(roomAtDeadline.objects).not.toContainEqual(expect.objectContaining({ id: campfireId }));

    const expiring = await engine.dispatchSystem({
      type: 'world.object.expire',
      version: 1,
      commandId: `expire-${campfireId}`,
      worldInstanceId,
      expectedVersion: 1,
      payload: { objectId: campfireId },
    }, SYSTEM_ACTOR_ID);
    expect(expiring.receipt.ok).toBe(true);
    await engine.processPendingEffects(25, worldInstanceId);

    const finalCampfire = projectTemporaryCampfires(
      await store.readStream(worldInstanceId, TEMPORARY_CAMPFIRES_STREAM_ID),
    )[0];
    expect(finalCampfire).toMatchObject({ campfireId, extinguished: true });
    expect(projectObjectLifecycle(await store.readStream(worldInstanceId, lifecycleStream)))
      .toMatchObject({ state: 'expired' });
    expect((await roomProjection(engine, character.characterId)).objects)
      .not.toContainEqual(expect.objectContaining({ id: campfireId }));
    await engine.stop();
  });

  it('extinguishes a campfire and cancels its lifecycle with a room announcement atomically', async () => {
    const { engine, store } = createEngine();
    const append = vi.spyOn(store, 'append');
    await engine.start();
    const character = await createCharacter(engine);
    const lit = await engine.dispatch({
      type: 'campfire.light',
      version: 1,
      commandId: 'light-for-manual-extinguish',
      worldInstanceId,
      characterId: character.characterId,
      expectedVersion: character.revision,
      payload: {},
    }, session);
    expect(lit.receipt.ok).toBe(true);
    const campfireId = String(lit.events[0]!.payload.campfireId);
    const lifecycleStream = objectLifecycleStreamId(campfireId);
    const awayCharacter = await createCharacter(engine, 'campfire-away-character-create');
    const moved = await store.append({
      worldInstanceId,
      streamId: awayCharacter.characterId,
      actorId: SYSTEM_ACTOR_ID,
      commandId: 'move-campfire-away-character',
      payloadHash: 'move-campfire-away-character',
      expectedVersion: awayCharacter.revision,
      events: [{
        type: 'character.moved',
        version: 1,
        payload: {
          characterId: awayCharacter.characterId,
          fromLocationId: 'mossgate-clearing',
          toLocationId: 'glasswater-bridge',
          exitId: 'clearing-to-bridge',
        },
      }],
    });
    expect(moved.receipt.ok).toBe(true);

    const outsideRoom = await engine.dispatch({
      type: 'campfire.extinguish',
      version: 1,
      commandId: 'extinguish-campfire-from-another-room',
      worldInstanceId,
      characterId: awayCharacter.characterId,
      expectedVersion: awayCharacter.revision + 1,
      payload: { campfireId },
    }, session);
    expect(outsideRoom.receipt).toMatchObject({
      ok: false,
      code: 'RULE_VIOLATION',
      message: 'There is no burning campfire in this room.',
    });

    const extinguished = await engine.dispatch({
      type: 'campfire.extinguish',
      version: 1,
      commandId: 'extinguish-campfire',
      worldInstanceId,
      characterId: character.characterId,
      expectedVersion: character.revision,
      payload: { campfireId },
    }, session);

    expect(extinguished.receipt.ok).toBe(true);
    expect(extinguished.events).toContainEqual(expect.objectContaining({
      type: 'world.campfire_extinguished',
      payload: expect.objectContaining({ campfireId, locationId: 'mossgate-clearing' }),
    }));
    expect(projectTemporaryCampfires(
      await store.readStream(worldInstanceId, TEMPORARY_CAMPFIRES_STREAM_ID),
    )).toContainEqual(expect.objectContaining({ campfireId, extinguished: true }));
    expect(projectObjectLifecycle(await store.readStream(worldInstanceId, lifecycleStream)))
      .toMatchObject({ state: 'cancelled' });
    expect((await roomProjection(engine, character.characterId)).objects)
      .not.toContainEqual(expect.objectContaining({ id: campfireId }));

    const commit = append.mock.calls
      .map(([request]) => request)
      .find((request) => request.commandId === 'extinguish-campfire');
    expect(commit).toMatchObject({
      streamId: TEMPORARY_CAMPFIRES_STREAM_ID,
      companions: [{
        streamId: lifecycleStream,
        events: [expect.objectContaining({
          type: 'world.object_lifecycle_cancelled',
          payload: expect.objectContaining({ objectId: campfireId, objectType: 'campfire' }),
        })],
      }],
      effects: [roomAnnouncementEffect(
        'mossgate-clearing',
        'The campfire is extinguished, leaving a bed of dark ash.',
      )],
    });
    await engine.stop();
  });

  it('keeps a campfire visible after its schedule is extended or cancelled', async () => {
    const { engine, store, setNow } = createEngine();
    await engine.start();
    const character = await createCharacter(engine);
    const lit = await engine.dispatch({
      type: 'campfire.light',
      version: 1,
      commandId: 'light-rescheduled-campfire',
      worldInstanceId,
      characterId: character.characterId,
      expectedVersion: character.revision,
      payload: {},
    }, session);
    const campfireId = String(lit.events[0]!.payload.campfireId);
    const lifecycleStream = objectLifecycleStreamId(campfireId);
    const lifecycle = projectObjectLifecycle(await store.readStream(worldInstanceId, lifecycleStream))!;
    const extendedExpiry = new Date(Date.parse(lifecycle.expiresAt) + 60_000).toISOString();
    const rescheduled = await store.append({
      worldInstanceId,
      streamId: lifecycleStream,
      actorId: SYSTEM_ACTOR_ID,
      commandId: 'extend-campfire-expiry',
      payloadHash: `${campfireId}:${extendedExpiry}`,
      expectedVersion: lifecycle.revision,
      events: [{
        type: 'world.object_lifecycle_rescheduled',
        version: 1,
        payload: {
          objectId: campfireId,
          objectType: 'campfire',
          locationId: lifecycle.locationId,
          expiresAt: extendedExpiry,
        },
      }],
    });
    expect(rescheduled.receipt.ok).toBe(true);

    setNow(new Date(Date.parse(lifecycle.expiresAt) + 1));
    expect((await roomProjection(engine, character.characterId)).objects)
      .toContainEqual(expect.objectContaining({ id: campfireId }));

    const current = projectObjectLifecycle(await store.readStream(worldInstanceId, lifecycleStream))!;
    const cancelled = await store.append({
      worldInstanceId,
      streamId: lifecycleStream,
      actorId: SYSTEM_ACTOR_ID,
      commandId: 'cancel-campfire-expiry',
      payloadHash: `${campfireId}:cancel`,
      expectedVersion: current.revision,
      events: [{
        type: 'world.object_lifecycle_cancelled',
        version: 1,
        payload: {
          objectId: campfireId,
          objectType: 'campfire',
          locationId: current.locationId,
        },
      }],
    });
    expect(cancelled.receipt.ok).toBe(true);
    setNow(new Date(Date.parse(extendedExpiry) + 1));
    expect((await roomProjection(engine, character.characterId)).objects)
      .toContainEqual(expect.objectContaining({ id: campfireId }));
    await engine.stop();
  });

  it('retries failed finalization without losing the generic lifecycle transition', async () => {
    const captured: Array<(payload: unknown, context: unknown) => Promise<void>> = [];
    const lifecycleStream = objectLifecycleStreamId('campfire-retry');
    const schedule = objectLifecycleScheduledEvent({
      objectId: 'campfire-retry',
      objectType: 'campfire',
      locationId: 'mossgate-clearing',
      createdAt: '2026-10-27T12:00:00.000Z',
      expiresAt: '2026-10-27T12:10:00.000Z',
    });
    const lifecycleHistory = [
      storedEvent(lifecycleStream, schedule.type, schedule.payload, 1),
      storedEvent(lifecycleStream, 'world.object_expiring', {
        objectId: 'campfire-retry',
        objectType: 'campfire',
        locationId: 'mossgate-clearing',
        expiresAt: '2026-10-27T12:10:00.000Z',
      }, 2),
    ];
    const campfireHistory = [storedEvent(TEMPORARY_CAMPFIRES_STREAM_ID, 'world.campfire_lit', {
      campfireId: 'campfire-retry',
      locationId: 'mossgate-clearing',
      createdAt: '2026-10-27T12:00:00.000Z',
      expiresAt: '2026-10-27T12:10:00.000Z',
    }, 1)];
    let failedOnce = false;
    const store = {
      readStream: vi.fn(async (_worldId: string, streamId: string) =>
        streamId === lifecycleStream ? lifecycleHistory : campfireHistory),
      append: vi.fn(async () => {
        if (!failedOnce) {
          failedOnce = true;
          throw new Error('temporary append failure');
        }
        return { receipt: { ok: true }, kind: 'committed' };
      }),
    };
    temporaryCampfiresPlugin.register({
      registerCommand: () => undefined,
      registerEventHandler: (_type: string, _version: number, _schema: unknown, handler: unknown) => {
        captured.push(handler as (payload: unknown, context: unknown) => Promise<void>);
      },
      provideCapability: () => undefined,
      requireCapability: () => ({ load: async () => undefined }),
    } as never);
    const handler = captured[0]!;
    const payload = {
      objectId: 'campfire-retry',
      objectType: 'campfire',
      locationId: 'mossgate-clearing',
      expiresAt: '2026-10-27T12:10:00.000Z',
    };
    const context = {
      effectId: 'effect-campfire-retry',
      worldInstanceId,
      store,
      now: () => new Date('2026-10-27T12:10:01.000Z'),
    };

    await expect(handler(payload, context)).rejects.toThrow('temporary append failure');
    await expect(handler(payload, context)).resolves.toBeUndefined();
    expect(store.append).toHaveBeenCalledTimes(2);
    expect(store.append).toHaveBeenLastCalledWith(expect.objectContaining({
      streamId: TEMPORARY_CAMPFIRES_STREAM_ID,
      commandId: 'campfire-expire:effect-campfire-retry',
      companions: [expect.objectContaining({
        streamId: lifecycleStream,
        expectedVersion: 2,
        events: [expect.objectContaining({ type: 'world.object_expired' })],
      })],
    }));
  });
});
