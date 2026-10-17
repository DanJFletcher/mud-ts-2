import {
  CommandReceiptSchema,
  PluginManifestSchema,
  type CommandReceipt,
  type SessionContext,
} from '@mudd/contracts';
import type {
  AuthorizationPort,
  CommandDefinition,
  DispatchResult,
  EngineCommandContext,
  EnginePlugin,
  EventStorePort,
  PluginContext,
  QueryDefinition,
  QueryContext,
} from './types.js';
import type { WorldPackDraft } from '@mudd/contracts';

const apiVersion = '1.0';
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

function dependencyVersionMatches(actual: string, range: string): boolean {
  if (range === '*' || range === actual) return true;
  const required = /^\^?(\d+)\.\d+\.\d+$/.exec(range);
  const found = /^(\d+)\.\d+\.\d+$/.exec(actual);
  return Boolean(required && found && required[1] === found[1]);
}

export class EngineHost {
  private readonly commands = new Map<string, CommandDefinition>();
  private readonly queries = new Map<string, QueryDefinition>();
  private readonly capabilities = new Map<string, unknown>();
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
      provideCapability: (id, implementation) => {
        if (this.capabilities.has(id)) throw new Error(`Duplicate capability provider: ${id}`);
        this.capabilities.set(id, implementation);
      },
      requireCapability: <T>(id: string): T => {
        if (!this.capabilities.has(id)) throw new Error(`Missing capability: ${id}`);
        return this.capabilities.get(id) as T;
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

  async dispatch(raw: unknown, session: SessionContext): Promise<DispatchResult> {
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
      });
      return {
        receipt: CommandReceiptSchema.parse(outcome.receipt),
        streamId: outcome.streamId,
        events: outcome.events,
      };
    } catch (error) {
      return {
        receipt: failure(commandId, 'RULE_VIOLATION', error instanceof Error ? error.message : 'The command was rejected.'),
        events: [],
      };
    }
  }

  async query(raw: unknown, session: SessionContext): Promise<{ ok: true; value: unknown } | { ok: false; code: string; message: string }> {
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
      const context: QueryContext = { session, worldInstanceId, store: this.store, world: this.world };
      return { ok: true, value: await definition.handle(query, context) };
    } catch (error) {
      return { ok: false, code: 'INTERNAL_ERROR', message: error instanceof Error ? error.message : 'The request could not be completed.' };
    }
  }
}
