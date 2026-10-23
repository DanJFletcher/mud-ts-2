import { replayCharacter, SYSTEM_ACTOR_ID } from '@mudd/engine-core';
import type { EngineHost, EventStorePort } from '@mudd/engine-core';

export interface StaminaRecoverySession {
  readonly characterId: string;
  readonly lastSeenAt: Date;
}

export function createStaminaRecoveryScheduler(input: Readonly<{
  engine: EngineHost;
  store: Pick<EventStorePort, 'readStream'>;
  worldInstanceId: string;
  listSessions: () => Promise<readonly StaminaRecoverySession[]>;
  now?: () => Date;
  intervalMs?: number;
  onlineWindowMs?: number;
  onError?: (error: unknown, characterId: string) => void;
}>) {
  const now = input.now ?? (() => new Date());
  const intervalMs = input.intervalMs ?? 1_000;
  const onlineWindowMs = input.onlineWindowMs ?? 45_000;
  let timer: ReturnType<typeof setInterval> | undefined;
  let running = false;

  const tick = async (): Promise<number> => {
    if (running) return 0;
    running = true;
    let attempted = 0;
    const currentTime = now();
    try {
      const sessions = await input.listSessions();
      for (const session of sessions) {
        try {
          const events = await input.store.readStream(input.worldInstanceId, session.characterId);
          const character = replayCharacter(events);
          if (!character || character.archived || character.health?.current === 0) continue;
          const seenAt = session.lastSeenAt.getTime();
          const online = currentTime.getTime() - seenAt <= onlineWindowMs;
          if (!online && !character.staminaRecovery.lastSettledAt) continue;
          const settleAt = new Date(Math.min(currentTime.getTime(), seenAt));
          const previousAt = character.staminaRecovery.lastSettledAt
            ? Date.parse(character.staminaRecovery.lastSettledAt)
            : undefined;
          const hasMissingVital =
            character.health === undefined ||
            character.health.current < character.health.maximum ||
            character.resources.stamina.current < character.resources.stamina.maximum ||
            character.resources.mana.current < character.resources.mana.maximum;
          if (
            !hasMissingVital &&
            character.staminaRecovery.fractionalCarry === 0 &&
            character.staminaRecovery.healthFractionalCarry === 0 &&
            character.staminaRecovery.manaFractionalCarry === 0
          ) continue;
          if (online && previousAt !== undefined && settleAt.getTime() - previousAt < 1_000) continue;
          if (!online && previousAt !== undefined && previousAt >= seenAt) continue;

          const expectedVersion = events.at(-1)?.aggregateVersion ?? 0;
          const result = await input.engine.dispatchSystem({
            type: 'character.stamina.recover',
            version: 1,
            commandId: `stamina-recovery:${session.characterId}:${expectedVersion}`,
            worldInstanceId: input.worldInstanceId,
            characterId: session.characterId,
            expectedVersion,
            payload: { settleAt: settleAt.toISOString(), resetAnchor: false },
          }, SYSTEM_ACTOR_ID);
          attempted += 1;
          if (!result.receipt.ok && result.receipt.code !== 'VERSION_CONFLICT') {
            input.onError?.(new Error(result.receipt.message), session.characterId);
          }
        } catch (error) {
          input.onError?.(error, session.characterId);
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
