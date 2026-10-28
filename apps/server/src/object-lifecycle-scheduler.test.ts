import { describe, expect, it, vi } from 'vitest';
import type { WorldRuntime } from './world-registry.js';
import type { PostgresEventStore } from './persistence/postgres-event-store.js';
import { createObjectLifecycleScheduler } from './object-lifecycle-scheduler.js';

const dueObject = {
  objectId: 'old-corpse',
  revision: 4,
  leaseToken: 'lease-token',
};

function runtime(engine: Record<string, unknown>): WorldRuntime {
  return {
    worldInstanceId: 'test-world',
    engine,
  } as unknown as WorldRuntime;
}

function createScheduler(
  claimDueObjectLifecycles: (...args: unknown[]) => Promise<unknown[]>,
  releaseObjectLifecycleClaim: (...args: unknown[]) => Promise<void>,
  dispatchSystem: (...args: unknown[]) => Promise<unknown>,
  onError?: (error: unknown, worldInstanceId: string, objectId?: string) => void,
) {
  const runtimes: WorldRuntime[] = [];
  const scheduler = createObjectLifecycleScheduler({
    runtimes,
    store: { claimDueObjectLifecycles, releaseObjectLifecycleClaim } as unknown as PostgresEventStore,
    onError,
  });
  // The constructor's immediate startup run sees no runtimes and completes synchronously.
  runtimes.push(runtime({ dispatchSystem }));
  return scheduler;
}

describe('object lifecycle scheduler', () => {
  it('expires due objects and releases claims for rejected or thrown commands', async () => {
    const dispatchError = new Error('Engine unavailable.');
    const dispatchSystem = vi.fn()
      .mockResolvedValueOnce({ receipt: { ok: true } })
      .mockResolvedValueOnce({ receipt: { ok: false, message: 'Expiration rejected.' } })
      .mockRejectedValueOnce(dispatchError);
    const claimDueObjectLifecycles = vi.fn(async () => [dueObject]);
    const releaseObjectLifecycleClaim = vi.fn()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('Lease already released.'));
    const onError = vi.fn();
    const scheduler = createScheduler(
      claimDueObjectLifecycles,
      releaseObjectLifecycleClaim,
      dispatchSystem,
      onError,
    );

    await scheduler.run();
    expect(dispatchSystem).toHaveBeenNthCalledWith(1, expect.objectContaining({
      type: 'world.object.expire',
      worldInstanceId: 'test-world',
      expectedVersion: dueObject.revision,
      payload: { objectId: dueObject.objectId },
    }), expect.any(String));
    expect(releaseObjectLifecycleClaim).not.toHaveBeenCalled();

    await scheduler.run();
    expect(releaseObjectLifecycleClaim).toHaveBeenCalledWith(
      'test-world',
      dueObject.objectId,
      dueObject.leaseToken,
    );
    expect(onError).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'Expiration rejected.' }),
      'test-world',
      dueObject.objectId,
    );

    await scheduler.run();
    expect(releaseObjectLifecycleClaim).toHaveBeenCalledTimes(2);
    expect(onError).toHaveBeenLastCalledWith(dispatchError, 'test-world', dueObject.objectId);
    scheduler.stop();
  });

  it('reports claim failures against the all-worlds scope and stops cleanly', async () => {
    const error = new Error('Could not claim due objects.');
    const claimDueObjectLifecycles = vi.fn(async () => {
      throw error;
    });
    const onError = vi.fn();
    const scheduler = createScheduler(
      claimDueObjectLifecycles,
      vi.fn(async () => undefined),
      vi.fn(async () => undefined),
      onError,
    );

    await scheduler.run();
    expect(claimDueObjectLifecycles).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledWith(error, 'all-worlds');

    scheduler.stop();
    await scheduler.run();
    expect(claimDueObjectLifecycles).toHaveBeenCalledTimes(1);
  });
});
