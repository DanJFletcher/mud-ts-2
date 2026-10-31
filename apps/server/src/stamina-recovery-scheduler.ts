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
  listSessions: (activeSince?: Date) => Promise<readonly StaminaRecoverySession[]>;
  now?: () => Date;
  enabled?: boolean;
  intervalMs?: number;
  onlineWindowMs?: number;
  onError?: (error: unknown, characterId: string) => void;
}>) {
  const now = input.now ?? (() => new Date());
  const enabled = input.enabled ?? true;
  const intervalMs = input.intervalMs ?? 1_000;
  const onlineWindowMs = input.onlineWindowMs ?? 45_000;
  let timer: ReturnType<typeof setInterval> | undefined;
  let running = false;
  let initialized = false;
  // Retain only online sessions and failed final settlements, never every
  // character that has played. On startup do one reconciliation of old sessions.
  const tracked = new Map<string, StaminaRecoverySession>();

  const tick = async (): Promise<number> => {
    if (!enabled) return 0;
    if (running) return 0;
    running = true;
    let attempted = 0;
    const currentTime = now();
    try {
      const sessions = await input.listSessions(initialized
        ? new Date(currentTime.getTime() - onlineWindowMs) : undefined);
      for (const session of sessions) {
        if (!initialized || currentTime.getTime() - session.lastSeenAt.getTime() <= onlineWindowMs ||
            tracked.has(session.characterId)) tracked.set(session.characterId, session);
      }
      initialized = true;
      for (const session of tracked.values()) {
        const online = currentTime.getTime() - session.lastSeenAt.getTime() <= onlineWindowMs;
        let retry = false;
        try {
          const events = await input.store.readStream(input.worldInstanceId, session.characterId);
          const character = replayCharacter(events);
          if (!character || character.archived || character.health?.current === 0) continue;
          const seenAt = session.lastSeenAt.getTime();
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
          retry = !result.receipt.ok;
          if (!result.receipt.ok && result.receipt.code !== 'VERSION_CONFLICT') {
            input.onError?.(new Error(result.receipt.message), session.characterId);
          }
        } catch (error) {
          retry = true;
          input.onError?.(error, session.characterId);
        } finally {
          if (!online && !retry) tracked.delete(session.characterId);
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
      if (!enabled) return;
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
