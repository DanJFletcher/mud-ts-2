import { describe, expect, it } from 'vitest';
import { InMemoryEventStore } from './memory-event-store.js';
import type { AppendRequest } from './types.js';

const action = (commandId = 'ability-1'): AppendRequest => ({
  worldInstanceId: 'world', actorId: 'player', commandId, payloadHash: 'resolved-action',
  streamId: 'encounter', expectedVersion: 0,
  events: [{ type: 'fixture.turn_resolved', version: 1, payload: { damage: 4 } }],
  companions: [{ streamId: 'character', expectedVersion: 0,
    events: [{ type: 'fixture.resource_spent', version: 1, payload: { remaining: 80 } }] }],
  guards: [{ streamId: 'lifecycle', expectedVersion: 0 }],
  effects: [{ type: 'fixture.reward', version: 1, payload: {} }],
});

describe('atomic multi-stream combat persistence', () => {
  it('commits both streams and exactly one durable effect under a duplicate command', async () => {
    const store = new InMemoryEventStore();
    const outcomes = await Promise.all([store.append(action()), store.append(action())]);
    expect(outcomes.map((outcome) => outcome.kind)).toEqual(['committed', 'duplicate']);
    expect(await store.readStream('world', 'character')).toHaveLength(1);
    expect(await store.readStream('world', 'encounter')).toHaveLength(1);
    expect(await store.claimNextEffect(1000)).toBeDefined();
    expect(await store.claimNextEffect(1000)).toBeUndefined();
  });
  it.each(['character', 'lifecycle'])('a racing %s write rejects the whole turn, debit and effects', async (streamId) => {
    const store = new InMemoryEventStore();
    await store.append({ ...action('racer'), streamId, companions: [], guards: [], effects: [],
      events: [{ type: 'fixture.concurrent_change', version: 1, payload: {} }] });
    expect((await store.append(action())).kind).toBe('conflict');
    expect(await store.readStream('world', 'encounter')).toHaveLength(0);
    expect(await store.readStream('world', 'character')).toHaveLength(streamId === 'character' ? 1 : 0);
    expect(await store.claimNextEffect(1000)).toBeUndefined();
  });
  it('competing turns cannot consume one character resource twice', async () => {
    const store = new InMemoryEventStore();
    const second = { ...action('ability-2'), streamId: 'other-encounter' };
    const outcomes = await Promise.all([store.append(action()), store.append(second)]);
    expect(outcomes.filter((outcome) => outcome.kind === 'committed')).toHaveLength(1);
    expect(await store.readStream('world', 'character')).toHaveLength(1);
    expect(await store.readStream('world', 'other-encounter')).toHaveLength(0);
  });
});
