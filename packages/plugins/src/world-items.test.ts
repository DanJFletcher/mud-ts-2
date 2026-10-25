import { describe, expect, it, vi } from 'vitest';
import type { StoredGameEvent } from '@mudd/engine-core';
import { worldItemsPlugin, type WorldItemsStateCapability } from './world-items.js';

function captureWorldItemsCapability() {
  let capability: WorldItemsStateCapability | undefined;
  worldItemsPlugin.register({
    provideCapability: (_token: unknown, implementation: unknown) => {
      capability = implementation as WorldItemsStateCapability;
    },
    registerEffect: () => undefined,
  } as never);
  if (!capability) throw new Error('World items capability was not registered.');
  return capability;
}

describe('world item projection cache', () => {
  it('reuses only an authoritative revision and returns independent projection copies', async () => {
    let iterations = 0;
    const emptyHistory = new Proxy([] as StoredGameEvent[], {
      get(target, property, receiver) {
        if (property === Symbol.iterator) iterations += 1;
        return Reflect.get(target, property, receiver);
      },
    });
    let history: readonly StoredGameEvent[] = emptyHistory;
    const readStream = vi.fn(async () => history);
    const capability = captureWorldItemsCapability();
    const context = {
      worldInstanceId: 'world-items-cache-test',
      store: { readStream },
    } as never;

    const first = await capability.load(context);
    (first.items as unknown[]).push({ not: 'shared with the cache' });
    const sameRevision = await capability.load(context);

    expect(readStream).toHaveBeenCalledTimes(2);
    expect(iterations).toBe(1);
    expect(sameRevision.items).toEqual([]);
    expect(sameRevision.items).not.toBe(first.items);

    history = [{
      type: 'world.item.invalid',
      version: 1,
      payload: {},
      eventId: 'event-1',
      worldInstanceId: 'world-items-cache-test',
      streamId: 'world-items',
      aggregateId: 'world-items',
      aggregateVersion: 1,
      causationCommandId: 'command-1',
      actorId: 'actor-1',
      occurredAt: '2026-01-01T00:00:00.000Z',
      tick: 1,
    }];
    await expect(capability.load(context)).rejects.toThrow('Unsupported world item event');
  });
});
