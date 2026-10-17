import type { CommandReceipt } from '@mudd/contracts';
import type { WorldPackDraft } from '@mudd/contracts';
import type { SessionContext } from '@mudd/contracts';
import type { z } from 'zod';

export interface ProposedDomainEvent {
  readonly type: string;
  readonly version: number;
  readonly payload: Readonly<Record<string, unknown>>;
}

export interface StoredGameEvent extends ProposedDomainEvent {
  readonly eventId: string;
  readonly worldInstanceId: string;
  readonly streamId: string;
  readonly aggregateId: string;
  readonly aggregateVersion: number;
  readonly causationCommandId: string;
  readonly actorId: string;
  readonly occurredAt: string;
  readonly tick: number;
}

export interface AppendRequest {
  readonly worldInstanceId: string;
  readonly streamId: string;
  readonly actorId: string;
  readonly commandId: string;
  readonly payloadHash: string;
  readonly expectedVersion: number;
  readonly events: readonly ProposedDomainEvent[];
}

export type AppendOutcome =
  | { readonly kind: 'committed' | 'duplicate'; readonly receipt: Extract<CommandReceipt, { ok: true }>; readonly streamId: string; readonly events: readonly StoredGameEvent[] }
  | { readonly kind: 'conflict'; readonly receipt: Extract<CommandReceipt, { ok: false }>; readonly streamId: string; readonly events: readonly StoredGameEvent[] };

export interface EventStorePort {
  readStream(worldInstanceId: string, streamId: string): Promise<readonly StoredGameEvent[]>;
  lookupCommand(
    worldInstanceId: string,
    actorId: string,
    commandId: string,
    payloadHash: string,
  ): Promise<AppendOutcome | undefined>;
  append(request: AppendRequest): Promise<AppendOutcome>;
}

export interface AuthorizationPort {
  canAccessInstance(session: SessionContext, worldInstanceId: string): Promise<boolean>;
  ownsCharacter(session: SessionContext, characterId: string): Promise<boolean>;
}

export interface EngineCommandContext {
  readonly session: SessionContext;
  readonly commandId: string;
  readonly worldInstanceId: string;
  readonly expectedVersion: number;
  readonly store: EventStorePort;
  readonly world: WorldPackDraft;
  readonly makeId: () => string;
  readonly now: () => Date;
}

export interface CommandPlan {
  readonly streamId: string;
  readonly expectedVersion: number;
  readonly events: readonly ProposedDomainEvent[];
}

export interface QueryContext {
  readonly session: SessionContext;
  readonly worldInstanceId: string;
  readonly store: EventStorePort;
  readonly world: WorldPackDraft;
}

export type CommandHandler<T = unknown> = (
  command: T,
  context: EngineCommandContext,
) => Promise<CommandPlan>;

export type QueryHandler<T = unknown, R = unknown> = (
  query: T,
  context: QueryContext,
) => Promise<R>;

export interface CommandDefinition<T = unknown> {
  readonly schema: z.ZodType<T>;
  readonly handle: CommandHandler<T>;
}

export interface QueryDefinition<T = unknown, R = unknown> {
  readonly schema: z.ZodType<T>;
  readonly handle: QueryHandler<T, R>;
}

export interface PluginContext {
  registerCommand<T>(type: string, schema: z.ZodType<T>, handler: CommandHandler<T>): void;
  registerQuery<T, R>(type: string, schema: z.ZodType<T>, handler: QueryHandler<T, R>): void;
  provideCapability<T>(id: string, implementation: T): void;
  requireCapability<T>(id: string): T;
}

export interface EnginePlugin {
  readonly manifest: {
    readonly id: string;
    readonly version: string;
    readonly apiVersion: string;
    readonly category: 'core' | 'first-party' | 'ruleset' | 'third-party';
    readonly requires?: readonly string[];
    readonly provides?: readonly string[];
    readonly requiredPlugins?: Readonly<Record<string, string>>;
    readonly optionalPlugins?: Readonly<Record<string, string>>;
    readonly permissions?: readonly string[];
  };
  register(context: PluginContext): void;
  initialize?(): Promise<void>;
  start?(): Promise<void>;
  stop?(): Promise<void>;
}

export interface DispatchResult {
  readonly receipt: CommandReceipt;
  readonly streamId?: string;
  readonly events: readonly StoredGameEvent[];
}
