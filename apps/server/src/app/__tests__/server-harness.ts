import { once } from 'node:events';
import { afterAll, beforeAll, beforeEach, expect, vi } from 'vitest';
import {
  clearRequestIdentityCachesForTests,
  setMembershipListenerConnected,
} from '../../auth/request-identity-cache.js';

const state = vi.hoisted(() => ({
  world: {
    packId: 'npc-announcement-test-pack',
    packVersion: '1.0.0',
    currency: undefined as { id: string; name: string; symbol: string; } | undefined,
    locationGroups: [],
    dailyBoards: [],
    supplySources: [],
    fishingSpots: [],
    woodcuttingTrees: [],
    locations: [
      {
        id: 'npc-room',
        name: 'NPC Room',
        exits: [],
        npcs: [{
          id: 'mara',
          name: 'Mara',
          announcements: ['The north bridge is open.'],
          roomChatReactions: [{
            keywords: ['marker', 'sign'],
            response: 'The marker still points east.',
          }],
        }],
      },
      { id: 'other-room', name: 'Other Room', exits: [], npcs: [] },
      { id: 'entry-room', name: 'Entry Room', exits: [], npcs: [] },
      {
        id: 'arrival-room',
        name: 'Arrival Room',
        exits: [],
        npcs: [{
          id: 'mara-arrival',
          name: 'Mara',
          announcements: ['The north bridge is open.'],
        }],
      },
      { id: 'quiet-room', name: 'Quiet Room', exits: [], npcs: [] },
    ],
  },
  characters: {
    'character-alice': {
      characterId: 'character-alice',
      name: 'Alice',
      locationId: 'npc-room',
      wallet: { currencyId: 'test-currency', balance: 10 },
      archived: false,
    },
    'character-bob': {
      characterId: 'character-bob',
      name: 'Bob',
      locationId: 'npc-room',
      wallet: { currencyId: 'test-currency', balance: 10 },
      archived: false,
    },
    'character-elsewhere': {
      characterId: 'character-elsewhere',
      name: 'Elsewhere',
      locationId: 'other-room',
      wallet: { currencyId: 'test-currency', balance: 10 },
      archived: false,
    },
    'character-mover': {
      characterId: 'character-mover',
      name: 'Mover',
      locationId: 'entry-room',
      wallet: { currencyId: 'test-currency', balance: 10 },
      archived: false,
    },
  },
  charactersByOwner: {
    'character-alice': 'player-alice',
    'character-bob': 'player-bob',
    'character-elsewhere': 'player-elsewhere',
    'character-mover': 'player-mover',
  },
  characterWorldInstanceOverrides: new Map<string, string>(),
  sessions: new Map(),
  worldSessionSelectCount: 0,
  guestIdentity: null as null | {
    playerId: string;
    displayName: string;
    clearGuestCookie: false;
    isGuest: true;
    session: {
      sessionId: string;
      playerId: string;
      actorId: string;
      worldInstanceId: string;
      grantedPermissions: never[];
      authenticated: true;
    };
  },
  messages: [],
  nextMessageId: 1,
  chatSubmissions: new Map(),
  chatSubmitError: null as Error | null,
  chatSubmitOutcome: null as 'unavailable' | 'conflict' | null,
  readStreamError: null as Error | null,
  readStreamGate: null as Promise<void> | null,
  readStreamSequence: [] as unknown[],
  batchReadStreams: false,
  streamlessCharacterIds: new Set<string>(),
  pendingEffects: [] as Array<{
    effectId: string;
    type: string;
    payload: unknown;
    context: {
      effectId: string;
      worldInstanceId: string;
      sourceStreamId: string | null;
      causationCommandId: string;
    };
  }>,
  effectHandlers: new Map<string, (payload: unknown, context: unknown) => Promise<void>>(),
  effectPlugin: null as unknown,
  nextChatSubmissionId: 1,
  moveReceipts: new Map(),
  nextMoveId: 1,
  interactionEncounter: null as unknown,
  teamCombatProjection: { encounter: null } as unknown,
  queryOverrides: new Map<string, unknown>(),
  characterReplayOverride: null as unknown,
  systemCommands: [] as Array<Record<string, unknown>>,
  systemCommandResults: [] as Array<{
    receipt: { ok: boolean; code?: string; message?: string; };
  }>,
  presenceTouches: [] as unknown[][],
  nextCommandResult: null as null | {
    receipt: { ok: boolean; code?: string; message?: string; commandId?: string; };
    commitOutcome?: string;
    commandId?: string;
    completingEffects?: number;
  },
  dispatchError: null as Error | null,
  settledCommands: [] as Array<{ session: { actorId?: string; }; result: { completingEffects?: number; }; }>,
  settleCommandEffectsResult: true,
  settleCommandEffectsError: null as Error | null,
  enableAutonomousScheduler: false,
  autonomousSchedulers: [] as Array<{
    options: { onError: (error: unknown, npcId: string) => void; };
    start: ReturnType<typeof vi.fn>;
    stop: ReturnType<typeof vi.fn>;
  }>,
  staminaSchedulers: [] as Array<{
    options: {
      listSessions: (activeSince?: Date) => Promise<unknown[]>;
      onError: (error: unknown, characterId: string) => void;
    };
    start: ReturnType<typeof vi.fn>;
    stop: ReturnType<typeof vi.fn>;
  }>,
  engineAuthorizations: [] as unknown[],
  objectLifecycleErrorHandlers: [] as Array<
    (error: unknown, worldInstanceId: string, objectId?: string) => void
  >,
  interactionMaintenanceRequests: [] as Array<Record<string, unknown>>,
  interactionRequestWorldId: '',
  interactionStatusUpdates: [] as unknown[][],
  intervalCallbacks: [] as Array<{ delay: number; callback: () => void; }>,
  processPendingEffectsError: null as Error | null,
  processPendingEffectsGate: null as Promise<void> | null,
  processPendingEffectsStarted: 0,
  processPendingEffectsStartedSignal: null as (() => void) | null,
  guestIdentityError: null as Error | null,
  deleteSessionError: null as Error | null,
  realtimeNotificationCallbacks: null as null | {
    invalidate: (change: unknown) => void;
    refresh: () => void;
    connectionState: (connected: boolean) => void;
  },
}));

const announcementState = vi.hoisted(() => ({ attempts: 0 }));
const instanceId = 'npc-announcement-test-world';
const playersByAuthId: Record<string, { playerId: string; displayName: string; }> = {
  alice: { playerId: 'player-alice', displayName: 'Alice' },
  bob: { playerId: 'player-bob', displayName: 'Bob' },
  elsewhere: { playerId: 'player-elsewhere', displayName: 'Elsewhere' },
  mover: { playerId: 'player-mover', displayName: 'Mover' },
};

vi.mock('@clerk/express', () => ({
  clerkMiddleware: () => (_request: unknown, _response: unknown, next: () => void) => next(),
  getAuth: (request: { headers: Record<string, string | undefined>; }) => ({
    userId: request.headers['x-test-user'] ?? null,
    sessionId: 'integration-test-session',
  }),
}));

vi.mock('@clerk/shared/keys', () => ({
  publishableKeyFromHost: () => 'test-publishable-key',
}));

vi.mock('@mudd/core-plugins', async () => ({
  ...await vi.importActual<typeof import('@mudd/core-plugins')>('@mudd/core-plugins'),
  createLocationGroupsPlugin: () => ({
    plugin: {},
    catalog: {
      read: async () => ({ packId: 'test-pack', packVersion: '1.0.0', revision: 0, groups: [] }),
    },
  }),
  mobileNpcDefinitions: () => state.enableAutonomousScheduler ? [{}] : [],
  autonomousNpcsPlugin: {},
  characterPlugin: {},
  createClassRulesetPlugin: () => ({}),
  combatPlugin: {},
  groupsPlugin: {},
  partyPlugin: {},
  partyQuestPlugin: {},
  partyCombatPolicyPlugin: {},
  teamCombatPlugin: {},
  combatRoomPresenceCapability: { id: 'mudd.combat.room-presence.v1', version: '1' },
  interactionPlugin: {},
  interactionStreamId: (worldInstanceId: string) => `world-interactions:${worldInstanceId}`,
  projectInteractionEvents: (events: unknown) => ({
    requests: Array.isArray(events) ? events as Array<Record<string, unknown>> : [],
    latestEncounterEvent: undefined,
  }),
  projectCharacterInteractions: () => ({ requests: [], encounter: state.interactionEncounter }),
  updateInteractionRequestStatus: async (...args: unknown[]) => {
    state.interactionStatusUpdates.push(args);
    return false;
  },
  movementPlugin: {},
  roadTravelPlugin: {},
  worldItemsPlugin: {},
  npcDialoguePlugin: {},
  merchantPlugin: {},
  dailyJobsPlugin: {},
  fishingPlugin: {},
}));

vi.mock('@mudd/engine-core', async () => ({
  ...await vi.importActual<typeof import('@mudd/engine-core')>('@mudd/engine-core'),
  SYSTEM_ACTOR_ID: 'system-test-actor',
  projectQuestJournal: () => [],
  EngineHost: class {
    constructor(plugins: unknown[] = [], _store?: unknown, authorization?: unknown) {
      if (authorization) state.engineAuthorizations.push(authorization);
      for (const candidate of plugins) {
        const plugin = candidate as {
          manifest?: { id?: string; };
          register?: (context: never) => void;
        };
        if (plugin.manifest?.id !== 'mudd.demo-event-effects') continue;
        state.effectPlugin = candidate;
        plugin.register?.({
          registerEffect: (
            type: string,
            _version: number,
            _schema: unknown,
            handler: (payload: unknown, context: unknown) => Promise<void>,
          ) => state.effectHandlers.set(type, handler),
          registerEventHandler: () => undefined,
        } as never);
      }
    }
    async start() { }
    async stop() { }
    async query(query: { type?: string; characterId?: string; }) {
      const override = state.queryOverrides.get(query.type ?? '');
      if (override !== undefined) {
        return typeof override === 'function'
          ? await (override as () => unknown)()
          : override;
      }
      if (query.type === 'party.info') {
        return { ok: true, value: { party: null, revision: 0, activity: [] } };
      }
      if (query.type === 'team.combat.info') {
        return { ok: true, value: state.teamCombatProjection };
      }
      if (query.type === 'location.describe') {
        const character = state.characters[query.characterId as keyof typeof state.characters];
        const locationId = character?.locationId ?? 'entry-room';
        const location = state.world.locations.find((candidate) => candidate.id === locationId);
        const name = location?.name ?? locationId;
        return {
          ok: true,
          value: {
            worldInstanceId: instanceId,
            locationId,
            revision: 0,
            title: name,
            shortName: name,
            qualifiedName: name,
            locationGroups: [],
            description: 'A quiet test room.',
            exits: [],
            objects: [],
            occupants: [],
            safeResting: false,
          },
        };
      }
      if (query.type === 'character.stats') {
        return {
          ok: true,
          value: {
            attributes: { strength: 10, intelligence: 10, constitution: 10, dexterity: 10 },
            attackPower: 0,
            spellPower: 0,
            damage: 0,
            critChancePercent: 0,
            healthRegen: 0,
            manaRegen: 0,
            staminaRegen: 0,
            armorPercent: 0,
            resiliencePercent: 0,
            dodgePercent: 0,
          },
        };
      }
      return { ok: true, value: { encounter: null } };
    }
    async processPendingEffects() {
      state.processPendingEffectsStarted += 1;
      state.processPendingEffectsStartedSignal?.();
      state.processPendingEffectsStartedSignal = null;
      if (state.processPendingEffectsGate) await state.processPendingEffectsGate;
      if (state.processPendingEffectsError) {
        const error = state.processPendingEffectsError;
        state.processPendingEffectsError = null;
        throw error;
      }
      while (state.pendingEffects.length) {
        const effect = state.pendingEffects.shift();
        if (!effect) continue;
        await state.effectHandlers.get(effect.type)?.(effect.payload, {
          ...effect.context,
          world: state.world,
        });
      }
    }
    async dispatch(command: {
      type?: string;
      commandId?: string;
      characterId?: string;
      payload?: { exitId?: string; };
    }) {
      if (state.dispatchError) {
        const error = state.dispatchError;
        state.dispatchError = null;
        throw error;
      }
      const nextCommandResult = state.nextCommandResult;
      if (nextCommandResult) {
        state.nextCommandResult = null;
        return nextCommandResult;
      }
      if (command.type === 'character.wallet.initialize' && command.characterId) {
        const character = state.characters[command.characterId as keyof typeof state.characters];
        if (character) character.wallet = { currencyId: 'test-currency', balance: 10 };
      }
      if (command.type === 'character.move' && command.characterId && command.payload?.exitId) {
        const prior = state.moveReceipts.get(command.commandId ?? '');
        if (prior) return { ...prior, commitOutcome: 'duplicate' };
        const character = state.characters[command.characterId as keyof typeof state.characters];
        const destination = character
          ? {
            'entry-room': {
              'to-arrival-room': 'arrival-room',
              'to-quiet-room': 'quiet-room',
            },
            'arrival-room': { 'back-to-entry': 'entry-room' },
            'quiet-room': { 'back-to-entry': 'entry-room' },
          }[character.locationId]?.[command.payload.exitId]
          : undefined;
        const fromLocationId = character?.locationId;
        if (character && destination) {
          character.locationId = destination;
          state.pendingEffects.push({
            effectId: `move-effect-${command.commandId}`,
            type: 'world.location.entered',
            payload: { characterId: command.characterId, fromLocationId, toLocationId: destination },
            context: {
              effectId: `move-effect-${command.commandId}`,
              worldInstanceId: instanceId,
              sourceStreamId: command.characterId,
              causationCommandId: command.commandId ?? '',
            },
          });
        }
        const result = { receipt: { ok: true }, commitOutcome: 'committed', completingEffects: 0 };
        state.moveReceipts.set(command.commandId ?? '', result);
        return result;
      }
      return { receipt: { ok: true }, commitOutcome: 'committed', completingEffects: 0 };
    }
    async settleCommandEffects(
      session: { actorId?: string; },
      result: { completingEffects?: number; },
    ) {
      state.settledCommands.push({ session, result });
      if (state.settleCommandEffectsError) {
        const error = state.settleCommandEffectsError;
        state.settleCommandEffectsError = null;
        throw error;
      }
      return state.settleCommandEffectsResult;
    }
    async dispatchSystem(command: Record<string, unknown>) {
      state.systemCommands.push(command);
      return state.systemCommandResults.shift() ?? { receipt: { ok: true } };
    }
  },
  replayCharacter: (character: unknown) => {
    if (state.characterReplayOverride !== null) return state.characterReplayOverride;
    if (Array.isArray(character) && character.length === 0) return undefined;
    if (!character || typeof character !== 'object') return undefined;
    const value = character as { characterId: string; locationId: string; };
    return {
      ...character,
      worldInstanceId: instanceId,
      revision: 0,
      visitedLocationIds: [value.locationId],
    };
  },
}));

vi.mock('../../jobs/autonomous-npc-scheduler.js', () => ({
  createAutonomousNpcScheduler: (options: { onError: (error: unknown, npcId: string) => void; }) => {
    const start = vi.fn();
    const stop = vi.fn();
    state.autonomousSchedulers.push({ options, start, stop });
    return { start, stop, wake: vi.fn(), tick: vi.fn() };
  },
}));

// This HTTP routing fixture does not model recovery histories/heartbeats.
// Recovery has its own clock-driven tests.
vi.mock('../../jobs/stamina-recovery-scheduler.js', () => ({
  createStaminaRecoveryScheduler: (options: {
    listSessions: (activeSince?: Date) => Promise<unknown[]>;
    onError: (error: unknown, characterId: string) => void;
  }) => {
    const start = vi.fn();
    const stop = vi.fn();
    state.staminaSchedulers.push({ options, start, stop });
    return { start, stop, tick: vi.fn() };
  },
}));
vi.mock('../../jobs/object-lifecycle-scheduler.js', () => ({
  createObjectLifecycleScheduler: (options: {
    onError: (error: unknown, worldInstanceId: string, objectId?: string) => void;
  }) => {
    state.objectLifecycleErrorHandlers.push(options.onError);
    return { start: vi.fn(), stop: vi.fn(), tick: vi.fn() };
  },
}));
vi.mock('../../rooms/room-presence-service.js', () => ({
  listRoomOccupants: async () => [],
  touchWorldSessionPresence: async (...args: unknown[]) => {
    state.presenceTouches.push(args);
    return true;
  },
}));
vi.mock('../../realtime/realtime-notifications.js', () => ({
  startRealtimeNotifications: (
    invalidate: (change: unknown) => void,
    refresh: () => void,
    connectionState: (connected: boolean) => void,
  ) => {
    state.realtimeNotificationCallbacks = { invalidate, refresh, connectionState };
    connectionState(true);
    return vi.fn();
  },
}));

vi.mock('../../rooms/npc-announcer.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../rooms/npc-announcer.js')>();
  return {
    ...actual,
    createNpcRoomAnnouncer: (publish: Parameters<typeof actual.createNpcRoomAnnouncer>[0], cooldownMs?: number, now?: () => number) => {
      const announce = actual.createNpcRoomAnnouncer(publish, cooldownMs, now);
      return async (input: Parameters<typeof announce>[0]) => {
        announcementState.attempts += 1;
        return announce(input);
      };
    },
  };
});

vi.mock('@mudd/world-demo', () => ({
  DEMO_WORLD_INSTANCE_ID: instanceId,
  demoWorld: state.world,
}));

vi.mock('../../db/client.js', async () => {
  const { PgDialect } = await import('drizzle-orm/pg-core');
  const dialect = new PgDialect();
  const lastPlayed = new Map<string, Date>();

  function filtersFor(condition: unknown) {
    if (!condition) return {};
    const { sql, params } = dialect.sqlToQuery(condition as never);
    const filters: Record<string, { operator: string; value: unknown; }> = {};
    for (const match of sql.matchAll(/"[^"]+"\."([^"]+)"\s*(=|>)\s*\$(\d+)/g)) {
      const [, column, operator, position] = match;
      if (column && operator && position) {
        filters[column] = { operator, value: params[Number(position) - 1] };
      }
    }
    return filters;
  }

  function matches(row: Record<string, unknown>, filters: ReturnType<typeof filtersFor>) {
    return Object.entries(filters).every(([column, filter]) => {
      const key = column.replace(/_([a-z])/g, (_match, letter: string) => letter.toUpperCase());
      const value = row[key];
      return filter.operator === '>'
        ? Number(value) > Number(filter.value)
        : value === filter.value;
    });
  }

  function select() {
    return {
      from(table: { [key: symbol]: unknown; }) {
        const tableName = table[Symbol.for('drizzle:BaseName')];
        let condition: unknown;
        let orderSql = '';
        let rowLimit = Number.POSITIVE_INFINITY;

        const execute = () => {
          const filters = filtersFor(condition);
          let rows: Record<string, unknown>[] = [];
          if (tableName === 'characters') {
            rows = Object.entries(state.characters).map(([id, character]) => ({
              id,
              playerId: state.charactersByOwner[id as keyof typeof state.charactersByOwner],
              worldInstanceId: state.characterWorldInstanceOverrides.get(id) ?? instanceId,
              archivedAt: null,
              lastPlayedAt: lastPlayed.get(id) ?? null,
              ...character,
            }));
          } else if (tableName === 'world_sessions') {
            state.worldSessionSelectCount++;
            rows = [...state.sessions.values()];
          } else if (tableName === 'room_chat_messages') {
            rows = state.messages;
          }

          rows = rows.filter((row) => matches(row, filters));
          if (orderSql.includes(' desc')) rows.sort((a, b) => Number(b.id) - Number(a.id));
          else if (orderSql.includes(' asc')) rows.sort((a, b) => Number(a.id) - Number(b.id));
          return rows.slice(0, rowLimit);
        };

        const query = {
          where(value: unknown) {
            condition = value;
            return this;
          },
          orderBy(value: unknown) {
            orderSql = dialect.sqlToQuery(value as never).sql;
            return this;
          },
          limit(value: number) {
            rowLimit = value;
            return Promise.resolve(execute());
          },
          then(resolve: (rows: Record<string, unknown>[]) => unknown, reject?: (error: unknown) => unknown) {
            return Promise.resolve(execute()).then(resolve, reject);
          },
        };
        return query;
      },
    };
  }

  function insert(table: { [key: symbol]: unknown; }) {
    return {
      values(values: Record<string, unknown>) {
        const persist = async () => {
          const tableName = table[Symbol.for('drizzle:BaseName')];
          if (tableName === 'world_sessions') {
            state.sessions.set(values.playerId as string, values);
            return [values];
          }
          if (tableName === 'room_chat_messages') {
            const row = {
              ...values,
              id: state.nextMessageId++,
              createdAt: new Date('2026-10-18T12:00:00.000Z'),
            };
            state.messages.push(row);
            return [row];
          }
          if (tableName === 'durable_effects') {
            const effectId = String(values.id);
            const payload = values.payload;
            state.pendingEffects.push({
              effectId,
              type: String(values.effectType),
              payload,
              context: {
                effectId,
                worldInstanceId: String(values.worldInstanceId),
                sourceStreamId: typeof values.sourceStreamId === 'string' ? values.sourceStreamId : null,
                causationCommandId: String(values.causationCommandId),
              },
            });
          }
          return [];
        };
        return {
          returning: persist,
          then(resolve: (rows: unknown[]) => unknown, reject?: (error: unknown) => unknown) {
            return persist().then(resolve, reject);
          },
        };
      },
    };
  }

  const update = () => ({
    set: () => ({
      where: async (condition: unknown) => {
        const filters = filtersFor(condition);
        const id = filters.id?.value;
        if (typeof id === 'string') lastPlayed.set(id, new Date());
      },
    }),
  });
  const deleteRows = (table: { [key: symbol]: unknown; }) => ({
    where: async (condition: unknown) => {
      if (state.deleteSessionError) {
        const error = state.deleteSessionError;
        state.deleteSessionError = null;
        throw error;
      }
      if (table[Symbol.for('drizzle:BaseName')] !== 'world_sessions') return;
      const filters = filtersFor(condition);
      for (const [playerId, session] of state.sessions) {
        if (matches(session as Record<string, unknown>, filters)) state.sessions.delete(playerId);
      }
    },
  });
  const db = {
    select,
    insert,
    update,
    delete: deleteRows,
    transaction: async (callback: (transaction: unknown) => Promise<unknown>) => callback({
      select,
      insert,
      update,
      delete: deleteRows,
      execute: async () => undefined,
    }),
  };
  return { db, pool: { end: async () => undefined }, warmDatabasePool: async () => undefined };
});

vi.mock('../../rooms/room-chat-service.js', () => ({
  MAX_ROOM_CHAT_MESSAGE_LENGTH: 500,
  NPC_MOVEMENT_MESSAGE_SOURCE_PREFIX: 'world-npc-movement:',
  createPlayerRoomChatMessage: async (input: {
    worldInstanceId: string;
    playerId: string;
    roomId: string;
    characterId: string;
    clientMessageId: string;
    text: string;
  }) => {
    if (state.chatSubmitError) {
      const error = state.chatSubmitError;
      state.chatSubmitError = null;
      throw error;
    }
    if (state.chatSubmitOutcome) {
      const outcome = state.chatSubmitOutcome;
      state.chatSubmitOutcome = null;
      return { kind: outcome };
    }
    const key = `${input.worldInstanceId}:${input.playerId}:${input.clientMessageId}`;
    const prior = state.chatSubmissions.get(key);
    if (prior) {
      const matches = prior.roomId === input.roomId &&
        prior.speakerId === input.characterId &&
        prior.message === input.text;
      return matches
        ? { kind: 'duplicate', message: prior.publicMessage, effectId: prior.effectId }
        : { kind: 'conflict' };
    }
    const character = state.characters[input.characterId as keyof typeof state.characters];
    const session = state.sessions.get(input.playerId);
    if (!character || character.locationId !== input.roomId || session?.characterId !== input.characterId) {
      return { kind: 'unavailable' };
    }
    const row = {
      id: state.nextMessageId++,
      worldInstanceId: input.worldInstanceId,
      playerId: input.playerId,
      submissionId: input.clientMessageId,
      roomId: input.roomId,
      speakerType: 'player',
      speakerId: input.characterId,
      speakerName: character.name,
      message: input.text,
      sourceEffectId: null,
      createdAt: new Date('2026-10-18T12:00:00.000Z'),
    };
    const effectId = `chat-effect-${row.id}`;
    const publicMessage = {
      id: row.id,
      roomId: row.roomId,
      speakerType: row.speakerType,
      speakerName: row.speakerName,
      text: row.message,
      createdAt: row.createdAt.toISOString(),
    };
    state.messages.push(row);
    state.chatSubmissions.set(key, { ...row, publicMessage, effectId });
    state.pendingEffects.push({
      effectId,
      type: 'room-chat.player-message',
      payload: { roomChatMessageId: row.id },
      context: {
        effectId,
        worldInstanceId: input.worldInstanceId,
        sourceStreamId: input.characterId,
        causationCommandId: input.clientMessageId,
      },
    });
    return { kind: 'created', message: publicMessage, effectId };
  },
  getRoomChatMessageById: async (messageId: number) => {
    const message = state.messages.find((candidate) => candidate.id === messageId);
    return message ? {
      id: message.id,
      roomId: message.roomId,
      speakerType: message.speakerType,
      speakerName: message.speakerName,
      text: message.message,
      createdAt: message.createdAt.toISOString(),
    } : undefined;
  },
  getRoomChatMessageBySourceEffectId: async (sourceEffectId: string) => {
    const message = state.messages.find((candidate) => candidate.sourceEffectId === sourceEffectId);
    return message ? {
      id: message.id,
      roomId: message.roomId,
      speakerType: message.speakerType,
      speakerName: message.speakerName,
      text: message.message,
      createdAt: message.createdAt.toISOString(),
    } : undefined;
  },
  listRoomChatMessages: async (input: {
    worldInstanceId: string;
    playerId: string;
    characterId: string;
    roomId: string;
    afterId?: number;
  }) => {
    const character = state.characters[input.characterId as keyof typeof state.characters];
    const session = state.sessions.get(input.playerId);
    if (!character || character.locationId !== input.roomId || session?.characterId !== input.characterId) return undefined;
    const roomMessages = state.messages.filter((message) =>
      message.worldInstanceId === input.worldInstanceId &&
      message.roomId === input.roomId);
    const cursor = roomMessages.at(-1)?.id ?? input.afterId ?? 0;
    return {
      messages: roomMessages
        .filter((message) =>
          (input.afterId !== undefined || !message.sourceEffectId?.startsWith('world-npc-movement:')) &&
          !message.sourceEffectId?.startsWith('world-npc-movement:') &&
          (input.afterId === undefined || message.id > input.afterId))
        .map((message) => ({
          id: message.id,
          roomId: message.roomId,
          speakerType: message.speakerType,
          speakerName: message.speakerName,
          text: message.message,
          createdAt: message.createdAt.toISOString(),
        })),
      terminalEvents: input.afterId === undefined
        ? []
        : roomMessages
          .filter((message) =>
            message.id > input.afterId! &&
            message.sourceEffectId?.startsWith('world-npc-movement:'))
          .map((message) => ({
            id: message.id,
            roomId: message.roomId,
            speakerType: message.speakerType,
            speakerName: message.speakerName,
            text: message.message,
            createdAt: message.createdAt.toISOString(),
          })),
      cursor,
    };
  },
  publishNpcRoomMessage: async (input: {
    worldInstanceId: string;
    roomId: string;
    npcId: string;
    npcName: string;
    text: string;
    sourceEffectId?: string;
  }) => {
    const existing = input.sourceEffectId
      ? state.messages.find((candidate) => candidate.sourceEffectId === input.sourceEffectId)
      : undefined;
    if (existing) {
      return {
        id: existing.id,
        roomId: existing.roomId,
        speakerType: existing.speakerType,
        speakerName: existing.speakerName,
        text: existing.message,
        createdAt: existing.createdAt.toISOString(),
      };
    }
    const row = {
      id: state.nextMessageId++,
      worldInstanceId: input.worldInstanceId,
      playerId: null,
      submissionId: null,
      roomId: input.roomId,
      speakerType: 'npc',
      speakerId: input.npcId,
      speakerName: input.npcName,
      message: input.text,
      sourceEffectId: input.sourceEffectId ?? null,
      createdAt: new Date('2026-10-18T12:00:00.000Z'),
    };
    state.messages.push(row);
    return {
      id: row.id,
      roomId: row.roomId,
      speakerType: row.speakerType,
      speakerName: row.speakerName,
      text: row.message,
      createdAt: row.createdAt.toISOString(),
    };
  },
}));

vi.mock('../middleware/clerk-proxy-middleware.js', () => ({
  CLERK_PROXY_PATH: '/api/__clerk',
  clerkProxyMiddleware: () => (_request: unknown, _response: unknown, next: () => void) => next(),
  getClerkProxyHost: () => 'localhost',
}));

vi.mock('../../persistence/postgres-event-store.js', () => ({
  PostgresEventStore: class {
    async rebuildRoomStates() { }
    async claimDueObjectLifecycles() { return []; }
    withCommandReadCache<T>(
      _worldInstanceId: string,
      _streamId: string,
      run: () => T,
      _expectedVersion?: number,
    ) {
      return run();
    }
    withoutCommandReadCache<T>(run: () => T) {
      return run();
    }
    invalidateCommandReadCache() { }
    async readStream(_worldInstanceId: string, characterId: string) {
      if (state.readStreamError) throw state.readStreamError;
      if (state.readStreamGate) await state.readStreamGate;
      if (state.readStreamSequence.length > 0) return state.readStreamSequence.shift();
      if (characterId === 'woodcutting-trees' || characterId === 'quest-world-outcomes') return [];
      if (characterId.startsWith('world-interactions:')) {
        return characterId === `world-interactions:${state.interactionRequestWorldId}`
          ? state.interactionMaintenanceRequests
          : [];
      }
      if (state.streamlessCharacterIds.has(characterId)) return [];
      return state.characters[characterId as keyof typeof state.characters] ?? null;
    }
    get readStreams() {
      if (!state.batchReadStreams) return undefined;
      return async (worldInstanceId: string, streamIds: string[]) => new Map(
        await Promise.all(streamIds.map(async (streamId) => [
          streamId,
          await this.readStream(worldInstanceId, streamId),
        ] as const)),
      );
    }
  },
}));

vi.mock('../../auth/session-service.js', () => {
  const getAccountIdentity = async (
    request: { headers: { cookie?: string; }; },
    auth: { userId: string | null; sessionId: string; },
  ) => {
    const account = auth.userId ? playersByAuthId[auth.userId] : undefined;
    const cookieGuest = request.headers.cookie?.includes('mudd_guest=test-guest-token') ? state.guestIdentity : null;
    if (!account && !cookieGuest) return undefined;
    if (!account && cookieGuest) return cookieGuest;
    return {
      ...account!,
      clearGuestCookie: false,
      isGuest: false,
      session: {
        sessionId: auth.sessionId,
        playerId: account!.playerId,
        actorId: account!.playerId,
        worldInstanceId: instanceId,
        grantedPermissions: [],
        authenticated: true,
      },
    };
  };
  return {
    expiredGuestCookie: '',
    createGuestIdentity: async () => {
      if (state.guestIdentityError) {
        const error = state.guestIdentityError;
        state.guestIdentityError = null;
        throw error;
      }
      const playerId = 'player-guest';
      const identity = {
        playerId,
        displayName: 'Guest Traveler',
        clearGuestCookie: false as const,
        isGuest: true as const,
        session: {
          sessionId: 'guest-session',
          playerId,
          actorId: playerId,
          worldInstanceId: instanceId,
          grantedPermissions: [],
          authenticated: true as const,
        },
      };
      state.guestIdentity = identity;
      return { identity, setCookie: 'mudd_guest=test-guest-token; Path=/; HttpOnly; SameSite=Strict; Max-Age=2592000' };
    },
    getAccountIdentity,
    getAccountIdentityForRequest: async (
      request: { headers: { cookie?: string; }; },
      auth: { userId: string | null; sessionId: string; },
    ) => ({ identity: await getAccountIdentity(request, auth), worldSessionResolved: false }),
  };
});


export { state, announcementState, instanceId, playersByAuthId };

/** Shared HTTP fixture: explicit runtime startup, injected intervals, and owned cleanup. */
export function useServerHarness() {
  let baseUrl: string;
  let runtime: Awaited<ReturnType<typeof import('../bootstrap.js').startServer>>;
  let server: typeof runtime.server;
  const ownedIntervals: Array<ReturnType<typeof setInterval>> = [];
  const originalApiPort = process.env.API_PORT;
  let stopped = false;
  async function shutdown() {
    if (stopped) return;
    stopped = true;
    for (const timer of ownedIntervals) clearInterval(timer);
    const closed = server?.listening ? once(server, 'close') : Promise.resolve();
    await runtime?.shutdown();
    await closed;
  }
  beforeAll(async () => {
    state.enableAutonomousScheduler = true;
    process.env.API_PORT = '0';
    const { startServer } = await import('../bootstrap.js');
    runtime = await startServer(new URL('../../index.ts', import.meta.url).href, {
      setInterval: ((...args: Parameters<typeof setInterval>) => {
        const [callback, delay] = args;
        if (typeof callback === 'function') state.intervalCallbacks.push({ delay: Number(delay ?? 0), callback: callback as () => void });
        const timer = setInterval(...args);
        ownedIntervals.push(timer);
        if (Number(delay ?? 0) === 2_000) clearInterval(timer);
        return timer;
      }) as typeof setInterval,
      clearInterval, setTimeout, clearTimeout,
    });
    server = runtime.server;
    if (!server.listening) await once(server, 'listening');
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Missing test listener address.');
    baseUrl = `http://127.0.0.1:${address.port}`;
  });
  beforeEach(() => {
    clearRequestIdentityCachesForTests();
    setMembershipListenerConnected(true);
    state.sessions.clear();
    state.worldSessionSelectCount = 0;
    state.characterWorldInstanceOverrides.clear();
    state.guestIdentity = null;
    state.messages.length = 0;
    state.nextMessageId = 1;
    state.chatSubmissions.clear();
    state.chatSubmitError = null;
    state.chatSubmitOutcome = null;
    state.readStreamError = null;
    state.readStreamGate = null;
    state.readStreamSequence.length = 0;
    state.batchReadStreams = false;
    state.streamlessCharacterIds.clear();
    state.nextChatSubmissionId = 1;
    state.moveReceipts.clear();
    state.pendingEffects.length = 0;
    state.effectHandlers.clear();
    const effectPlugin = state.effectPlugin as {
      register?: (context: never) => void;
    } | null;
    effectPlugin?.register?.({
      registerEffect: (
        type: string,
        _version: number,
        _schema: unknown,
        handler: (payload: unknown, context: unknown) => Promise<void>,
      ) => state.effectHandlers.set(type, handler),
      registerEventHandler: () => undefined,
    } as never);
    state.nextMoveId = 1;
    state.interactionEncounter = null;
    state.teamCombatProjection = { encounter: null };
    state.queryOverrides.clear();
    state.characterReplayOverride = null;
    state.systemCommands.length = 0;
    state.systemCommandResults.length = 0;
    state.presenceTouches.length = 0;
    state.nextCommandResult = null;
    state.dispatchError = null;
    state.settledCommands.length = 0;
    state.settleCommandEffectsResult = true;
    state.settleCommandEffectsError = null;
    state.interactionMaintenanceRequests.length = 0;
    state.interactionRequestWorldId = instanceId;
    state.interactionStatusUpdates.length = 0;
    state.processPendingEffectsError = null;
    state.processPendingEffectsGate = null;
    state.processPendingEffectsStarted = 0;
    state.processPendingEffectsStartedSignal = null;
    state.guestIdentityError = null;
    state.deleteSessionError = null;
    announcementState.attempts = 0;
    state.characters['character-alice'].locationId = 'npc-room';
    state.characters['character-bob'].locationId = 'npc-room';
    state.characters['character-elsewhere'].locationId = 'other-room';
    state.characters['character-mover'].locationId = 'entry-room';
  });
  afterAll(async () => {
    await shutdown();
    if (originalApiPort === undefined) delete process.env.API_PORT;
    else process.env.API_PORT = originalApiPort;
  });
  async function sendWorldCommand(
    userId: string,
    command: Record<string, unknown>,
    options: { projection?: boolean; } = {},
  ) {
    return fetch(`${baseUrl}/api/commands`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-test-user': userId,
        ...(options.projection ? { 'x-mudd-command-projection': 'game' } : {}),
      },
      body: JSON.stringify({
        version: 1,
        worldInstanceId: instanceId,
        expectedVersion: 0,
        payload: {},
        ...command,
      }),
    });
  }

  async function enterWorld(userId: string, characterId: string) {
    const response = await fetch(`${baseUrl}/api/world-session`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-test-user': userId,
      },
      body: JSON.stringify({ characterId }),
    });
    expect(response.status).toBe(200);
  }

  async function move(userId: string, characterId: string, exitId: string, commandId?: string) {
    return fetch(`${baseUrl}/api/commands`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-test-user': userId,
      },
      body: JSON.stringify({
        type: 'character.move',
        version: 1,
        commandId: commandId ?? `move-${characterId}-${exitId}-${state.nextMoveId++}`,
        worldInstanceId: instanceId,
        characterId,
        expectedVersion: 0,
        payload: { exitId },
      }),
    });
  }

  async function readRoom(userId: string, roomId: string, afterId?: number) {
    const query = new URLSearchParams({ roomId });
    if (afterId !== undefined) query.set('afterId', String(afterId));
    const response = await fetch(`${baseUrl}/api/chat?${query.toString()}`, {
      headers: { 'x-test-user': userId },
    });
    return {
      response, body: await response.json() as {
        roomId?: string;
        messages?: Array<{ speakerType: string; speakerName: string; text: string; }>;
        terminalEvents?: Array<{ id: number; speakerType: string; speakerName: string; text: string; }>;
        cursor?: number;
      }
    };
  }

  async function sendRoomMessage(
    userId: string,
    roomId: string,
    text: string,
    clientMessageId = `chat-${state.nextChatSubmissionId++}`,
  ) {
    return fetch(`${baseUrl}/api/chat`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-test-user': userId,
      },
      body: JSON.stringify({ roomId, text, clientMessageId }),
    });
  }
  return { get baseUrl() { return baseUrl; }, get server() { return server; }, shutdown, sendWorldCommand, enterWorld, move, readRoom, sendRoomMessage };
}
