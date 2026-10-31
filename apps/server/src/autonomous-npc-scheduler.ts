import {
  autonomousNpcStreamId,
  effectiveAutonomousNpcMovementIntervalMs,
  mobileNpcDefinitions,
  projectAutonomousNpcPosition,
} from '@mudd/core-plugins';
import type { EngineHost, EventStorePort } from '@mudd/engine-core';
import type { WorldPackDraft } from '@mudd/contracts';

export const AUTONOMOUS_NPC_SYSTEM_ACTOR_ID = '00000000-0000-4000-8000-000000000001';

// Bounds for the next wake-up. NPCs move at most once a minute, so the timer
// sleeps until the earliest due NPC instead of replaying every NPC each second.
const MIN_WAKE_DELAY_MS = 1_000;
const MAX_WAKE_DELAY_MS = 60_000;
// After a rejected or failed tick, wait before reading that NPC's stream again.
const FAILURE_RETRY_MS = 5_000;

export function createAutonomousNpcScheduler(input: Readonly<{
  engine: EngineHost;
  store: EventStorePort;
  world: WorldPackDraft;
  worldInstanceId: string;
  now?: () => Date;
  /** When provided, NPCs only move while this returns true, and the timer sleeps otherwise. */
  isActive?: () => boolean;
  onError?: (error: unknown, npcId: string) => void;
}>) {
  const now = input.now ?? (() => new Date());
  const mobileNpcs = mobileNpcDefinitions(input.world).filter(({ npc }) => npc.movement);
  // When each NPC may next move. Missing means unknown, so the next tick reads
  // its stream once; afterwards a tick skips NPCs that are not yet due.
  const nextDueAt = new Map<string, number>();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let started = false;
  let running = false;

  const tick = async (): Promise<number> => {
    if (running) return 0;
    if (input.isActive && !input.isActive()) return 0;
    running = true;
    let attempted = 0;
    try {
      for (const { npc, initialLocationId } of mobileNpcs) {
        const movementIntervalMs = effectiveAutonomousNpcMovementIntervalMs(npc.movement!.intervalMs);
        const dueAt = nextDueAt.get(npc.id);
        if (dueAt !== undefined && now().getTime() < dueAt) continue;
        try {
          const events = await input.store.readStream(
            input.worldInstanceId,
            autonomousNpcStreamId(npc.id),
          );
          const position = projectAutonomousNpcPosition(events, npc.id, initialLocationId);
          const currentTime = now().getTime();
          if (position.lastAttemptAt) {
            const positionDueAt = Date.parse(position.lastAttemptAt) + movementIntervalMs;
            if (currentTime < positionDueAt) {
              nextDueAt.set(npc.id, positionDueAt);
              continue;
            }
          }

          const result = await input.engine.dispatchSystem({
            type: 'world.npc.tick',
            version: 1,
            commandId: `npc-tick:${globalThis.crypto.randomUUID()}`,
            worldInstanceId: input.worldInstanceId,
            npcId: npc.id,
          }, AUTONOMOUS_NPC_SYSTEM_ACTOR_ID);
          attempted += 1;
          if (result.receipt.ok) {
            nextDueAt.set(npc.id, currentTime + movementIntervalMs);
          } else if (result.receipt.code === 'VERSION_CONFLICT') {
            // Another writer moved it; reread on the next tick.
            nextDueAt.delete(npc.id);
          } else {
            nextDueAt.set(npc.id, currentTime + FAILURE_RETRY_MS);
            input.onError?.(new Error(result.receipt.message), npc.id);
          }
        } catch (error) {
          nextDueAt.set(npc.id, now().getTime() + FAILURE_RETRY_MS);
          input.onError?.(error, npc.id);
        }
      }
    } finally {
      running = false;
    }
    return attempted;
  };

  const wakeDelayMs = () => {
    const currentTime = now().getTime();
    let earliest = currentTime + MAX_WAKE_DELAY_MS;
    for (const { npc } of mobileNpcs) {
      earliest = Math.min(earliest, nextDueAt.get(npc.id) ?? currentTime);
    }
    return Math.min(MAX_WAKE_DELAY_MS, Math.max(MIN_WAKE_DELAY_MS, earliest - currentTime));
  };

  const schedule = (delayMs: number) => {
    timer = setTimeout(() => {
      timer = undefined;
      void tick().finally(() => {
        // Sleep while the world is idle; wake() restarts the timer on activity.
        if (started && !timer && (!input.isActive || input.isActive())) schedule(wakeDelayMs());
      });
    }, delayMs);
    timer.unref?.();
  };

  return {
    tick,
    start() {
      if (started || !mobileNpcs.length) return;
      started = true;
      schedule(0);
    },
    /** Resume a sleeping timer, for example when a player becomes active. */
    wake() {
      if (!started || timer || running) return;
      schedule(0);
    },
    stop() {
      started = false;
      if (!timer) return;
      clearTimeout(timer);
      timer = undefined;
    },
  };
}
