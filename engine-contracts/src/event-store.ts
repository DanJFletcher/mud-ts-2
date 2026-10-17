/**
 * PROPOSED event sourcing contracts: a transactional adapter is responsible for
 * version checks, command idempotency, and event + receipt atomicity.
 */
import type { CommandReceipt, DomainEventBase } from './protocol.js';
import type { SessionContext } from './session.js';

export interface StoredEvent extends DomainEventBase {
  readonly payload: unknown;
  readonly streamId: string;
  /** Monotonic within this stream; same value as aggregateVersion. */
  readonly streamVersion: number;
  /** Optional store-defined monotonic cursor for viewer-filtered subscriptions. */
  readonly cursor?: string;
}

export interface EventStream {
  readonly worldInstanceId: string;
  readonly streamId: string;
  readonly currentVersion: number;
  readonly events: readonly StoredEvent[];
}

export interface AppendEventsRequest {
  readonly context: SessionContext;
  readonly commandId: string;
  readonly commandPayloadHash: string;
  readonly streamId: string;
  readonly expectedVersion: number;
  readonly proposedEvents: readonly Readonly<{
    type: string;
    version: number;
    payload: unknown;
  }>[];
}

export type AppendEventsOutcome =
  | Readonly<{ status: 'committed'; receipt: Extract<CommandReceipt, { ok: true }> }>
  | Readonly<{ status: 'duplicate'; receipt: CommandReceipt }>
  | Readonly<{ status: 'conflict'; receipt: Extract<CommandReceipt, { ok: false }> }>;

export interface EventStorePort {
  loadStream(worldInstanceId: string, streamId: string, afterVersion?: number): Promise<EventStream>;
  /** Atomic: constrain (instance, stream, revision) and (instance, actor, commandId). */
  commit(request: AppendEventsRequest): Promise<AppendEventsOutcome>;
}

export interface ProjectionCheckpoint {
  readonly consumerId: string;
  readonly worldInstanceId: string;
  readonly cursor: string;
}

export interface ProjectionConsumerPort {
  project(events: readonly StoredEvent[]): Promise<void>;
  checkpoint(): Promise<ProjectionCheckpoint | null>;
}
