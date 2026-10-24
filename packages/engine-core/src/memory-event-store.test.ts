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
});
