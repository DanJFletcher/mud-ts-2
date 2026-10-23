import type { CommandReceipt } from '@mudd/contracts';
import type { WorldPackDraft } from '@mudd/contracts';
import type { SessionContext } from '@mudd/contracts';
import type { z } from 'zod';
import type { CharacterProjection } from '@mudd/contracts';
import type { CapabilityToken, PluginManifestInput } from '@mudd/contracts';
import type { RngPort } from '@mudd/contracts';

/**
 * Stable UUID principal for durable system-effect writes.
 * PostgreSQL stores actor IDs as UUIDs, so internal effects must not use
 * human-readable pseudo IDs such as "system:world-items".
 */
export const SYSTEM_ACTOR_ID = '00000000-0000-4000-8000-000000000001';

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
  claimNextEffect(leaseMs: number, worldInstanceId?: string): Promise<StoredEventEffect | undefined>;
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
  readonly rng: RngPort;
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
  readonly actorId?: string;
  readonly store: EventStorePort;
  readonly world: WorldPackDraft;
  readonly now: () => Date;
  readonly makeId: () => string;
  readonly rng: RngPort;
}

export type EventEffectHandler<T = unknown> = (
  payload: T,
  context: EventEffectContext,
) => Promise<void>;

export type DomainEventHandler<T = unknown> = (
  payload: T,
  context: EventEffectContext & { readonly actorId: string },
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
  /** Register a command callable only through the trusted host system-command API. */
  registerSystemCommand<T>(type: string, schema: z.ZodType<T>, handler: CommandHandler<T>): void;
  registerQuery<T, R>(type: string, schema: z.ZodType<T>, handler: QueryHandler<T, R>): void;
  registerEffect<T>(type: string, version: number, schema: z.ZodType<T>, handler: EventEffectHandler<T>): void;
  registerEventHandler<T>(
    eventType: string,
    eventVersion: number,
    schema: z.ZodType<T>,
    handler: DomainEventHandler<T>,
  ): void;
  provideCapability<T>(token: CapabilityToken<T>, implementation: T): void;
  requireCapability<T>(token: CapabilityToken<T>): T;
  optionalCapability<T>(token: CapabilityToken<T>): T | undefined;
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
