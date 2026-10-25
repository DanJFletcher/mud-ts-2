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
});
