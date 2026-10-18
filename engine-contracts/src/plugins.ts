/**
 * Shared plugin-manifest validation and proposed extension contracts.
 * PluginManifestSchema is the validated manifest contract used by the live engine.
 * GamePlugin below remains a design proposal and is not the live runtime interface.
 * Manifest permissions are requested grants, NOT a code sandbox.
 */
import { z } from 'zod';
import type { ClockPort, RngPort } from './clock-rng.js';
import type { CommandReceipt } from './protocol.js';
import type { SessionContext } from './session.js';

const PluginIdSchema = z.string().regex(/^[a-z][a-z0-9]*(\.[a-z][a-z0-9-]*)+$/);
export const PluginCategorySchema = z.enum(['core', 'first-party', 'ruleset', 'third-party']);
export const PluginManifestSchema = z.object({
  id: PluginIdSchema,
  version: z.string().min(1),
  apiVersion: z.string().min(1),
  description: z.string().optional(),
  category: PluginCategorySchema,
  requires: z.array(z.string()).default([]),
  provides: z.array(z.string()).default([]),
  requiredPlugins: z.record(z.string()).default({}),
  optionalPlugins: z.record(z.string()).default({}),
  permissions: z.array(z.string()).default([]),
  configurationSchemaVersion: z.number().int().positive().optional(),
  eventSchemaVersions: z.record(z.number().int().positive()).optional(),
}).strict();

export type PluginManifest = z.infer<typeof PluginManifestSchema>;
export type PluginManifestInput = z.input<typeof PluginManifestSchema>;

export interface CommandContext {
  readonly session: SessionContext;
  readonly commandId: string;
  readonly worldInstanceId: string;
  readonly expectedVersion?: number;
  readonly clock: ClockPort;
  readonly rng: RngPort;
}

/** Handler proposes facts; authoritative host validates and commits atomically. */
export type ProposedEvent = Readonly<{
  type: string;
  version: number;
  aggregateId: string;
  payload: unknown;
}>;

export type CommandDecision =
  | Readonly<{ ok: true; events: readonly ProposedEvent[] }>
  | Readonly<{ ok: false; code: Extract<CommandReceipt, { ok: false }>['code']; message: string }>;

export type CommandHandler<TCommand> = (command: TCommand, context: CommandContext) => Promise<CommandDecision>;
export type QueryHandler<TQuery, TResult> = (query: TQuery, context: CommandContext) => Promise<TResult>;

export interface CommandRegistry {
  register<TSchema extends z.ZodTypeAny>(
    type: string,
    schema: TSchema,
    handler: CommandHandler<z.infer<TSchema>>,
  ): void;
}

export interface QueryRegistry {
  register<TSchema extends z.ZodTypeAny, TResult>(
    type: string,
    schema: TSchema,
    handler: QueryHandler<z.infer<TSchema>, TResult>,
  ): void;
}

export interface CapabilityToken<T> {
  readonly id: string;
  readonly version: string;
  /** Phantom type slot, never instantiated; enables generic typed capabilities. */
  readonly __type?: T;
}

export interface PluginContext {
  readonly commands: CommandRegistry;
  readonly queries: QueryRegistry;
  requireCapability<T>(token: CapabilityToken<T>): T;
  provideCapability<T>(token: CapabilityToken<T>, implementation: T): void;
}

export interface GamePlugin {
  readonly manifest: PluginManifest;
  register(context: PluginContext): void;
  start?(): Promise<void>;
  stop?(): Promise<void>;
}
