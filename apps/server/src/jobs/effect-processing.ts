import { measureDatabaseOperation } from '../app/performance.js';
import { type WorldRuntime } from '../worlds/world-registry.js';
import { type ServerDependencies } from '../app/dependencies.js';

export function startEffectProcessing(dependencies: Pick<
  ServerDependencies,
  | 'store'
  | 'worldRuntimes'
  | 'timers'
>) {
  const { store, worldRuntimes, timers } = dependencies;
  const { setInterval, clearInterval, setTimeout, clearTimeout } = timers;
  const EFFECT_BATCH_LIMIT = 25;
  const MAX_EFFECT_BATCH_PASSES = 8;
  const runningEffectBatches = new Set<string>();
  const requestedEffectBatches = new Set<string>();
  async function runWorldEffectBatch(runtime: WorldRuntime) {
    const worldInstanceId = runtime.worldInstanceId;
    if (runningEffectBatches.has(worldInstanceId)) {
      // Don't overlap batches for a world; the running one repeats once it finishes.
      requestedEffectBatches.add(worldInstanceId);
      return;
    }
    runningEffectBatches.add(worldInstanceId);
    try {
      for (let pass = 0;pass < MAX_EFFECT_BATCH_PASSES;pass += 1) {
        requestedEffectBatches.delete(worldInstanceId);
        const processed = await measureDatabaseOperation('effect_batch.process_pending', () =>
          runtime.engine.processPendingEffects(EFFECT_BATCH_LIMIT, worldInstanceId));
        if (!requestedEffectBatches.has(worldInstanceId) && !(processed >= EFFECT_BATCH_LIMIT)) break;
      }
    } catch {
      console.error('Could not process durable event effects.');
    } finally {
      runningEffectBatches.delete(worldInstanceId);
    }
  }
  /** Process due effects for one world, or for every world when none is given. */
  async function runPendingEffectBatch(worldInstanceId?: string) {
    return store.withoutCommandReadCache(async () => {
      const runtimes = worldInstanceId === undefined
        ? [...worldRuntimes.values()]
        : [worldRuntimes.get(worldInstanceId)].filter((runtime): runtime is WorldRuntime => Boolean(runtime));
      await Promise.all(runtimes.map((runtime) => runWorldEffectBatch(runtime)));
    });
  }
  // Every commit already wakes this process through LISTEN, so newly queued
  // effects run promptly without polling each world every second. The slower
  // poll remains for delayed retries and missed notifications.
  const EFFECT_WAKEUP_DEBOUNCE_MS = 50;
  const effectWakeups = new Map<string, ReturnType<typeof setTimeout>>();
  function wakeEffectBatch(worldInstanceId: unknown) {
    if (typeof worldInstanceId !== 'string' || !worldRuntimes.has(worldInstanceId)) return;
    if (effectWakeups.has(worldInstanceId)) return;
    const timer = setTimeout(() => {
      effectWakeups.delete(worldInstanceId);
      void runPendingEffectBatch(worldInstanceId);
    }, EFFECT_WAKEUP_DEBOUNCE_MS);
    timer.unref();
    effectWakeups.set(worldInstanceId, timer);
  }
  void runPendingEffectBatch();
  const effectPoller = setInterval(() => void runPendingEffectBatch(), 5_000);
  effectPoller.unref();
  return {
    runPendingEffectBatch,
    wakeEffectBatch,
    stop() {
      clearInterval(effectPoller);
      for (const timer of effectWakeups.values()) clearTimeout(timer);
      effectWakeups.clear();
    },
  };
}

export type EffectProcessing = ReturnType<typeof startEffectProcessing>;
