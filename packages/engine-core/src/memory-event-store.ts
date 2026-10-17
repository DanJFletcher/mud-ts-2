import type { CommandReceipt } from '@mudd/contracts';
import type { AppendOutcome, AppendRequest, EventStorePort, StoredGameEvent } from './types.js';

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

  async readStream(worldInstanceId: string, streamId: string): Promise<readonly StoredGameEvent[]> {
    return [...(this.streams.get(`${worldInstanceId}:${streamId}`) ?? [])];
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
    this.streams.set(streamKey, next);
    const receipt: Extract<CommandReceipt, { ok: true }> = {
      ok: true,
      commandId: request.commandId,
      eventIds: appended.map((event) => event.eventId),
      newAggregateVersion: next.at(-1)?.aggregateVersion ?? revision,
    };
    const outcome: AppendOutcome = { kind: 'committed', receipt, streamId: request.streamId, events: appended };
    this.receipts.set(receiptKey, { hash: request.payloadHash, outcome });
    return outcome;
  }
}
