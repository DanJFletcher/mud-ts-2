import {
  autonomousNpcStreamId,
  mobileNpcDefinitions,
  projectAutonomousNpcPosition,
} from '@mudd/core-plugins';
import type { EngineHost, EventStorePort } from '@mudd/engine-core';
import type { WorldPackDraft } from '@mudd/contracts';

const SYSTEM_ACTOR_ID = 'system:autonomous-npc-scheduler';

export function createAutonomousNpcScheduler(input: Readonly<{
  engine: EngineHost;
  store: EventStorePort;
  world: WorldPackDraft;
  worldInstanceId: string;
  now?: () => Date;
  intervalMs?: number;
  onError?: (error: unknown, npcId: string) => void;
}>) {
  const now = input.now ?? (() => new Date());
  const intervalMs = input.intervalMs ?? 1_000;
  let timer: ReturnType<typeof setInterval> | undefined;
  let running = false;

  const tick = async (): Promise<number> => {
    if (running) return 0;
    running = true;
    let attempted = 0;
    try {
      for (const { npc, initialLocationId } of mobileNpcDefinitions(input.world)) {
        if (!npc.movement) continue;
        try {
          const events = await input.store.readStream(
            input.worldInstanceId,
            autonomousNpcStreamId(npc.id),
          );
          const position = projectAutonomousNpcPosition(events, npc.id, initialLocationId);
          const currentTime = now();
          if (
            position.lastAttemptAt &&
            currentTime.getTime() - Date.parse(position.lastAttemptAt) < npc.movement.intervalMs
          ) continue;

          const result = await input.engine.dispatchSystem({
            type: 'world.npc.tick',
            version: 1,
            commandId: `npc-tick:${globalThis.crypto.randomUUID()}`,
            worldInstanceId: input.worldInstanceId,
            npcId: npc.id,
          }, SYSTEM_ACTOR_ID);
          attempted += 1;
          if (!result.receipt.ok && result.receipt.code !== 'VERSION_CONFLICT') {
            input.onError?.(new Error(result.receipt.message), npc.id);
          }
        } catch (error) {
          input.onError?.(error, npc.id);
        }
      }
    } finally {
      running = false;
    }
    return attempted;
  };

  return {
    tick,
    start() {
      if (timer) return;
      void tick();
      timer = setInterval(() => void tick(), intervalMs);
      timer.unref?.();
    },
    stop() {
      if (!timer) return;
      clearInterval(timer);
      timer = undefined;
    },
  };
}
