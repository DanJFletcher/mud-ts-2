import { describe, expect, it } from 'vitest';
import { InMemoryEventStore } from './memory-event-store.js';

describe('InMemoryEventStore stream revisions', () => {
  it('returns the latest revision without reading event payloads', async () => {
    const store = new InMemoryEventStore();
    const request = {
      worldInstanceId: 'revision-test-world',
      streamId: 'character-one',
      actorId: 'revision-test-actor',
      commandId: 'revision-test-command',
      payloadHash: 'revision-test-hash',
      expectedVersion: 0,
      events: [{ type: 'revision.test', version: 1, payload: { value: 'first' } }],
    };

    expect(await store.readStreamRevision(request.worldInstanceId, request.streamId)).toBe(0);
    await store.append(request);
    expect(await store.readStreamRevision(request.worldInstanceId, request.streamId)).toBe(1);
    expect(await store.readStreamRevision(request.worldInstanceId, 'another-stream')).toBe(0);
  });

  it('reads a deduplicated set of streams as one batch result', async () => {
    const store = new InMemoryEventStore();
    const first = {
      worldInstanceId: 'batch-test-world',
      streamId: 'world-npc:first',
      actorId: 'batch-test-actor',
      commandId: 'batch-test-first',
      payloadHash: 'batch-test-first-hash',
      expectedVersion: 0,
      events: [{ type: 'npc.test', version: 1, payload: { position: 'north' } }],
    };
    const second = {
      ...first,
      streamId: 'world-npc:second',
      commandId: 'batch-test-second',
      payloadHash: 'batch-test-second-hash',
      events: [{ type: 'npc.test', version: 1, payload: { position: 'south' } }],
    };
    await store.append(first);
    await store.append(second);

    const streams = await store.readStreams(first.worldInstanceId, [
      first.streamId,
      second.streamId,
      first.streamId,
      'world-npc:missing',
    ]);

    expect([...streams.keys()]).toEqual([
      first.streamId,
      second.streamId,
      'world-npc:missing',
    ]);
    expect(streams.get(first.streamId)?.[0]?.payload).toEqual({ position: 'north' });
    expect(streams.get(second.streamId)?.[0]?.payload).toEqual({ position: 'south' });
    expect(streams.get('world-npc:missing')).toEqual([]);
  });

  it('rejects reused command IDs with changed payloads and stale stream revisions', async () => {
    const store = new InMemoryEventStore();
    const request = {
      worldInstanceId: 'idempotency-test-world',
      streamId: 'character-one',
      actorId: 'idempotency-test-actor',
      commandId: 'idempotency-test-command',
      payloadHash: 'original-payload',
      expectedVersion: 0,
      events: [{ type: 'character.test', version: 1, payload: { value: 'first' } }],
    };

    await store.append(request);
    const reusedId = await store.append({ ...request, payloadHash: 'different-payload' });
    expect(reusedId).toMatchObject({
      kind: 'conflict',
      receipt: { ok: false, code: 'INVALID_COMMAND' },
    });

    const staleVersion = await store.append({
      ...request,
      commandId: 'new-command',
      payloadHash: 'new-payload',
    });
    expect(staleVersion).toMatchObject({
      kind: 'conflict',
      receipt: { ok: false, code: 'VERSION_CONFLICT' },
    });
  });

  it('requires event batches for every atomic write', async () => {
    const store = new InMemoryEventStore();
    const request = {
      worldInstanceId: 'atomic-empty-test-world',
      streamId: 'encounter',
      actorId: 'atomic-empty-test-actor',
      commandId: 'atomic-empty-test-command',
      payloadHash: 'atomic-empty-test-hash',
      expectedVersion: 0,
      events: [{ type: 'encounter.test', version: 1, payload: {} }],
    };

    await expect(store.append({
      ...request,
      companions: [{ streamId: 'character', expectedVersion: 0, events: [] }],
    })).rejects.toThrow('Atomic writes must contain events.');
    await expect(store.append({
      ...request,
      events: [],
      companions: [{
        streamId: 'character',
        expectedVersion: 0,
        events: [{ type: 'character.test', version: 1, payload: {} }],
      }],
    })).rejects.toThrow('Atomic writes must contain events.');
  });

  it('claims only due effects of the given types that one actor’s command queued', async () => {
    const store = new InMemoryEventStore();
    const request = {
      worldInstanceId: 'command-effect-world',
      streamId: 'world-items',
      actorId: 'player-one',
      commandId: 'shared-command-id',
      payloadHash: 'player-one-hash',
      expectedVersion: 0,
      events: [{ type: 'world.test', version: 1, payload: {} }],
      effects: [
        { type: 'test.background', version: 1, payload: { order: 1 } },
        { type: 'test.completing', version: 1, payload: { order: 2 } },
      ],
    };
    await store.append(request);
    // Another player chose the same command ID; that command's effects are not ours.
    await store.append({
      ...request,
      streamId: 'other-stream',
      actorId: 'player-two',
      payloadHash: 'player-two-hash',
      effects: [{ type: 'test.completing', version: 1, payload: { order: 3 } }],
    });
    // A command ID that extends ours must not match through the key prefix.
    await store.append({
      ...request,
      streamId: 'third-stream',
      commandId: 'shared-command-id:9',
      payloadHash: 'extended-id-hash',
      effects: [{ type: 'test.completing', version: 1, payload: { order: 4 } }],
    });
    const scope = {
      worldInstanceId: request.worldInstanceId,
      actorId: request.actorId,
      commandId: request.commandId,
      types: ['test.completing'],
    };

    const claimed = await store.claimCommandEffect(60_000, scope);
    expect(claimed).toMatchObject({
      type: 'test.completing',
      payload: { order: 2 },
      causationCommandId: 'shared-command-id',
      attempts: 1,
    });
    // Leased now, so neither the command claim nor the worker sees it.
    expect(await store.claimCommandEffect(60_000, scope)).toBeUndefined();
    expect(await store.claimCommandEffect(60_000, { ...scope, worldInstanceId: 'another-world' })).toBeUndefined();
    expect(await store.claimCommandEffect(60_000, { ...scope, commandId: 'shared-command' })).toBeUndefined();

    expect(await store.retryEffect(claimed!.id, claimed!.leaseToken, 60_000, 'later')).toBe(true);
    expect(await store.claimCommandEffect(60_000, scope)).toBeUndefined();

    const worker = [
      await store.claimNextEffect(60_000),
      await store.claimNextEffect(60_000),
      await store.claimNextEffect(60_000),
    ];
    expect(worker.map((effect) => effect?.payload)).toEqual([{ order: 1 }, { order: 3 }, { order: 4 }]);
  });
});
