import { SYSTEM_ACTOR_ID } from '@mudd/engine-core';
import type { WorldRuntime } from './world-registry.js';
import type { PostgresEventStore } from './persistence/postgres-event-store.js';

const BATCH_SIZE = 32;
const LEASE_MS = 60_000;

export function createObjectLifecycleScheduler(options: {
  readonly runtimes: readonly WorldRuntime[];
  readonly store: PostgresEventStore;
  readonly onError?: (error: unknown, worldInstanceId: string, objectId?: string) => void;
}) {
  let running = false;
  let stopped = false;
  const run = async () => {
    if (stopped || running) return;
    running = true;
    try {
      for (const runtime of options.runtimes) {
        const due = await options.store.claimDueObjectLifecycles(
          runtime.worldInstanceId,
          new Date(),
          BATCH_SIZE,
          LEASE_MS,
        );
        for (const object of due) {
          try {
            const result = await runtime.engine.dispatchSystem({
              type: 'world.object.expire',
              version: 1,
              commandId: `world-object-expire:${object.objectId}:${object.revision}`,
              worldInstanceId: runtime.worldInstanceId,
              expectedVersion: object.revision,
              payload: { objectId: object.objectId },
            }, SYSTEM_ACTOR_ID);
            if (!result.receipt.ok) {
              await options.store.releaseObjectLifecycleClaim(
                runtime.worldInstanceId,
                object.objectId,
                object.leaseToken,
              );
              options.onError?.(
                new Error(result.receipt.message ?? 'Object expiration command was rejected.'),
                runtime.worldInstanceId,
                object.objectId,
              );
            }
          } catch (error) {
            await options.store.releaseObjectLifecycleClaim(
              runtime.worldInstanceId,
              object.objectId,
              object.leaseToken,
            ).catch(() => undefined);
            options.onError?.(error, runtime.worldInstanceId, object.objectId);
          }
        }
      }
    } catch (error) {
      options.onError?.(error, 'all-worlds');
    } finally {
      running = false;
    }
  };
  const timer = setInterval(() => void run(), 10_000);
  timer.unref();
  void run();
  return {
    run,
    stop() {
      stopped = true;
      clearInterval(timer);
    },
  };
}
