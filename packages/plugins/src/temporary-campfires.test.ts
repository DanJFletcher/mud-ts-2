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

function captureCampfirePlugin(
  loadLifecycle: (context: unknown, objectId: string) => Promise<unknown> = async () => undefined,
) {
  const commands = new Map<string, (command: unknown, context: unknown) => Promise<unknown>>();
  let capability: { atLocations: (context: never, locationIds: readonly string[]) => Promise<ReadonlyMap<string, readonly unknown[]>> } | undefined;
  let expirationHandler: ((payload: unknown, context: unknown) => Promise<void>) | undefined;
  temporaryCampfiresPlugin.register({
    registerCommand: (type: string, _schema: unknown, handler: unknown) => {
      commands.set(type, handler as (command: unknown, context: unknown) => Promise<unknown>);
    },
    registerEventHandler: (_type: string, _version: number, _schema: unknown, handler: unknown) => {
      expirationHandler = handler as (payload: unknown, context: unknown) => Promise<void>;
    },
    provideCapability: (_token: unknown, provided: unknown) => {
      capability = provided as typeof capability;
    },
    requireCapability: () => ({ load: loadLifecycle }),
  } as never);
  return { commands, get capability() { return capability!; }, get expirationHandler() { return expirationHandler!; } };
}

describe('temporary campfires', () => {
  it('rejects duplicate campfire lighting and invalid extinction histories', () => {
    const lit = storedEvent(TEMPORARY_CAMPFIRES_STREAM_ID, 'world.campfire_lit', {
      campfireId: 'campfire-projector',
      locationId: 'mossgate-clearing',
      createdAt: '2026-10-27T12:00:00.000Z',
      expiresAt: '2026-10-27T12:10:00.000Z',
    }, 1);
    const extinguished = (campfireId: string, locationId: string, aggregateVersion: number) =>
      storedEvent(TEMPORARY_CAMPFIRES_STREAM_ID, 'world.campfire_extinguished', {
        campfireId,
        locationId,
        extinguishedAt: '2026-10-27T12:02:00.000Z',
      }, aggregateVersion);

    expect(() => projectTemporaryCampfires([lit, { ...lit, aggregateVersion: 2 }]))
      .toThrow('Campfire campfire-projector was lit more than once.');
    expect(() => projectTemporaryCampfires([extinguished('missing', 'mossgate-clearing', 1)]))
      .toThrow('Invalid campfire extinction at revision 1.');
    expect(() => projectTemporaryCampfires([lit, extinguished('campfire-projector', 'wrong-room', 2)]))
      .toThrow('Invalid campfire extinction at revision 2.');
    expect(() => projectTemporaryCampfires([
      lit,
      extinguished('campfire-projector', 'mossgate-clearing', 2),
      extinguished('campfire-projector', 'mossgate-clearing', 3),
    ])).toThrow('Invalid campfire extinction at revision 3.');
  });

  it('projects only requested campfires whose lifecycle remains visible', async () => {
    const ids = ['missing-life', 'expired-life', 'expiring-life', 'past-life', 'visible-life', 'second-visible'];
    const lifecycleStates = new Map<string, unknown>([
      ['expired-life', { state: 'expired' }],
      ['expiring-life', { state: 'expiring' }],
      ['past-life', { state: 'scheduled', expiresAt: '2026-10-27T11:59:59.000Z' }],
      ['visible-life', { state: 'scheduled', expiresAt: '2026-10-27T12:10:00.000Z' }],
      ['second-visible', { state: 'cancelled' }],
    ]);
    const history = ids.map((campfireId, index) => storedEvent(
      TEMPORARY_CAMPFIRES_STREAM_ID,
      'world.campfire_lit',
      {
        campfireId,
        locationId: campfireId === 'second-visible' ? 'other-clearing' : 'mossgate-clearing',
        createdAt: '2026-10-27T11:50:00.000Z',
        expiresAt: '2026-10-27T12:10:00.000Z',
      },
      index + 1,
    ));
    const readStream = vi.fn(async () => history);
    const { capability } = captureCampfirePlugin(async (_context, objectId) => lifecycleStates.get(objectId));
    const context = {
      worldInstanceId,
      store: { readStream },
      now: () => new Date('2026-10-27T12:00:00.000Z'),
    };

    expect(await capability.atLocations(context as never, [])).toEqual(new Map());
    expect(readStream).not.toHaveBeenCalled();

    const rooms = await capability.atLocations(context as never, [
      'mossgate-clearing',
      'other-clearing',
    ]);
    expect([...rooms.keys()]).toEqual(['mossgate-clearing', 'other-clearing']);
    expect(rooms.get('mossgate-clearing')).toEqual([
      expect.objectContaining({ id: 'visible-life', label: 'Campfire' }),
    ]);
    expect(rooms.get('other-clearing')).toEqual([
      expect.objectContaining({ id: 'second-visible', label: 'Campfire' }),
    ]);
  });

  it('replays the campfire stream only when its revision changes', async () => {
    const lit = (campfireId: string, aggregateVersion: number) => storedEvent(TEMPORARY_CAMPFIRES_STREAM_ID, 'world.campfire_lit', {
      campfireId,
      locationId: 'mossgate-clearing',
      createdAt: '2026-10-27T11:50:00.000Z',
      expiresAt: '2026-10-27T12:10:00.000Z',
    }, aggregateVersion);
    let payloadReads = 0;
    const counted = (event: StoredGameEvent) => new Proxy(event, {
      get: (target, property) => {
        if (property === 'payload') payloadReads += 1;
        return Reflect.get(target, property);
      },
    });
    let history = [counted(lit('first-fire', 1))];
    const { capability } = captureCampfirePlugin(async () => ({ state: 'scheduled', expiresAt: '2026-10-27T12:10:00.000Z' }));
    const context = {
      worldInstanceId: 'campfire-cache-test',
      store: { readStream: async () => history },
      now: () => new Date('2026-10-27T12:00:00.000Z'),
    };

    expect((await capability.atLocations(context as never, ['mossgate-clearing'])).get('mossgate-clearing')).toHaveLength(1);
    const afterFirstReplay = payloadReads;
    await capability.atLocations(context as never, ['mossgate-clearing']);
    expect(payloadReads).toBe(afterFirstReplay);

    history = [...history, counted(lit('second-fire', 2))];
    expect((await capability.atLocations(context as never, ['mossgate-clearing'])).get('mossgate-clearing')).toHaveLength(2);
    expect(payloadReads).toBeGreaterThan(afterFirstReplay);
  });

  it('ignores unrelated and stale expiry events, then finalizes missing campfires', async () => {
    const lifecycleStream = objectLifecycleStreamId('campfire-missing');
    const schedule = objectLifecycleScheduledEvent({
      objectId: 'campfire-missing',
      objectType: 'campfire',
      locationId: 'mossgate-clearing',
      createdAt: '2026-10-27T12:00:00.000Z',
      expiresAt: '2026-10-27T12:10:00.000Z',
    });
    const lifecycleHistory = [
      storedEvent(lifecycleStream, schedule.type, schedule.payload, 1),
      storedEvent(lifecycleStream, 'world.object_expiring', {
        objectId: 'campfire-missing',
        objectType: 'campfire',
        locationId: 'mossgate-clearing',
        expiresAt: '2026-10-27T12:10:00.000Z',
      }, 2),
    ];
    let failReceipt = true;
    const store = {
      readStream: vi.fn(async (_worldId: string, streamId: string) =>
        streamId === lifecycleStream ? lifecycleHistory : []),
      append: vi.fn(async () => ({
        receipt: { ok: !failReceipt },
        kind: 'committed',
      })),
    };
    const { expirationHandler } = captureCampfirePlugin();
    const context = {
      effectId: 'effect-campfire-missing',
      worldInstanceId,
      store,
      now: () => new Date('2026-10-27T12:10:01.000Z'),
    };
    const payload = {
      objectId: 'campfire-missing',
      objectType: 'campfire',
      locationId: 'mossgate-clearing',
      expiresAt: '2026-10-27T12:10:00.000Z',
    };

    await expirationHandler({ ...payload, objectType: 'deer' }, context);
    expect(store.readStream).not.toHaveBeenCalled();
    await expirationHandler({ ...payload, expiresAt: '2026-10-27T12:11:00.000Z' }, context);
    expect(store.append).not.toHaveBeenCalled();

    await expect(expirationHandler(payload, context))
      .rejects.toThrow('Could not finalize the missing campfire lifecycle.');
    failReceipt = false;
    await expect(expirationHandler(payload, context)).resolves.toBeUndefined();
    expect(store.append).toHaveBeenLastCalledWith(expect.objectContaining({
      streamId: lifecycleStream,
      commandId: 'campfire-expire-missing:effect-campfire-missing',
      expectedVersion: 2,
      events: [expect.objectContaining({ type: 'world.object_expired' })],
    }));
  });

  it('fails explicitly when an expiry append is not committed', async () => {
    const lifecycleStream = objectLifecycleStreamId('campfire-rejected');
    const schedule = objectLifecycleScheduledEvent({
      objectId: 'campfire-rejected',
      objectType: 'campfire',
      locationId: 'mossgate-clearing',
      createdAt: '2026-10-27T12:00:00.000Z',
      expiresAt: '2026-10-27T12:10:00.000Z',
    });
    const lifecycleHistory = [
      storedEvent(lifecycleStream, schedule.type, schedule.payload, 1),
      storedEvent(lifecycleStream, 'world.object_expiring', {
        objectId: 'campfire-rejected',
        objectType: 'campfire',
        locationId: 'mossgate-clearing',
        expiresAt: '2026-10-27T12:10:00.000Z',
      }, 2),
    ];
    const campfireHistory = [storedEvent(TEMPORARY_CAMPFIRES_STREAM_ID, 'world.campfire_lit', {
      campfireId: 'campfire-rejected',
      locationId: 'mossgate-clearing',
      createdAt: '2026-10-27T12:00:00.000Z',
      expiresAt: '2026-10-27T12:10:00.000Z',
    }, 1)];
    const store = {
      readStream: vi.fn(async (_worldId: string, streamId: string) =>
        streamId === lifecycleStream ? lifecycleHistory : campfireHistory),
      append: vi.fn(async () => ({ receipt: { ok: false }, kind: 'rejected' })),
    };
    const { expirationHandler } = captureCampfirePlugin();

    await expect(expirationHandler({
      objectId: 'campfire-rejected',
      objectType: 'campfire',
      locationId: 'mossgate-clearing',
      expiresAt: '2026-10-27T12:10:00.000Z',
    }, {
      effectId: 'effect-campfire-rejected',
      worldInstanceId,
      store,
      now: () => new Date('2026-10-27T12:10:01.000Z'),
    })).rejects.toThrow('Could not atomically extinguish the campfire.');
  });

  it('rejects campfire commands for archived characters and invalid rooms', async () => {
    const { engine, store } = createEngine();
    await engine.start();
    const archivedCharacter = await createCharacter(engine, 'archived-campfire-character');
    const archived = await engine.dispatch({
      type: 'character.archive',
      version: 1,
      commandId: 'archive-campfire-character',
      worldInstanceId,
      characterId: archivedCharacter.characterId,
      expectedVersion: archivedCharacter.revision,
      payload: {},
    }, session);
    expect(archived.receipt.ok).toBe(true);

    const { commands } = captureCampfirePlugin();
    const light = commands.get('campfire.light')!;
    const extinguish = commands.get('campfire.extinguish')!;
    const context = {
      worldInstanceId,
      store,
      world: demoWorld,
      makeId: () => 'unused-campfire-id',
      now: () => new Date('2026-10-27T12:00:00.000Z'),
    };
    await expect(light({ characterId: archivedCharacter.characterId, payload: {} }, context))
      .rejects.toThrow('That character is no longer available.');
    await expect(extinguish({
      characterId: archivedCharacter.characterId,
      payload: { campfireId: 'unused-campfire-id' },
    }, context)).rejects.toThrow('That character is no longer available.');

    const misplacedCharacter = await createCharacter(engine, 'misplaced-campfire-character');
    const moved = await store.append({
      worldInstanceId,
      streamId: misplacedCharacter.characterId,
      actorId: SYSTEM_ACTOR_ID,
      commandId: 'move-campfire-character-outside-world',
      payloadHash: 'move-campfire-character-outside-world',
      expectedVersion: misplacedCharacter.revision,
      events: [{
        type: 'character.moved',
        version: 1,
        payload: {
          characterId: misplacedCharacter.characterId,
          fromLocationId: 'mossgate-clearing',
          toLocationId: 'missing-location',
          exitId: 'missing-exit',
        },
      }],
    });
    expect(moved.receipt.ok).toBe(true);
    await expect(light({ characterId: misplacedCharacter.characterId, payload: {} }, context))
      .rejects.toThrow('The character location is not present in this world version.');
    await engine.stop();
  });

  it('does not extinguish a campfire whose lifecycle is no longer active', async () => {
    const { engine, store } = createEngine();
    await engine.start();
    const character = await createCharacter(engine, 'cancelled-lifecycle-character');
    const lit = await engine.dispatch({
      type: 'campfire.light',
      version: 1,
      commandId: 'light-before-lifecycle-cancel',
      worldInstanceId,
      characterId: character.characterId,
      expectedVersion: character.revision,
      payload: {},
    }, session);
    expect(lit.receipt.ok).toBe(true);
    const campfireId = String(lit.events[0]!.payload.campfireId);
    const lifecycle = projectObjectLifecycle(
      await store.readStream(worldInstanceId, objectLifecycleStreamId(campfireId)),
    )!;
    const cancelled = await store.append({
      worldInstanceId,
      streamId: objectLifecycleStreamId(campfireId),
      actorId: SYSTEM_ACTOR_ID,
      commandId: 'cancel-before-campfire-extinguish',
      payloadHash: 'cancel-before-campfire-extinguish',
      expectedVersion: lifecycle.revision,
      events: [{
        type: 'world.object_lifecycle_cancelled',
        version: 1,
        payload: {
          objectId: campfireId,
          objectType: 'campfire',
          locationId: lifecycle.locationId,
        },
      }],
    });
    expect(cancelled.receipt.ok).toBe(true);

    const { commands } = captureCampfirePlugin(async () => projectObjectLifecycle(
      await store.readStream(worldInstanceId, objectLifecycleStreamId(campfireId)),
    ));
    await expect(commands.get('campfire.extinguish')!({
      characterId: character.characterId,
      payload: { campfireId },
    }, {
      worldInstanceId,
      store,
      now: () => new Date('2026-10-27T12:01:00.000Z'),
    })).rejects.toThrow('That campfire is no longer burning.');
    await engine.stop();
  });

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

  it('keeps another campfire and its scheduled lifecycle when one is extinguished', async () => {
    const { engine, store } = createEngine();
    await engine.start();
    const character = await createCharacter(engine);

    const firstLit = await engine.dispatch({
      type: 'campfire.light',
      version: 1,
      commandId: 'light-first-of-two-campfires',
      worldInstanceId,
      characterId: character.characterId,
      expectedVersion: character.revision,
      payload: {},
    }, session);
    const secondLit = await engine.dispatch({
      type: 'campfire.light',
      version: 1,
      commandId: 'light-second-of-two-campfires',
      worldInstanceId,
      characterId: character.characterId,
      expectedVersion: character.revision,
      payload: {},
    }, session);
    expect(firstLit.receipt.ok).toBe(true);
    expect(secondLit.receipt.ok).toBe(true);

    const firstCampfireId = String(firstLit.events[0]!.payload.campfireId);
    const secondCampfireId = String(secondLit.events[0]!.payload.campfireId);
    const secondLifecycleStream = objectLifecycleStreamId(secondCampfireId);
    const secondLifecycleBefore = projectObjectLifecycle(
      await store.readStream(worldInstanceId, secondLifecycleStream),
    );
    expect(secondLifecycleBefore).toMatchObject({
      objectId: secondCampfireId,
      objectType: 'campfire',
      state: 'scheduled',
    });
    expect((await roomProjection(engine, character.characterId)).objects)
      .toEqual(expect.arrayContaining([
        expect.objectContaining({ id: firstCampfireId, label: 'Campfire' }),
        expect.objectContaining({ id: secondCampfireId, label: 'Campfire' }),
      ]));

    const extinguished = await engine.dispatch({
      type: 'campfire.extinguish',
      version: 1,
      commandId: 'extinguish-first-of-two-campfires',
      worldInstanceId,
      characterId: character.characterId,
      expectedVersion: character.revision,
      payload: { campfireId: firstCampfireId },
    }, session);
    expect(extinguished.receipt.ok).toBe(true);

    const campfires = projectTemporaryCampfires(
      await store.readStream(worldInstanceId, TEMPORARY_CAMPFIRES_STREAM_ID),
    );
    expect(campfires).toContainEqual(expect.objectContaining({
      campfireId: firstCampfireId,
      extinguished: true,
    }));
    expect(campfires).toContainEqual(expect.objectContaining({
      campfireId: secondCampfireId,
      extinguished: false,
    }));
    expect(projectObjectLifecycle(
      await store.readStream(worldInstanceId, objectLifecycleStreamId(firstCampfireId)),
    )).toMatchObject({ state: 'cancelled' });
    expect(projectObjectLifecycle(
      await store.readStream(worldInstanceId, secondLifecycleStream),
    )).toEqual(secondLifecycleBefore);

    const roomAfter = await roomProjection(engine, character.characterId);
    expect(roomAfter.objects).not.toContainEqual(expect.objectContaining({ id: firstCampfireId }));
    expect(roomAfter.objects).toContainEqual(expect.objectContaining({
      id: secondCampfireId,
      label: 'Campfire',
    }));
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
