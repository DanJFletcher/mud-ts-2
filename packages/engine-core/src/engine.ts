import {
  CommandReceiptSchema,
  PluginManifestSchema,
  type CapabilityToken,
  type CommandReceipt,
  type SessionContext,
} from '@mudd/contracts';
import type {
  AuthorizationPort,
  CommandDefinition,
  DispatchResult,
  EngineCommandContext,
  EventEffectContext,
  EventEffectDefinition,
  EnginePlugin,
  EventStorePort,
  PluginContext,
  QueryDefinition,
  QueryContext,
} from './types.js';
import type { WorldPackDraft } from '@mudd/contracts';
import type { CharacterProjection } from '@mudd/contracts';
import { isRuleViolationError } from './domain-error.js';

const apiVersion = '1.0';
const EFFECT_LEASE_MS = 60_000;
const MAX_EFFECT_ATTEMPTS = 10;
const failure = (
  commandId: string,
  code: Extract<CommandReceipt, { ok: false }>['code'],
  message: string,
): Extract<CommandReceipt, { ok: false }> => ({
  ok: false,
  commandId,
  code,
  message,
  retryable: code === 'VERSION_CONFLICT',
});

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.entries(value)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

async function hashPayload(payload: unknown): Promise<string> {
  const text = stableJson(payload);
  const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

type StableVersion = readonly [major: number, minor: number, patch: number];

function parseStableVersion(value: string, label: string): StableVersion {
  const match = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.exec(value);
  if (!match) throw new Error(`Unsupported ${label} "${value}"; use stable x.y.z versions.`);
  const parts = match.slice(1).map(Number);
  if (parts.some((part) => !Number.isSafeInteger(part))) {
    throw new Error(`Unsupported ${label} "${value}"; version components must be safe integers.`);
  }
  return parts as unknown as StableVersion;
}

function dependencyVersionMatches(actual: string, range: string): boolean {
  const found = parseStableVersion(actual, 'plugin version');
  if (range === '*') return true;

  const isCaretRange = range.startsWith('^');
  const required = parseStableVersion(isCaretRange ? range.slice(1) : range, 'plugin dependency range');
  if (!isCaretRange) return found.every((part, index) => part === required[index]);

  const [major, minor, patch] = required;
  const [foundMajor, foundMinor, foundPatch] = found;
  const atLeastRequired = foundMajor > major ||
    (foundMajor === major && (foundMinor > minor || (foundMinor === minor && foundPatch >= patch)));
  if (!atLeastRequired) return false;
  if (major > 0) return foundMajor === major;
  if (minor > 0) return foundMajor === 0 && foundMinor === minor;
  return foundMajor === 0 && foundMinor === 0 && foundPatch === patch;
}

export class EngineHost {
  private readonly commands = new Map<string, CommandDefinition>();
  private readonly queries = new Map<string, QueryDefinition>();
  private readonly effects = new Map<string, EventEffectDefinition>();
  private readonly capabilities = new Map<string, { version: string; implementation: unknown }>();
  private readonly orderedPlugins: EnginePlugin[];
  private started = false;

  constructor(
    plugins: readonly EnginePlugin[],
    private readonly store: EventStorePort,
    private readonly authorization: AuthorizationPort,
    private readonly world: WorldPackDraft,
    private readonly makeId: () => string = () => globalThis.crypto.randomUUID(),
    private readonly now: () => Date = () => new Date(),
  ) {
    this.orderedPlugins = this.resolvePlugins(plugins);
    const context: PluginContext = {
      registerCommand: (type, schema, handle) => {
        if (this.commands.has(type)) throw new Error(`Duplicate command registration: ${type}`);
        this.commands.set(type, { schema, handle } as CommandDefinition);
      },
      registerQuery: (type, schema, handle) => {
        if (this.queries.has(type)) throw new Error(`Duplicate query registration: ${type}`);
        this.queries.set(type, { schema, handle } as QueryDefinition);
      },
      registerEffect: (type, version, schema, handle) => {
        if (this.effects.has(type)) throw new Error(`Duplicate event effect registration: ${type}`);
        if (!Number.isInteger(version) || version < 1) throw new Error(`Invalid event effect version for ${type}.`);
        this.effects.set(type, { version, schema, handle } as EventEffectDefinition);
      },
      provideCapability: <T>(token: CapabilityToken<T>, implementation: T) => {
        if (this.capabilities.has(token.id)) throw new Error(`Duplicate capability provider: ${token.id}`);
        this.capabilities.set(token.id, { version: token.version, implementation });
      },
      requireCapability: <T>(token: CapabilityToken<T>): T => {
        const capability = this.capabilities.get(token.id);
        if (!capability) throw new Error(`Missing capability: ${token.id}`);
        if (capability.version !== token.version) {
          throw new Error(`Capability ${token.id} requires version ${token.version}, found ${capability.version}.`);
        }
        return capability.implementation as T;
      },
    };
    for (const plugin of this.orderedPlugins) plugin.register(context);
    for (const plugin of this.orderedPlugins) {
      for (const required of plugin.manifest.requires ?? []) {
        if (!this.capabilities.has(required)) {
          throw new Error(`Plugin ${plugin.manifest.id} requires missing capability ${required}.`);
        }
      }
    }
  }

  private resolvePlugins(plugins: readonly EnginePlugin[]): EnginePlugin[] {
    const byId = new Map<string, EnginePlugin>();
    for (const plugin of plugins) {
      const manifest = PluginManifestSchema.parse(plugin.manifest);
      if (manifest.apiVersion !== apiVersion) throw new Error(`Plugin ${manifest.id} requires API ${manifest.apiVersion}; host is ${apiVersion}.`);
      if (byId.has(manifest.id)) throw new Error(`Duplicate plugin ID: ${manifest.id}`);
      byId.set(manifest.id, plugin);
    }
    const resolved = new Set<string>();
    const visiting = new Set<string>();
    const ordered: EnginePlugin[] = [];
    const visit = (id: string) => {
      if (resolved.has(id)) return;
      if (visiting.has(id)) throw new Error(`Plugin dependency cycle includes ${id}.`);
      const plugin = byId.get(id);
      if (!plugin) throw new Error(`Required plugin ${id} is not registered.`);
      visiting.add(id);
      for (const [dependencyId, range] of Object.entries(plugin.manifest.requiredPlugins ?? {})) {
        const dependency = byId.get(dependencyId);
        if (!dependency) throw new Error(`Plugin ${id} requires missing plugin ${dependencyId}.`);
        if (!dependencyVersionMatches(dependency.manifest.version, range)) {
          throw new Error(`Plugin ${id} requires ${dependencyId} ${range}, found ${dependency.manifest.version}.`);
        }
        visit(dependencyId);
      }
      visiting.delete(id);
      resolved.add(id);
      ordered.push(plugin);
    };
    for (const plugin of plugins) visit(plugin.manifest.id);
    return ordered;
  }

  async start(): Promise<void> {
    if (this.started) return;
    const initialized: EnginePlugin[] = [];
    try {
      for (const plugin of this.orderedPlugins) {
        await plugin.initialize?.();
        initialized.push(plugin);
        await plugin.start?.();
      }
      this.started = true;
    } catch (error) {
      for (const plugin of initialized.reverse()) await plugin.stop?.().catch(() => undefined);
      throw error;
    }
  }

  async stop(): Promise<void> {
    for (const plugin of [...this.orderedPlugins].reverse()) await plugin.stop?.();
    this.started = false;
  }

  async processPendingEffects(limit = 25): Promise<number> {
    if (!this.started) return 0;
    if (!Number.isInteger(limit) || limit < 1 || limit > 500) {
      throw new RangeError('Effect processing limit must be an integer from 1 to 500.');
    }

    let processed = 0;
    while (processed < limit) {
      const effect = await this.store.claimNextEffect(EFFECT_LEASE_MS);
      if (!effect) break;
      processed += 1;
      const definition = this.effects.get(effect.type);
      if (!definition || definition.version !== effect.version) {
        const reason = definition
          ? `Unsupported effect version ${effect.version} for ${effect.type}.`
          : `No plugin registered a handler for ${effect.type}.`;
        await this.store.deadLetterEffect(effect.id, effect.leaseToken, reason);
        console.error(`[effect:${effect.id}] ${reason}`);
        continue;
      }

      const parsed = definition.schema.safeParse(effect.payload);
      if (!parsed.success) {
        const reason = `Persisted payload did not match effect contract ${effect.type}@${effect.version}.`;
        await this.store.deadLetterEffect(effect.id, effect.leaseToken, reason);
        console.error(`[effect:${effect.id}] ${reason}`);
        continue;
      }

      const context: EventEffectContext = {
        effectId: effect.id,
        worldInstanceId: effect.worldInstanceId,
        sourceStreamId: effect.sourceStreamId,
        causationCommandId: effect.causationCommandId,
        store: this.store,
      };
      try {
        await definition.handle(parsed.data, context);
        await this.store.completeEffect(effect.id, effect.leaseToken);
      } catch (error) {
        const errorName = error instanceof Error ? error.name : 'UnknownError';
        const message = `Effect handler failed (${errorName}).`;
        if (effect.attempts >= MAX_EFFECT_ATTEMPTS) {
          await this.store.deadLetterEffect(effect.id, effect.leaseToken, message);
          console.error(`[effect:${effect.id}] Dead-lettered after ${effect.attempts} attempts (${errorName}).`);
          continue;
        }
        const delayMs = Math.min(300_000, 1_000 * 2 ** Math.min(effect.attempts - 1, 8));
        await this.store.retryEffect(effect.id, effect.leaseToken, delayMs, message);
        console.error(`[effect:${effect.id}] Delivery failed; retry scheduled (${errorName}).`);
      }
    }
    return processed;
  }

  async dispatch(raw: unknown, session: SessionContext, correlationId = globalThis.crypto.randomUUID()): Promise<DispatchResult> {
    const untrusted = typeof raw === 'object' && raw !== null ? raw as Record<string, unknown> : {};
    const commandId = typeof untrusted.commandId === 'string' ? untrusted.commandId : this.makeId();
    const type = typeof untrusted.type === 'string' ? untrusted.type : '';
    if (!this.started) return { receipt: failure(commandId, 'INTERNAL_ERROR', 'Engine is not ready.'), events: [] };
    const definition = this.commands.get(type);
    if (!definition) return { receipt: failure(commandId, 'UNKNOWN_COMMAND', `Unknown command: ${type || '(missing type)'}.`), events: [] };
    const parsed = definition.schema.safeParse(raw);
    if (!parsed.success) {
      return { receipt: failure(commandId, 'INVALID_COMMAND', 'Command did not match the supported contract.'), events: [] };
    }
    const command = parsed.data as Record<string, unknown>;
    const worldInstanceId = String(command.worldInstanceId ?? '');
    if (worldInstanceId !== session.worldInstanceId || !(await this.authorization.canAccessInstance(session, worldInstanceId))) {
      return { receipt: failure(commandId, 'FORBIDDEN', 'This session cannot access that world.'), events: [] };
    }
    const characterId = command.characterId;
    if (typeof characterId === 'string' && !(await this.authorization.ownsCharacter(session, characterId))) {
      return { receipt: failure(commandId, 'FORBIDDEN', 'This character does not belong to this guest.'), events: [] };
    }
    try {
      const payloadHash = await hashPayload(command);
      const prior = await this.store.lookupCommand(worldInstanceId, session.actorId, commandId, payloadHash);
      if (prior) {
        return {
          receipt: CommandReceiptSchema.parse(prior.receipt),
          streamId: prior.streamId,
          events: prior.events,
          commitOutcome: prior.kind,
        };
      }
      if (typeof characterId === 'string' && typeof command.expectedVersion === 'number') {
        const events = await this.store.readStream(worldInstanceId, characterId);
        const currentVersion = events.at(-1)?.aggregateVersion ?? 0;
        if (currentVersion !== command.expectedVersion) {
          return {
            receipt: failure(commandId, 'VERSION_CONFLICT', `Expected revision ${command.expectedVersion}; current revision is ${currentVersion}.`),
            streamId: characterId,
            events: [],
            commitOutcome: 'conflict',
          };
        }
      }
      const context: EngineCommandContext = {
        session,
        commandId,
        worldInstanceId,
        expectedVersion: typeof command.expectedVersion === 'number' ? command.expectedVersion : 0,
        store: this.store,
        world: this.world,
        makeId: this.makeId,
        now: this.now,
      };
      const plan = await definition.handle(command, context);
      const outcome = await this.store.append({
        worldInstanceId,
        streamId: plan.streamId,
        actorId: session.actorId,
        commandId,
        payloadHash,
        expectedVersion: plan.expectedVersion,
        events: plan.events,
        effects: plan.effects,
      });
      return {
        receipt: CommandReceiptSchema.parse(outcome.receipt),
        streamId: outcome.streamId,
        events: outcome.events,
        commitOutcome: outcome.kind,
      };
    } catch (error) {
      if (isRuleViolationError(error)) {
        return { receipt: failure(commandId, 'RULE_VIOLATION', error.message), events: [] };
      }
      console.error(`[${correlationId}] Engine command failed`, error);
      return {
        receipt: failure(commandId, 'INTERNAL_ERROR', 'The server could not complete that command.'),
        events: [],
        correlationId,
      };
    }
  }

  async query(
    raw: unknown,
    session: SessionContext,
    options: { characterProjection?: CharacterProjection; correlationId?: string } = {},
  ): Promise<
    | { ok: true; value: unknown }
    | { ok: false; code: string; message: string; correlationId?: string }
  > {
    const untrusted = typeof raw === 'object' && raw !== null ? raw as Record<string, unknown> : {};
    const type = typeof untrusted.type === 'string' ? untrusted.type : '';
    const definition = this.queries.get(type);
    if (!definition) return { ok: false, code: 'UNKNOWN_QUERY', message: 'This view is not available.' };
    const parsed = definition.schema.safeParse(raw);
    if (!parsed.success) return { ok: false, code: 'INVALID_QUERY', message: 'The request did not match the supported query.' };
    const query = parsed.data as Record<string, unknown>;
    const worldInstanceId = String(query.worldInstanceId ?? '');
    if (worldInstanceId !== session.worldInstanceId || !(await this.authorization.canAccessInstance(session, worldInstanceId))) {
      return { ok: false, code: 'FORBIDDEN', message: 'This session cannot access that world.' };
    }
    const characterId = query.characterId;
    if (typeof characterId === 'string' && !(await this.authorization.ownsCharacter(session, characterId))) {
      return { ok: false, code: 'FORBIDDEN', message: 'This character does not belong to this guest.' };
    }
    try {
      const context: QueryContext = {
        session,
        worldInstanceId,
        store: this.store,
        world: this.world,
        ...(options.characterProjection ? { characterProjection: options.characterProjection } : {}),
      };
      return { ok: true, value: await definition.handle(query, context) };
    } catch (error) {
      if (isRuleViolationError(error)) {
        return { ok: false, code: 'RULE_VIOLATION', message: error.message };
      }
      const correlationId = options.correlationId ?? globalThis.crypto.randomUUID();
      console.error(`[${correlationId}] Engine query failed`, error);
      return { ok: false, code: 'INTERNAL_ERROR', message: 'The server could not complete that request.', correlationId };
    }
  }
}
