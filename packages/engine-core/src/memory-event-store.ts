import type { CommandReceipt } from '@mudd/contracts';
import type {
  AppendOutcome,
  AppendRequest,
  EventStorePort,
  StoredEventEffect,
  StoredGameEvent,
} from './types.js';

function failure(
  commandId: string,
  code: Extract<CommandReceipt, { ok: false }>['code'],
  message: string,
): Extract<CommandReceipt, { ok: false }> {
  return { ok: false, commandId, code, message, retryable: code === 'VERSION_CONFLICT' };
}

/** Deterministic test adapter. It follows the same atomic append contract as PostgreSQL. */
export class InMemoryEventStore implements EventStorePort {
  private readonly streams = new Map<string, StoredGameEvent[]>();
  private readonly receipts = new Map<string, { hash: string; outcome: AppendOutcome }>();
  private readonly effects = new Map<string, {
    effect: StoredEventEffect;
    status: 'pending' | 'processing' | 'completed' | 'dead';
    availableAt: number;
    leaseExpiresAt: number | null;
  }>();

  async readStream(worldInstanceId: string, streamId: string): Promise<readonly StoredGameEvent[]> {
    return [...(this.streams.get(`${worldInstanceId}:${streamId}`) ?? [])];
  }

  async readStreamRevision(worldInstanceId: string, streamId: string): Promise<number> {
    return this.streams.get(`${worldInstanceId}:${streamId}`)?.at(-1)?.aggregateVersion ?? 0;
  }

  async lookupCommand(
    worldInstanceId: string,
    actorId: string,
    commandId: string,
    payloadHash: string,
  ): Promise<AppendOutcome | undefined> {
    return this.findCommand(worldInstanceId, actorId, commandId, payloadHash);
  }

  private findCommand(worldInstanceId: string, actorId: string, commandId: string, payloadHash: string): AppendOutcome | undefined {
    const receiptKey = `${worldInstanceId}:${actorId}:${commandId}`;
    const prior = this.receipts.get(receiptKey);
    if (!prior) return undefined;
    if (prior.hash !== payloadHash) {
      return {
        kind: 'conflict',
        streamId: prior.outcome.streamId,
        events: prior.outcome.events,
        receipt: failure(commandId, 'INVALID_COMMAND', 'Command ID was already used with a different payload.'),
      };
    }
    if (prior.outcome.kind === 'conflict') return prior.outcome;
    return { ...prior.outcome, kind: 'duplicate' };
  }

  async append(request: AppendRequest): Promise<AppendOutcome> {
    const prior = this.findCommand(request.worldInstanceId, request.actorId, request.commandId, request.payloadHash);
    if (prior) return prior;
    const receiptKey = `${request.worldInstanceId}:${request.actorId}:${request.commandId}`;

    const checks = [...(request.companions ?? []), ...(request.guards ?? [])];
    const writeIds = [request.streamId, ...(request.companions ?? []).map((write) => write.streamId)];
    if (new Set(writeIds).size !== writeIds.length) throw new Error('Duplicate atomic write stream.');
    if (request.companions?.some((write) => !write.events.length) ||
        (request.companions?.length && !request.events.length)) {
      throw new Error('Atomic writes must contain events.');
    }
    for (const check of checks) {
      const actual = this.streams.get(`${request.worldInstanceId}:${check.streamId}`)?.at(-1)?.aggregateVersion ?? 0;
      if (actual !== check.expectedVersion) {
        return { kind: 'conflict', streamId: request.streamId, events: [],
          receipt: failure(request.commandId, 'VERSION_CONFLICT', 'An observed stream changed. Refresh and try again.') };
      }
    }

    const streamKey = `${request.worldInstanceId}:${request.streamId}`;
    const current = this.streams.get(streamKey) ?? [];
    const revision = current.at(-1)?.aggregateVersion ?? 0;
    if (revision !== request.expectedVersion) {
      return {
        kind: 'conflict',
        streamId: request.streamId,
        events: current,
        receipt: failure(request.commandId, 'VERSION_CONFLICT', `Expected revision ${request.expectedVersion}; current revision is ${revision}.`),
      };
    }

    const now = new Date().toISOString();
    const appended = request.events.map((event, index): StoredGameEvent => ({
      ...event,
      eventId: globalThis.crypto.randomUUID(),
      worldInstanceId: request.worldInstanceId,
      streamId: request.streamId,
      aggregateId: request.streamId,
      aggregateVersion: revision + index + 1,
      causationCommandId: request.commandId,
      actorId: request.actorId,
      occurredAt: now,
      tick: revision + index + 1,
    }));
    const next = [...current, ...appended];
    // No await between validation and all mutations: the memory adapter is atomic.
    for (const write of request.companions ?? []) {
      const key = `${request.worldInstanceId}:${write.streamId}`;
      const previous = this.streams.get(key) ?? [];
      const events = write.events.map((event, index): StoredGameEvent => ({
        ...event, eventId: globalThis.crypto.randomUUID(), worldInstanceId: request.worldInstanceId,
        streamId: write.streamId, aggregateId: write.streamId,
        aggregateVersion: write.expectedVersion + index + 1, causationCommandId: request.commandId,
        actorId: request.actorId, occurredAt: now, tick: write.expectedVersion + index + 1,
      }));
      this.streams.set(key, [...previous, ...events]);
    }
    this.streams.set(streamKey, next);
    const receipt: Extract<CommandReceipt, { ok: true }> = {
      ok: true,
      commandId: request.commandId,
      eventIds: appended.map((event) => event.eventId),
      newAggregateVersion: next.at(-1)?.aggregateVersion ?? revision,
    };
    for (const [index, effect] of (request.effects ?? []).entries()) {
      const storedEffect: StoredEventEffect = {
        ...effect,
        id: globalThis.crypto.randomUUID(),
        worldInstanceId: request.worldInstanceId,
        sourceStreamId: request.streamId,
        causationCommandId: request.commandId,
        attempts: 0,
        leaseToken: '',
      };
      this.effects.set(`${request.worldInstanceId}:${request.actorId}:${request.commandId}:${index}`, {
        effect: storedEffect,
        status: 'pending',
        availableAt: Date.now(),
        leaseExpiresAt: null,
      });
    }
    const outcome: AppendOutcome = { kind: 'committed', receipt, streamId: request.streamId, events: appended };
    this.receipts.set(receiptKey, { hash: request.payloadHash, outcome });
    return outcome;
  }

  async claimNextEffect(leaseMs: number, worldInstanceId?: string): Promise<StoredEventEffect | undefined> {
    const now = Date.now();
    for (const record of this.effects.values()) {
      const isAvailable = record.status === 'pending' ||
        (record.status === 'processing' && (record.leaseExpiresAt ?? 0) <= now);
      if (
        !isAvailable ||
        record.availableAt > now ||
        (worldInstanceId !== undefined && record.effect.worldInstanceId !== worldInstanceId)
      ) continue;
      const leaseToken = globalThis.crypto.randomUUID();
      const effect = {
        ...record.effect,
        attempts: record.effect.attempts + 1,
        leaseToken,
      };
      record.effect = effect;
      record.status = 'processing';
      record.leaseExpiresAt = now + leaseMs;
      return effect;
    }
    return undefined;
  }

  async completeEffect(effectId: string, leaseToken: string): Promise<boolean> {
    const record = this.findEffect(effectId, leaseToken);
    if (!record) return false;
    record.status = 'completed';
    record.leaseExpiresAt = null;
    return true;
  }

  async retryEffect(effectId: string, leaseToken: string, delayMs: number, _errorMessage: string): Promise<boolean> {
    const record = this.findEffect(effectId, leaseToken);
    if (!record) return false;
    record.status = 'pending';
    record.availableAt = Date.now() + delayMs;
    record.leaseExpiresAt = null;
    return true;
  }

  async deadLetterEffect(effectId: string, leaseToken: string, _errorMessage: string): Promise<boolean> {
    const record = this.findEffect(effectId, leaseToken);
    if (!record) return false;
    record.status = 'dead';
    record.leaseExpiresAt = null;
    return true;
  }

  private findEffect(effectId: string, leaseToken: string) {
    const record = [...this.effects.values()].find((candidate) =>
      candidate.effect.id === effectId &&
      candidate.status === 'processing' &&
      candidate.effect.leaseToken === leaseToken,
    );
    return record;
  }
}
