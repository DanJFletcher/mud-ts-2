/**
 * Illustrative MUDD plugin host contract: a design aid, not a ready-made runtime.
 * An implementation must validate manifests/configs with Zod, apply auth scopes,
 * resolve dependency versions, and provide a real transactional event store.
 */
import { z } from "zod";

export const PluginManifestSchema = z.object({
  id: z.string().regex(/^[a-z][a-z0-9]*(\.[a-z][a-z0-9-]*)+$/),
  version: z.string().min(1),
  apiVersion: z.string().min(1),
  category: z.enum(["core", "first-party", "ruleset", "third-party"]),
  requires: z.array(z.string()).default([]),
  provides: z.array(z.string()).default([]),
  requiredPlugins: z.record(z.string(), z.string()).default({}),
  permissions: z.array(z.string()).default([]),
});

export type PluginManifest = z.infer<typeof PluginManifestSchema>;
export type Identifier = string; // Substitute branded scoped IDs in real code.

export interface CommandContext {
  readonly commandId: Identifier;
  readonly actorId: Identifier; // Resolved from trusted session, NOT client payload.
  readonly worldInstanceId: Identifier;
  readonly expectedVersion?: number;
  readonly clock: ClockPort;
  readonly rng: RngPort;
}

export interface ClockPort {
  now(): Date;
  tick(): number;
}

export interface RngPort {
  roll(sides: number): number;
}

export type DomainEvent<TPayload = unknown> = {
  type: string;
  version: number;
  aggregateId: Identifier;
  payload: TPayload;
};

export type CommandOutcome<TPayload = unknown> =
  | { ok: true; events: DomainEvent<TPayload>[] }
  | { ok: false; code: "FORBIDDEN" | "RULE_VIOLATION" | "NOT_FOUND" | "VERSION_CONFLICT"; message: string };

export type CommandHandler<TInput> = (
  input: TInput,
  context: CommandContext,
) => Promise<CommandOutcome>;

export interface CommandRegistry {
  register<TSchema extends z.ZodTypeAny>(
    commandName: string,
    schema: TSchema,
    handler: CommandHandler<z.infer<TSchema>>,
  ): void;
}

export interface PluginContext {
  readonly commands: CommandRegistry;
  // Use typed scoped capability tokens in the real implementation.
  requireCapability<T>(name: string): T;
}

export interface GamePlugin {
  readonly manifest: PluginManifest;
  register(context: PluginContext): void;
  start?(): Promise<void>;
  stop?(): Promise<void>;
}

// The host (not a handler) must atomically append resulting events, enforce
// version constraints and command-id uniqueness, and persist the receipt.
// Never make plugin return values cause nontransactional direct DB mutations.
