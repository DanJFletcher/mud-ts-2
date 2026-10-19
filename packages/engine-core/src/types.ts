import type { CommandReceipt } from '@mudd/contracts';
import type { WorldPackDraft } from '@mudd/contracts';
import type { SessionContext } from '@mudd/contracts';
import type { z } from 'zod';
import type { CharacterProjection } from '@mudd/contracts';
import type { CapabilityToken, PluginManifestInput } from '@mudd/contracts';

export interface ProposedDomainEvent {
  readonly type: string;
  readonly version: number;
  readonly payload: Readonly<Record<string, unknown>>;
}

export interface ProposedEventEffect {
  readonly type: string;
  readonly version: number;
  readonly payload: Readonly<Record<string, unknown>>;
}

export interface StoredEventEffect extends ProposedEventEffect {
  readonly id: string;
  readonly worldInstanceId: string;
  readonly sourceStreamId: string | null;
  readonly causationCommandId: string;
  readonly attempts: number;
  readonly leaseToken: string;
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
  readonly effects?: readonly ProposedEventEffect[];
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
  claimNextEffect(leaseMs: number): Promise<StoredEventEffect | undefined>;
  completeEffect(effectId: string, leaseToken: string): Promise<boolean>;
  retryEffect(effectId: string, leaseToken: string, delayMs: number, errorMessage: string): Promise<boolean>;
  deadLetterEffect(effectId: string, leaseToken: string, errorMessage: string): Promise<boolean>;
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
  readonly effects?: readonly ProposedEventEffect[];
}

export interface EventEffectContext {
  readonly effectId: string;
  readonly worldInstanceId: string;
  readonly sourceStreamId: string | null;
  readonly causationCommandId: string;
  readonly store: EventStorePort;
}

export type EventEffectHandler<T = unknown> = (
  payload: T,
  context: EventEffectContext,
) => Promise<void>;

export interface EventEffectDefinition<T = unknown> {
  readonly version: number;
  readonly schema: z.ZodType<T>;
  readonly handle: EventEffectHandler<T>;
}

export interface QueryContext {
  readonly session: SessionContext;
  readonly worldInstanceId: string;
  readonly store: EventStorePort;
  readonly world: WorldPackDraft;
  readonly characterProjection?: CharacterProjection;
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
  registerEffect<T>(type: string, version: number, schema: z.ZodType<T>, handler: EventEffectHandler<T>): void;
  provideCapability<T>(token: CapabilityToken<T>, implementation: T): void;
  requireCapability<T>(token: CapabilityToken<T>): T;
}

export interface EnginePlugin {
  readonly manifest: PluginManifestInput;
  register(context: PluginContext): void;
  initialize?(): Promise<void>;
  start?(): Promise<void>;
  stop?(): Promise<void>;
}

export interface DispatchResult {
  readonly receipt: CommandReceipt;
  readonly streamId?: string;
  readonly events: readonly StoredGameEvent[];
  readonly commitOutcome?: AppendOutcome['kind'];
  readonly correlationId?: string;
}
