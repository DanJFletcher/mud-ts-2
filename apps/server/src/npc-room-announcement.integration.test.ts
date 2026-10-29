import { createServer } from 'node:net';
import { once } from 'node:events';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import WebSocket from 'ws';
import { ORRAVETH_WORLD_INSTANCE_ID } from '@mudd/world-orraveth';

const state = vi.hoisted(() => ({
  world: {
    packId: 'npc-announcement-test-pack',
    packVersion: '1.0.0',
    currency: undefined as { id: string; name: string; symbol: string } | undefined,
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
    receipt: { ok: boolean; code?: string; message?: string };
  }>,
  presenceTouches: [] as unknown[][],
  nextCommandResult: null as null | {
    receipt: { ok: boolean; code?: string; message?: string; commandId?: string };
    commitOutcome?: string;
    commandId?: string;
  },
  dispatchError: null as Error | null,
  enableAutonomousScheduler: false,
  autonomousSchedulers: [] as Array<{
    options: { onError: (error: unknown, npcId: string) => void };
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
  intervalCallbacks: [] as Array<{ delay: number; callback: () => void }>,
  processPendingEffectsError: null as Error | null,
  processPendingEffectsGate: null as Promise<void> | null,
  processPendingEffectsStarted: 0,
  guestIdentityError: null as Error | null,
  deleteSessionError: null as Error | null,
  realtimeNotificationCallbacks: null as null | {
    invalidate: (change: unknown) => void;
    refresh: () => void;
  },
}));

const announcementState = vi.hoisted(() => ({ attempts: 0 }));
const instanceId = 'npc-announcement-test-world';
const playersByAuthId: Record<string, { playerId: string; displayName: string }> = {
  alice: { playerId: 'player-alice', displayName: 'Alice' },
  bob: { playerId: 'player-bob', displayName: 'Bob' },
  elsewhere: { playerId: 'player-elsewhere', displayName: 'Elsewhere' },
  mover: { playerId: 'player-mover', displayName: 'Mover' },
};

vi.mock('@clerk/express', () => ({
  clerkMiddleware: () => (_request: unknown, _response: unknown, next: () => void) => next(),
  getAuth: (request: { headers: Record<string, string | undefined> }) => ({
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
          manifest?: { id?: string };
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
    async start() {}
    async stop() {}
    async query(query: { type?: string; characterId?: string }) {
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
      payload?: { exitId?: string };
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
        const result = { receipt: { ok: true }, commitOutcome: 'committed' };
        state.moveReceipts.set(command.commandId ?? '', result);
        return result;
      }
      return { receipt: { ok: true }, commitOutcome: 'committed' };
    }
    async dispatchSystem(command: Record<string, unknown>) {
      state.systemCommands.push(command);
      return state.systemCommandResults.shift() ?? { receipt: { ok: true } };
    }
  },
  replayCharacter: (character: unknown) => {
    if (state.characterReplayOverride !== null) return state.characterReplayOverride;
    if (!character || typeof character !== 'object') return undefined;
    const value = character as { characterId: string; locationId: string };
    return {
      ...character,
      worldInstanceId: instanceId,
      revision: 0,
      visitedLocationIds: [value.locationId],
    };
  },
}));

vi.mock('./autonomous-npc-scheduler.js', () => ({
  createAutonomousNpcScheduler: (options: { onError: (error: unknown, npcId: string) => void }) => {
    const start = vi.fn();
    const stop = vi.fn();
    state.autonomousSchedulers.push({ options, start, stop });
    return { start, stop, tick: vi.fn() };
  },
}));

// This HTTP routing fixture does not model recovery histories/heartbeats.
// Recovery has its own clock-driven tests.
vi.mock('./stamina-recovery-scheduler.js', () => ({
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
vi.mock('./object-lifecycle-scheduler.js', () => ({
  createObjectLifecycleScheduler: (options: {
    onError: (error: unknown, worldInstanceId: string, objectId?: string) => void;
  }) => {
    state.objectLifecycleErrorHandlers.push(options.onError);
    return { start: vi.fn(), stop: vi.fn(), tick: vi.fn() };
  },
}));
vi.mock('./room-presence-service.js', () => ({
  listRoomOccupants: async () => [],
  touchWorldSessionPresence: async (...args: unknown[]) => {
    state.presenceTouches.push(args);
    return true;
  },
}));
vi.mock('./realtime-notifications.js', () => ({
  startRealtimeNotifications: (
    invalidate: (change: unknown) => void,
    refresh: () => void,
  ) => {
    state.realtimeNotificationCallbacks = { invalidate, refresh };
    return vi.fn();
  },
}));

vi.mock('./npc-announcer.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./npc-announcer.js')>();
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

vi.mock('./db/client.js', async () => {
  const { PgDialect } = await import('drizzle-orm/pg-core');
  const dialect = new PgDialect();
  const lastPlayed = new Map<string, Date>();

  function filtersFor(condition: unknown) {
    if (!condition) return {};
    const { sql, params } = dialect.sqlToQuery(condition as never);
    const filters: Record<string, { operator: string; value: unknown }> = {};
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
      from(table: { [key: symbol]: unknown }) {
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

  function insert(table: { [key: symbol]: unknown }) {
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
  const deleteRows = (table: { [key: symbol]: unknown }) => ({
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
  return { db, pool: { end: async () => undefined } };
});

vi.mock('./room-chat-service.js', () => ({
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

vi.mock('./middlewares/clerkProxyMiddleware.js', () => ({
  CLERK_PROXY_PATH: '/api/__clerk',
  clerkProxyMiddleware: () => (_request: unknown, _response: unknown, next: () => void) => next(),
  getClerkProxyHost: () => 'localhost',
}));

vi.mock('./persistence/postgres-event-store.js', () => ({
  PostgresEventStore: class {
    async rebuildRoomStates() {}
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
    invalidateCommandReadCache() {}
    async readStream(_worldInstanceId: string, characterId: string) {
      if (state.readStreamError) throw state.readStreamError;
      if (state.readStreamGate) await state.readStreamGate;
      if (state.readStreamSequence.length > 0) return state.readStreamSequence.shift();
      if (characterId === 'woodcutting-trees') return [];
      if (characterId.startsWith('world-interactions:')) {
        return characterId === `world-interactions:${state.interactionRequestWorldId}`
          ? state.interactionMaintenanceRequests
          : [];
      }
      if (state.streamlessCharacterIds.has(characterId)) return [];
      return state.characters[characterId as keyof typeof state.characters] ?? null;
    }
  },
}));

vi.mock('./session-service.js', () => ({
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
  getAccountIdentity: async (
    request: { headers: { cookie?: string } },
    auth: { userId: string | null; sessionId: string },
  ) => {
    const account = auth.userId ? playersByAuthId[auth.userId] : undefined;
    const cookieGuest = request.headers.cookie?.includes('mudd_guest=test-guest-token') ? state.guestIdentity : null;
    if (!account && !cookieGuest) return undefined;
    if (!account && cookieGuest) return cookieGuest;
    return {
      ...account,
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
  },
}));

describe('NPC room announcements through the server', () => {
  let baseUrl: string;
  let server: typeof import('./index.js').server;
  let shutdownOnSigterm: (() => void) | undefined;

  beforeAll(async () => {
    const probe = createServer();
    await new Promise<void>((resolve, reject) => {
      probe.once('error', reject);
      probe.listen(0, '127.0.0.1', resolve);
    });
    const address = probe.address();
    if (!address || typeof address === 'string') throw new Error('Could not reserve an integration-test port.');
    const port = address.port;
    await new Promise<void>((resolve, reject) => probe.close((error) => error ? reject(error) : resolve()));

    state.enableAutonomousScheduler = true;
    const existingSigtermHandlers = new Set(process.listeners('SIGTERM'));
    process.env.API_PORT = String(port);
    const nativeSetInterval = globalThis.setInterval;
    globalThis.setInterval = ((...args: Parameters<typeof setInterval>) => {
      const [callback, delay] = args;
      if (typeof callback === 'function') {
        state.intervalCallbacks.push({ delay: Number(delay ?? 0), callback: callback as () => void });
      }
      const timer = nativeSetInterval(...args);
      if (Number(delay ?? 0) === 2_000) clearInterval(timer);
      return timer;
    }) as typeof globalThis.setInterval;
    let serverModule: typeof import('./index.js') | undefined;
    try {
      serverModule = await import('./index.js');
    } finally {
      globalThis.setInterval = nativeSetInterval;
    }
    if (!serverModule) throw new Error('Could not load the integration server.');
    server = serverModule.server;
    shutdownOnSigterm = process.listeners('SIGTERM')
      .find((handler) => !existingSigtermHandlers.has(handler)) as (() => void) | undefined;
    if (!server.listening) await once(server, 'listening');
    baseUrl = `http://127.0.0.1:${port}`;
  });

  beforeEach(() => {
    state.sessions.clear();
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
    state.interactionMaintenanceRequests.length = 0;
    state.interactionRequestWorldId = instanceId;
    state.interactionStatusUpdates.length = 0;
    state.processPendingEffectsError = null;
    state.processPendingEffectsGate = null;
    state.processPendingEffectsStarted = 0;
    state.guestIdentityError = null;
    state.deleteSessionError = null;
    announcementState.attempts = 0;
    state.characters['character-alice'].locationId = 'npc-room';
    state.characters['character-bob'].locationId = 'npc-room';
    state.characters['character-elsewhere'].locationId = 'other-room';
    state.characters['character-mover'].locationId = 'entry-room';
  });

  it('starts a guest session and accepts its cookie on account APIs', async () => {
    const start = await fetch(`${baseUrl}/api/guest-session`, { method: 'POST' });
    expect(start.status).toBe(200);
    expect(start.headers.get('set-cookie')).toContain('HttpOnly; SameSite=Strict');
    expect(start.headers.get('set-cookie')).not.toContain('player-guest');

    const roster = await fetch(`${baseUrl}/api/characters`, {
      headers: { cookie: 'mudd_guest=test-guest-token' },
    });
    expect(roster.status).toBe(200);
    expect(await roster.json()).toMatchObject({
      player: { id: 'player-guest', displayName: 'Guest Traveler' },
      characters: [],
      activeWorldSession: null,
    });
  });

  it('serves health checks and prevents signed-in users from starting guest sessions', async () => {
    const health = await fetch(`${baseUrl}/api/health`);
    expect(health.status).toBe(200);
    expect(await health.json()).toEqual({ status: 'ok' });

    const guestSession = await fetch(`${baseUrl}/api/guest-session`, {
      method: 'POST',
      headers: { 'x-test-user': 'alice' },
    });
    expect(guestSession.status).toBe(409);
    expect(await guestSession.json()).toEqual({
      message: 'Sign out before starting a guest session.',
    });
  });

  it('routes guest-session creation failures through standard error handling', async () => {
    state.guestIdentityError = new Error('Guest identity unavailable.');

    const response = await fetch(`${baseUrl}/api/guest-session`, { method: 'POST' });

    expect(response.status).toBe(500);
  });

  it('emits structured measurements for an explicitly traced snapshot request', async () => {
    const traceId = '3b47bd31-7242-40fb-9d8f-4d3a1d9f6e4f';
    const infoLog = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    try {
      const response = await fetch(`${baseUrl}/api/game`, {
        headers: {
          'x-test-user': 'alice',
          'x-mudd-trace-id': traceId,
          'x-mudd-trace-phase': 'snapshot',
        },
      });
      expect(response.status).toBe(409);
      await response.json();
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(response.headers.get('x-mudd-trace-id')).toBe(traceId);
      expect(infoLog).toHaveBeenCalledWith(expect.stringContaining('"event":"mudd_traced_http_request"'));
    } finally {
      infoLog.mockRestore();
    }
  });

  it('forwards session-entry and session-leave storage failures to error handling', async () => {
    state.readStreamError = new Error('Character history unavailable.');
    const entry = await fetch(`${baseUrl}/api/world-session`, {
      method: 'POST',
      headers: {
        'x-test-user': 'alice',
        'x-mudd-world-instance': instanceId,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ characterId: 'character-alice' }),
    });
    expect(entry.status).toBe(500);

    state.readStreamError = null;
    state.deleteSessionError = new Error('Session storage unavailable.');
    const leave = await fetch(`${baseUrl}/api/world-session`, {
      method: 'DELETE',
      headers: { 'x-test-user': 'alice', 'x-mudd-world-instance': instanceId },
    });
    expect(leave.status).toBe(500);
  });

  it('lists registered worlds without requiring an account', async () => {
    const response = await fetch(`${baseUrl}/api/worlds`);
    expect(response.status).toBe(200);
    const worlds = await response.json() as Array<{
      worldInstanceId: string;
      packId: string;
      summary: string;
    }>;
    expect(worlds).toEqual(expect.arrayContaining([
      expect.objectContaining({
        worldInstanceId: instanceId,
        packId: state.world.packId,
        summary: expect.any(String),
      }),
    ]));
  });

  it('lists only the signed-in player’s characters and selected world sessions', async () => {
    const unauthorized = await fetch(`${baseUrl}/api/characters`);
    expect(unauthorized.status).toBe(401);

    const headers = { 'x-test-user': 'alice' };
    const rosterBeforeEntry = await fetch(`${baseUrl}/api/characters`, { headers });
    expect(rosterBeforeEntry.status).toBe(200);
    expect(await rosterBeforeEntry.json()).toMatchObject({
      player: { id: 'player-alice', displayName: 'Alice' },
      characters: [expect.objectContaining({
        characterId: 'character-alice',
        locationTitle: 'NPC Room',
        lastPlayedAt: null,
      })],
      activeWorldSession: null,
      activeWorldSessions: [],
    });

    await enterWorld('alice', 'character-alice');
    const rosterInWorld = await fetch(`${baseUrl}/api/characters`, { headers });
    expect(rosterInWorld.status).toBe(200);
    expect(await rosterInWorld.json()).toMatchObject({
      player: { id: 'player-alice', displayName: 'Alice' },
      characters: [expect.objectContaining({
        characterId: 'character-alice',
        locationTitle: 'NPC Room',
        lastPlayedAt: expect.any(String),
      })],
      activeWorldSession: {
        id: expect.any(String),
        characterId: 'character-alice',
      },
      activeWorldSessions: [{
        worldInstanceId: instanceId,
        id: expect.any(String),
        characterId: 'character-alice',
      }],
    });
  });

  it('rejects unauthenticated, unavailable-world, and malformed chat requests', async () => {
    const unauthenticated = await fetch(`${baseUrl}/api/chat?roomId=npc-room`);
    expect(unauthenticated.status).toBe(401);

    const unauthenticatedCommand = await fetch(`${baseUrl}/api/commands`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });
    const unauthenticatedQuery = await fetch(`${baseUrl}/api/queries`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(unauthenticatedCommand.status).toBe(401);
    expect(unauthenticatedQuery.status).toBe(401);

    const unavailableWorld = await fetch(`${baseUrl}/api/chat?roomId=npc-room`, {
      headers: {
        'x-test-user': 'alice',
        'x-mudd-world-instance': 'missing-world',
      },
    });
    expect(unavailableWorld.status).toBe(404);

    const missingRoom = await fetch(`${baseUrl}/api/chat`);
    const malformedRoom = await fetch(`${baseUrl}/api/chat?roomId=npc-room&afterId=not-a-number`, {
      headers: { 'x-test-user': 'alice' },
    });
    expect(missingRoom.status).toBe(401);
    expect(malformedRoom.status).toBe(400);
    expect(await malformedRoom.json()).toEqual({ message: 'Invalid room chat request.' });

    const malformedMessage = await fetch(`${baseUrl}/api/chat`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-test-user': 'alice',
      },
      body: JSON.stringify({ roomId: 'npc-room', clientMessageId: 'invalid-chat', text: '   ' }),
    });
    expect(malformedMessage.status).toBe(400);
    expect(await malformedMessage.json()).toEqual({
      message: 'Enter a message up to 500 characters.',
    });
    expect(state.messages).toEqual([]);
  });

  it('rejects room chat reads and writes for a defeated character', async () => {
    await enterWorld('alice', 'character-alice');
    const character = state.characters['character-alice'];
    const originalHealth = character.health;
    try {
      Object.assign(character, { health: { current: 0 } });

      const read = await fetch(`${baseUrl}/api/chat?roomId=npc-room`, {
        headers: { 'x-test-user': 'alice' },
      });
      const write = await sendRoomMessage(
        'alice',
        'npc-room',
        'Can anyone hear me?',
        'defeated-chat',
      );

      expect(read.status).toBe(409);
      expect(await read.json()).toEqual({
        message: 'Your character has died. Start a new character to begin again.',
      });
      expect(write.status).toBe(409);
      expect(await write.json()).toEqual({
        message: 'Your character has died. Start a new character to begin again.',
      });
    } finally {
      character.health = originalHealth;
    }
  });

  it('maps chat persistence races to room-changed and message-ID-conflict responses', async () => {
    await enterWorld('alice', 'character-alice');

    state.chatSubmitOutcome = 'unavailable';
    const moved = await sendRoomMessage('alice', 'npc-room', 'Still here?', 'moved-during-submit');
    expect(moved.status).toBe(409);
    expect(await moved.json()).toEqual({
      message: 'You have moved to a different room or left the world.',
    });

    state.chatSubmitOutcome = 'conflict';
    const duplicateId = await sendRoomMessage('alice', 'npc-room', 'Different text', 'reused-message-id');
    expect(duplicateId.status).toBe(409);
    expect(await duplicateId.json()).toEqual({
      message: 'This message ID was already used for a different message.',
    });
  });

  it('validates character command schemas and selected-world ownership before dispatch', async () => {
    const postCommand = (body: unknown) => fetch(`${baseUrl}/api/commands`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-test-user': 'alice',
      },
      body: JSON.stringify(body),
    });

    const wrongWorld = await postCommand({
      type: 'character.create',
      version: 1,
      commandId: 'wrong-world-command',
      worldInstanceId: 'another-world',
      payload: { name: 'Rill' },
    });
    expect(wrongWorld.status).toBe(400);
    expect(await wrongWorld.json()).toEqual({
      message: 'Choose a command for the selected world.',
    });

    for (const type of [
      'character.create',
      'character.rename',
      'character.archive',
      'character.restore',
    ]) {
      const invalid = await postCommand({ type, worldInstanceId: instanceId });
      expect(invalid.status, type).toBe(400);
      expect(await invalid.json()).toMatchObject({ message: expect.stringContaining('Invalid character') });
    }
  });

  it('rejects archiving the active character and commands for another player’s character', async () => {
    await enterWorld('alice', 'character-alice');
    const postCommand = (body: unknown) => fetch(`${baseUrl}/api/commands`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-test-user': 'alice',
      },
      body: JSON.stringify(body),
    });

    const archive = await postCommand({
      type: 'character.archive',
      version: 1,
      commandId: 'archive-active-character',
      worldInstanceId: instanceId,
      characterId: 'character-alice',
      expectedVersion: 0,
      payload: {},
    });
    expect(archive.status).toBe(409);
    expect(await archive.json()).toEqual({
      message: 'Leave the world before archiving this character.',
    });

    const rename = await postCommand({
      type: 'character.rename',
      version: 1,
      commandId: 'rename-bobs-character',
      worldInstanceId: instanceId,
      characterId: 'character-bob',
      expectedVersion: 0,
      payload: { name: 'Not Alice’s character' },
    });
    expect(rename.status).toBe(404);
    expect(await rename.json()).toEqual({
      message: 'That character does not belong to this world.',
    });
  });

  it('returns a request-scoped server error for command dispatch failures', async () => {
    state.nextCommandResult = {
      receipt: {
        ok: false,
        code: 'INTERNAL_ERROR',
        message: 'The command failed in the engine.',
      },
      commitOutcome: 'committed',
      commandId: 'failed-create',
    };
    const response = await fetch(`${baseUrl}/api/commands`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-test-user': 'alice',
      },
      body: JSON.stringify({
        type: 'character.create',
        version: 1,
        commandId: 'failed-create',
        worldInstanceId: instanceId,
        payload: { name: 'Rill' },
      }),
    });

    expect(response.status).toBe(500);
    const body = await response.json() as { message: string; requestId: string };
    expect(body.message).toBe('The command failed in the engine.');
    expect(body.requestId).toEqual(expect.any(String));
  });

  it('routes thrown command dispatch errors through the request error handler', async () => {
    state.dispatchError = new Error('Engine dispatch threw.');
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      const response = await fetch(`${baseUrl}/api/commands`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-test-user': 'alice',
        },
        body: JSON.stringify({
          type: 'character.create',
          version: 1,
          commandId: 'throwing-command',
          worldInstanceId: instanceId,
          payload: { name: 'Rill' },
        }),
      });

      expect(response.status).toBe(500);
      expect(await response.json()).toMatchObject({
        message: 'The game server could not complete that request.',
        requestId: response.headers.get('x-request-id'),
      });
      expect(errorLog).toHaveBeenCalledWith(
        expect.stringContaining('Request failed'),
        expect.any(Error),
      );
    } finally {
      errorLog.mockRestore();
    }
  });

  it('keeps game, chat, and interaction stream read failures behind the request error handler', async () => {
    await enterWorld('alice', 'character-alice');
    state.readStreamError = new Error('Stream read failed.');
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      for (const path of [
        '/api/game',
        '/api/chat?roomId=npc-room',
        '/api/interactions',
      ]) {
        const response = await fetch(`${baseUrl}${path}`, {
          headers: { 'x-test-user': 'alice' },
        });
        expect(response.status).toBe(500);
        expect(await response.json()).toMatchObject({
          message: 'The game server could not complete that request.',
          requestId: response.headers.get('x-request-id'),
        });
      }
      expect(errorLog).toHaveBeenCalledTimes(3);
    } finally {
      state.readStreamError = null;
      errorLog.mockRestore();
    }
  });

  it('routes thrown room-chat submissions through the request error handler', async () => {
    await enterWorld('alice', 'character-alice');
    state.chatSubmitError = new Error('Chat persistence failed.');
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      const response = await sendRoomMessage(
        'alice',
        'npc-room',
        'Hello there.',
        'chat-persistence-error',
      );
      expect(response.status).toBe(500);
      expect(await response.json()).toMatchObject({
        message: 'The game server could not complete that request.',
        requestId: response.headers.get('x-request-id'),
      });
      expect(errorLog).toHaveBeenCalledOnce();
    } finally {
      state.chatSubmitError = null;
      errorLog.mockRestore();
    }
  });

  it('fails closed when party or team-combat prechecks return invalid projections', async () => {
    await enterWorld('alice', 'character-alice');
    const postCommand = (body: unknown) => fetch(`${baseUrl}/api/commands`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-test-user': 'alice',
      },
      body: JSON.stringify(body),
    });
    const movement = {
      type: 'character.move',
      version: 1,
      worldInstanceId: instanceId,
      characterId: 'character-alice',
      expectedVersion: 0,
      payload: { exitId: 'exit-north' },
    };
    state.queryOverrides.set('team.combat.info', { ok: true, value: {} });

    const invalidTeamStatus = await postCommand({
      ...movement,
      commandId: 'invalid-team-status',
    });
    expect(invalidTeamStatus.status).toBe(500);
    expect(await invalidTeamStatus.json()).toEqual({
      message: 'The team combat state could not be checked.',
    });

    state.queryOverrides.delete('team.combat.info');
    state.queryOverrides.set('party.info', { ok: true, value: {} });
    const invalidPartyStatus = await postCommand({
      type: 'combat.action',
      version: 1,
      commandId: 'invalid-party-status',
      worldInstanceId: instanceId,
      characterId: 'character-alice',
      expectedVersion: 0,
      payload: { action: 'attack', targetNpcId: 'wild-deer' },
    });
    expect(invalidPartyStatus.status).toBe(500);
    expect(await invalidPartyStatus.json()).toEqual({
      message: 'The party status could not be checked before combat.',
    });
  });

  it('routes party members to cooperative controls instead of solo combat', async () => {
    await enterWorld('alice', 'character-alice');
    state.queryOverrides.set('party.info', {
      ok: true,
      value: {
        party: {
          groupId: 'party-one',
          groupType: 'party',
          ownerPlayerId: 'player-alice',
          maxMembers: 4,
          isPublic: false,
          status: 'active',
          members: [{
            playerId: 'player-alice',
            characterId: 'character-alice',
            displayName: 'Alice',
          }],
          createdAt: '2026-10-28T12:00:00.000Z',
          leaderName: 'Alice',
        },
        revision: 1,
        activity: [],
      },
    });
    const response = await fetch(`${baseUrl}/api/commands`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-test-user': 'alice',
      },
      body: JSON.stringify({
        type: 'combat.action',
        version: 1,
        commandId: 'party-solo-attack',
        worldInstanceId: instanceId,
        characterId: 'character-alice',
        expectedVersion: 0,
        payload: { action: 'attack', targetNpcId: 'wild-deer' },
      }),
    });

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      message: 'Use the cooperative encounter controls to begin combat with your party.',
    });
  });

  it('keeps a successful move response when its location projection fails or throws', async () => {
    await enterWorld('mover', 'character-mover');
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      state.queryOverrides.set('location.describe', {
        ok: false,
        code: 'NOT_FOUND',
        message: 'The location could not be described.',
      });
      const unavailableProjection = await move(
        'mover',
        'character-mover',
        'to-arrival-room',
        'move-with-unavailable-projection',
      );
      expect(unavailableProjection.status).toBe(200);
      expect(await unavailableProjection.json()).not.toHaveProperty('movementProjection');

      state.queryOverrides.set('location.describe', () => {
        throw new Error('Projection service unavailable.');
      });
      const thrownProjection = await move(
        'mover',
        'character-mover',
        'back-to-entry',
        'move-with-thrown-projection',
      );
      expect(thrownProjection.status).toBe(200);
      expect(await thrownProjection.json()).not.toHaveProperty('movementProjection');

      state.queryOverrides.delete('location.describe');
      state.queryOverrides.set('character.stats', { ok: true, value: {} });
      const invalidProjection = await move(
        'mover',
        'character-mover',
        'to-arrival-room',
        'move-with-invalid-projection',
      );
      expect(invalidProjection.status).toBe(200);
      expect(await invalidProjection.json()).not.toHaveProperty('movementProjection');
      expect(warning).toHaveBeenCalledWith(expect.stringContaining('movement_projection_unavailable'));
      expect(warning).toHaveBeenCalledTimes(3);
      const schemaWarning = JSON.parse(warning.mock.calls[2]?.[0] as string) as {
        schemaIssues?: Array<{ path: string; code: string }>;
      };
      expect(schemaWarning.schemaIssues?.length).toBeGreaterThan(0);
      state.queryOverrides.delete('character.stats');
    } finally {
      warning.mockRestore();
    }
  });

  it('requires an active world character and rejects chat requests for another room', async () => {
    const missingReadSession = await fetch(`${baseUrl}/api/chat?roomId=npc-room`, {
      headers: { 'x-test-user': 'alice' },
    });
    const missingWriteSession = await sendRoomMessage('alice', 'npc-room', 'Hello.', 'no-world-session');
    const missingInteractionSession = await fetch(`${baseUrl}/api/interactions`, {
      headers: { 'x-test-user': 'alice' },
    });
    expect(missingReadSession.status).toBe(409);
    expect(missingWriteSession.status).toBe(409);
    expect(missingInteractionSession.status).toBe(409);

    await enterWorld('alice', 'character-alice');
    const messagesBeforeWrongRoomRequests = state.messages.length;
    const wrongRoomRead = await readRoom('alice', 'other-room');
    const wrongRoomWrite = await sendRoomMessage('alice', 'other-room', 'Hello.', 'wrong-room-chat');
    expect(wrongRoomRead.response.status).toBe(409);
    expect(wrongRoomWrite.status).toBe(409);
    expect(state.messages).toHaveLength(messagesBeforeWrongRoomRequests);
  });

  it('validates world-session requests and reports unavailable characters', async () => {
    const postSession = (body: unknown) => fetch(`${baseUrl}/api/world-session`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-test-user': 'alice',
      },
      body: JSON.stringify(body),
    });

    const malformed = await postSession({ characterId: '' });
    expect(malformed.status).toBe(400);
    expect(await malformed.json()).toEqual({ message: 'Choose a valid character.' });

    const wrongWorld = await postSession({
      characterId: 'character-alice',
      worldInstanceId: 'another-world',
    });
    expect(wrongWorld.status).toBe(400);
    expect(await wrongWorld.json()).toEqual({
      message: 'Choose a character from the selected world.',
    });

    const unavailable = await postSession({ characterId: 'character-does-not-exist' });
    expect(unavailable.status).toBe(404);
    expect(await unavailable.json()).toEqual({ message: 'That character is unavailable.' });
    expect(state.sessions.size).toBe(0);
  });

  it('rejects world entry for defeated characters and blocks switching while occupied', async () => {
    const postSession = (body: unknown) => fetch(`${baseUrl}/api/world-session`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-test-user': 'alice',
      },
      body: JSON.stringify(body),
    });
    state.characterReplayOverride = {
      ...state.characters['character-alice'],
      health: { current: 0, maximum: 10 },
    };
    const defeated = await postSession({ characterId: 'character-alice' });
    expect(defeated.status).toBe(409);
    expect(await defeated.json()).toEqual({
      message: 'Your character has died. Start a new character to begin again.',
    });
    expect(state.sessions.size).toBe(0);

    state.characterReplayOverride = null;
    await enterWorld('alice', 'character-alice');
    const originalOwner = state.charactersByOwner['character-bob'];
    state.charactersByOwner['character-bob'] = 'player-alice';
    try {
      const occupied = await postSession({ characterId: 'character-bob' });
      expect(occupied.status).toBe(409);
      expect(await occupied.json()).toEqual({
        message: 'Leave the current world session before switching characters.',
      });
      expect(state.sessions.get('player-alice')).toMatchObject({
        characterId: 'character-alice',
      });
    } finally {
      state.charactersByOwner['character-bob'] = originalOwner;
    }
  });

  it('returns a game snapshot only after a character enters the world', async () => {
    const headers = { 'x-test-user': 'alice' };
    const unavailable = await fetch(`${baseUrl}/api/game`, { headers });
    expect(unavailable.status).toBe(409);
    expect(await unavailable.json()).toEqual({
      message: 'Choose a character before entering the world.',
    });

    await enterWorld('alice', 'character-alice');
    const snapshot = await fetch(`${baseUrl}/api/game`, { headers });
    expect(snapshot.status).toBe(200);
    expect(await snapshot.json()).toMatchObject({
      player: { id: 'player-alice', displayName: 'Alice' },
      character: {
        characterId: 'character-alice',
        name: 'Alice',
        locationId: 'npc-room',
      },
      location: {
        locationId: 'npc-room',
        title: 'NPC Room',
        description: 'A quiet test room.',
      },
      stats: { attackPower: 0, spellPower: 0 },
      map: { currentLocationId: 'npc-room' },
    });
  });

  it('projects room-specific fishing, woodcutting, and bulletin-board options', async () => {
    state.characterWorldInstanceOverrides.set('character-alice', ORRAVETH_WORLD_INSTANCE_ID);
    const entered = await fetch(`${baseUrl}/api/world-session`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-test-user': 'alice',
        'x-mudd-world-instance': ORRAVETH_WORLD_INSTANCE_ID,
      },
      body: JSON.stringify({
        characterId: 'character-alice',
        worldInstanceId: ORRAVETH_WORLD_INSTANCE_ID,
      }),
    });
    expect(entered.status).toBe(200);
    const character = state.characters['character-alice'];
    const originalLocationId = character.locationId;
    const originalLocations = state.world.locations.slice();
    const testLocations = [
      { id: 'bellwold-river-bridge', name: 'South Bridge', exits: [], npcs: [] },
      { id: 'bellwold-southbound-track', name: 'Southbound Track', exits: [], npcs: [] },
      { id: 'bellwold-south-common', name: 'South Common', exits: [], npcs: [] },
    ];
    state.world.locations.push(...testLocations);

    try {
      character.locationId = 'bellwold-river-bridge';
      const bridge = await fetch(`${baseUrl}/api/game`, {
        headers: {
          'x-test-user': 'alice',
          'x-mudd-world-instance': ORRAVETH_WORLD_INSTANCE_ID,
        },
      });
      expect(bridge.status).toBe(200);
      expect((await bridge.json()).availableFishingSpots).toContainEqual(
        expect.objectContaining({ id: 'bellwold-south-bridge-fishing' }),
      );

      character.locationId = 'bellwold-southbound-track';
      const track = await fetch(`${baseUrl}/api/game`, {
        headers: {
          'x-test-user': 'alice',
          'x-mudd-world-instance': ORRAVETH_WORLD_INSTANCE_ID,
        },
      });
      expect(track.status).toBe(200);
      expect((await track.json()).availableWoodcuttingTrees).toContainEqual(
        expect.objectContaining({ id: 'bellwold-southbound-pine' }),
      );

      character.locationId = 'bellwold-south-common';
      const common = await fetch(`${baseUrl}/api/game`, {
        headers: {
          'x-test-user': 'alice',
          'x-mudd-world-instance': ORRAVETH_WORLD_INSTANCE_ID,
        },
      });
      expect(common.status).toBe(200);
      expect((await common.json()).dailyActivities.boards).toContainEqual(
        expect.objectContaining({ id: 'bellwold-notice-board' }),
      );
    } finally {
      character.locationId = originalLocationId;
      state.world.locations.splice(0, state.world.locations.length, ...originalLocations);
    }
  });

  it('initializes a missing wallet when building a snapshot for a currency world', async () => {
    await enterWorld('alice', 'character-alice');
    const character = state.characters['character-alice'];
    const originalWallet = character.wallet;
    const originalCurrency = state.world.currency;
    const originalSupplySources = state.world.supplySources.slice();

    try {
      character.wallet = undefined as never;
      state.world.currency = { id: 'test-currency', name: 'Gold', symbol: 'g' };
      state.world.supplySources.push({
        id: 'npc-room-supply',
        locationId: 'npc-room',
        label: 'Test supply source',
        dailyLimit: 1,
        supply: { typeId: 'test-item', label: 'Test item', description: 'A test supply.' },
      } as never);

      const response = await fetch(`${baseUrl}/api/game`, {
        headers: { 'x-test-user': 'alice', 'x-mudd-world-instance': instanceId },
      });

      expect(response.status).toBe(200);
      const snapshot = await response.json();
      expect(snapshot.currency).toEqual({ id: 'test-currency', name: 'Gold', symbol: 'g' });
      expect(snapshot.character.wallet).toEqual({ currencyId: 'test-currency', balance: 10 });
      expect(character.wallet).toEqual({ currencyId: 'test-currency', balance: 10 });
      expect(snapshot.dailyActivities.sources).toContainEqual(expect.objectContaining({
        id: 'npc-room-supply',
        locationId: 'npc-room',
      }));
    } finally {
      character.wallet = originalWallet;
      state.world.currency = originalCurrency;
      state.world.supplySources.splice(0, state.world.supplySources.length, ...originalSupplySources);
    }
  });

  it('fails explicitly when a character row has no creation event in its stream', async () => {
    state.streamlessCharacterIds.add('character-alice');
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      const response = await fetch(`${baseUrl}/api/characters`, {
        headers: { 'x-test-user': 'alice' },
      });
      const body = await response.json() as { requestId: string };

      expect(response.status).toBe(500);
      expect(body.requestId).toBe(response.headers.get('x-request-id'));
      expect(errorLog).toHaveBeenCalledOnce();
    } finally {
      state.streamlessCharacterIds.clear();
      errorLog.mockRestore();
    }
  });

  it('fails explicitly when an owned character references an unregistered world', async () => {
    state.characterWorldInstanceOverrides.set('character-alice', 'missing-world');

    const response = await fetch(`${baseUrl}/api/characters`, {
      headers: { 'x-test-user': 'alice' },
    });

    expect(response.status).toBe(500);
    expect(await response.json()).toMatchObject({
      requestId: response.headers.get('x-request-id'),
    });
  });

  it('reports unavailable characters and location/stat projection failures in game snapshots', async () => {
    await enterWorld('alice', 'character-alice');
    const getGame = () => fetch(`${baseUrl}/api/game`, {
      headers: { 'x-test-user': 'alice' },
    });

    state.characterReplayOverride = undefined;
    const unavailableCharacter = await getGame();
    expect(unavailableCharacter.status).toBe(409);
    expect(await unavailableCharacter.json()).toEqual({
      message: 'That character is no longer available.',
    });
    state.characterReplayOverride = null;

    const failures = [
      { queryType: 'location.describe', code: 'NOT_FOUND', status: 404, message: 'Room not found.' },
      { queryType: 'location.describe', code: 'FORBIDDEN', status: 403, message: 'Room access denied.' },
      { queryType: 'character.stats', code: 'INTERNAL_ERROR', status: 500, message: 'Stats projection failed.' },
      { queryType: 'character.stats', code: 'NOT_FOUND', status: 404, message: 'Stats not found.' },
    ] as const;
    for (const failure of failures) {
      state.queryOverrides.set(failure.queryType, {
        ok: false,
        code: failure.code,
        message: failure.message,
      });
      const response = await getGame();
      expect(response.status, `${failure.queryType}:${failure.code}`).toBe(failure.status);
      const body = await response.json() as { message: string; requestId?: string };
      expect(body.message).toBe(failure.message);
      if (failure.status === 500) expect(body.requestId).toEqual(expect.any(String));
      state.queryOverrides.delete(failure.queryType);
    }
  });

  it('refreshes an active session heartbeat and removes only the leaving player session', async () => {
    const heartbeat = (userId: string) => fetch(`${baseUrl}/api/world-session/heartbeat`, {
      method: 'POST',
      headers: { 'x-test-user': userId },
    });
    const noSession = await heartbeat('alice');
    expect(noSession.status).toBe(409);

    await enterWorld('alice', 'character-alice');
    await enterWorld('bob', 'character-bob');
    const aliceSession = state.sessions.get('player-alice') as { lastSeenAt?: Date };
    aliceSession.lastSeenAt = new Date();

    const refreshed = await heartbeat('alice');
    expect(refreshed.status).toBe(200);
    expect(await refreshed.json()).toEqual({
      worldInstanceId: instanceId,
      locationId: 'npc-room',
      occupants: [],
    });

    const left = await fetch(`${baseUrl}/api/world-session`, {
      method: 'DELETE',
      headers: { 'x-test-user': 'alice' },
    });
    expect(left.status).toBe(204);
    expect(state.sessions.has('player-alice')).toBe(false);
    expect(state.sessions.has('player-bob')).toBe(true);

    const noLongerInWorld = await fetch(`${baseUrl}/api/game`, {
      headers: { 'x-test-user': 'alice' },
    });
    expect(noLongerInWorld.status).toBe(409);
  });

  it('rejects archived or defeated heartbeat characters and handles stream failures', async () => {
    await enterWorld('alice', 'character-alice');
    const character = state.characters['character-alice'];
    const savedCharacter = structuredClone(character);
    const heartbeat = () => fetch(`${baseUrl}/api/world-session/heartbeat`, {
      method: 'POST',
      headers: { 'x-test-user': 'alice' },
    });

    try {
      Object.assign(character, { archived: true });
      const archived = await heartbeat();
      expect(archived.status).toBe(409);
      expect(await archived.json()).toEqual({
        message: 'Enter the world with an active character before sending presence.',
      });

      Object.assign(character, { archived: false, health: { current: 0 } });
      const defeated = await heartbeat();
      expect(defeated.status).toBe(409);
      expect(await defeated.json()).toEqual({
        message: 'Your character has died. Start a new character to begin again.',
      });
    } finally {
      state.characters['character-alice'] = savedCharacter;
    }

    state.readStreamError = new Error('Heartbeat stream read failed.');
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      const failed = await heartbeat();
      expect(failed.status).toBe(500);
      expect(await failed.json()).toMatchObject({ requestId: expect.any(String) });
      expect(errorLog).toHaveBeenCalledOnce();
    } finally {
      state.readStreamError = null;
      errorLog.mockRestore();
    }
  });

  it('returns a conflict when a stale heartbeat cannot re-read its character', async () => {
    await enterWorld('alice', 'character-alice');
    const session = state.sessions.get('player-alice') as { lastSeenAt: Date };
    session.lastSeenAt = new Date(Date.now() - 60_000);
    state.readStreamSequence.push(state.characters['character-alice'], null);

    const response = await fetch(`${baseUrl}/api/world-session/heartbeat`, {
      method: 'POST',
      headers: { 'x-test-user': 'alice' },
    });

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      message: 'Your character is no longer available.',
    });
  });

  it('retries stamina-anchor conflicts and safely reports exhaustion', async () => {
    await enterWorld('alice', 'character-alice');
    const session = state.sessions.get('player-alice') as { lastSeenAt: Date };
    session.lastSeenAt = new Date(Date.now() - 60_000);
    const commandCount = state.systemCommands.length;
    state.systemCommandResults.push(
      { receipt: { ok: false, code: 'VERSION_CONFLICT', message: 'revision changed' } },
      { receipt: { ok: false, code: 'VERSION_CONFLICT', message: 'revision changed' } },
      { receipt: { ok: false, code: 'VERSION_CONFLICT', message: 'revision changed' } },
    );
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      const response = await fetch(`${baseUrl}/api/world-session/heartbeat`, {
        method: 'POST',
        headers: { 'x-test-user': 'alice' },
      });

      expect(response.status).toBe(500);
      expect(state.systemCommands).toHaveLength(commandCount + 3);
      expect(errorLog).toHaveBeenCalledOnce();
    } finally {
      errorLog.mockRestore();
    }
  });

  it('reports non-conflict stamina-anchor failures without retrying them', async () => {
    await enterWorld('alice', 'character-alice');
    const session = state.sessions.get('player-alice') as { lastSeenAt: Date };
    session.lastSeenAt = new Date(Date.now() - 60_000);
    const commandCount = state.systemCommands.length;
    state.systemCommandResults.push({
      receipt: { ok: false, code: 'RULE_VIOLATION', message: 'Recovery is unavailable.' },
    });

    const response = await fetch(`${baseUrl}/api/world-session/heartbeat`, {
      method: 'POST',
      headers: { 'x-test-user': 'alice' },
    });

    expect(response.status).toBe(500);
    expect(state.systemCommands).toHaveLength(commandCount + 1);
  });

  it('logs durable-effect failures and prevents overlapping batches', async () => {
    await enterWorld('alice', 'character-alice');
    const request = () => fetch(`${baseUrl}/api/world-session`, {
      method: 'POST',
      headers: {
        'x-test-user': 'alice',
        'x-mudd-world-instance': instanceId,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ characterId: 'character-alice' }),
    });

    state.processPendingEffectsError = new Error('effect storage unavailable');
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      const failureResponse = await request();
      expect(failureResponse.status).toBe(200);
      expect(errorLog).toHaveBeenCalledWith('Could not process durable event effects.');
    } finally {
      errorLog.mockRestore();
    }

    let releaseBatch: () => void = () => undefined;
    state.processPendingEffectsGate = new Promise<void>((resolve) => {
      releaseBatch = resolve;
    });
    const startedBefore = state.processPendingEffectsStarted;
    const first = request();
    for (let attempt = 0; attempt < 20 && state.processPendingEffectsStarted === startedBefore; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    expect(state.processPendingEffectsStarted).toBeGreaterThan(startedBefore);

    const secondResponse = await request();
    expect(secondResponse.status).toBe(200);
    releaseBatch();
    expect((await first).status).toBe(200);
    state.processPendingEffectsGate = null;
  });

  it('refreshes stale presence and resets recovery when heartbeating or re-entering', async () => {
    await enterWorld('alice', 'character-alice');
    const session = state.sessions.get('player-alice') as { id: string; lastSeenAt?: Date };
    const staleTime = () => new Date(Date.now() - 60 * 60 * 1000);
    session.lastSeenAt = staleTime();

    const heartbeat = await fetch(`${baseUrl}/api/world-session/heartbeat`, {
      method: 'POST',
      headers: { 'x-test-user': 'alice' },
    });
    expect(heartbeat.status).toBe(200);
    expect(state.presenceTouches).toHaveLength(1);
    expect(state.presenceTouches[0]).toEqual([
      'player-alice',
      instanceId,
      session.id,
    ]);
    expect(state.systemCommands).toHaveLength(2);
    expect(state.systemCommands[1]).toMatchObject({
      type: 'character.stamina.recover',
      characterId: 'character-alice',
      payload: { resetAnchor: true },
    });

    session.lastSeenAt = staleTime();
    const reentered = await fetch(`${baseUrl}/api/world-session`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-test-user': 'alice',
      },
      body: JSON.stringify({ characterId: 'character-alice' }),
    });
    expect(reentered.status).toBe(200);
    expect(state.presenceTouches).toHaveLength(2);
    expect(state.systemCommands).toHaveLength(3);
    expect(state.systemCommands[2]).toMatchObject({
      type: 'character.stamina.recover',
      characterId: 'character-alice',
      payload: { resetAnchor: true },
    });
  });

  it('binds world commands to the active character and rejects PvP actions without an encounter', async () => {
    const postCommand = (userId: string, body: unknown) => fetch(`${baseUrl}/api/commands`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-test-user': userId,
      },
      body: JSON.stringify(body),
    });
    const movement = {
      type: 'character.move',
      version: 1,
      commandId: 'guard-move',
      worldInstanceId: instanceId,
      characterId: 'character-alice',
      expectedVersion: 0,
      payload: { exitId: 'exit-north' },
    };

    const withoutSession = await postCommand('alice', movement);
    expect(withoutSession.status).toBe(409);
    expect(await withoutSession.json()).toEqual({
      message: 'Enter the world with a character before taking world actions.',
    });

    await enterWorld('alice', 'character-alice');
    const wrongCharacter = await postCommand('alice', {
      ...movement,
      commandId: 'guard-wrong-character',
      characterId: 'character-bob',
    });
    expect(wrongCharacter.status).toBe(403);
    expect(await wrongCharacter.json()).toEqual({
      message: 'This world session is bound to a different character.',
    });

    const noEncounter = await postCommand('alice', {
      type: 'pvp.action',
      worldInstanceId: instanceId,
      characterId: 'character-alice',
      payload: {},
    });
    expect(noEncounter.status).toBe(409);
    expect(await noEncounter.json()).toEqual({
      message: 'There is no active PvP encounter for this character.',
    });

    const noTeamEncounter = await postCommand('alice', {
      type: 'team.combat.action',
      worldInstanceId: instanceId,
      characterId: 'character-alice',
      payload: {},
    });
    expect(noTeamEncounter.status).toBe(409);
    expect(await noTeamEncounter.json()).toEqual({
      message: 'There is no active team encounter for this character.',
    });
  });

  it('requires an interaction recipient and rejects players who are not online', async () => {
    const postChallenge = (payload: unknown) => fetch(`${baseUrl}/api/commands`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-test-user': 'alice',
      },
      body: JSON.stringify({
        type: 'interaction.request',
        worldInstanceId: instanceId,
        characterId: 'character-alice',
        payload,
      }),
    });
    await enterWorld('alice', 'character-alice');

    const missingRecipient = await postChallenge({ kind: 'pvp.challenge' });
    expect(missingRecipient.status).toBe(400);
    expect(await missingRecipient.json()).toEqual({ message: 'Choose a player to challenge.' });

    const offlineRecipient = await postChallenge({
      kind: 'pvp.challenge',
      recipientCharacterId: 'character-offline',
    });
    expect(offlineRecipient.status).toBe(409);
    expect(await offlineRecipient.json()).toEqual({ message: 'That player is not online right now.' });

    await enterWorld('bob', 'character-bob');
    const bobSession = state.sessions.get('player-bob') as { lastSeenAt?: Date };
    bobSession.lastSeenAt = new Date();
    const onlineRecipient = await postChallenge({
      kind: 'pvp.challenge',
      recipientCharacterId: 'character-bob',
    });
    expect(onlineRecipient.status).toBe(200);
  });

  it('restricts active PvP sessions to PvP actions', async () => {
    await enterWorld('alice', 'character-alice');
    state.interactionEncounter = {
      encounterId: 'pvp-encounter',
      requestId: 'pvp-request',
      locationId: 'npc-room',
      participants: [
        { characterId: 'character-alice', name: 'Alice', health: 10, maximumHealth: 10 },
        { characterId: 'character-bob', name: 'Bob', health: 10, maximumHealth: 10 },
      ],
      turnCharacterId: 'character-alice',
      round: 0,
      status: 'active',
      lastNarration: 'A duel begins.',
      updatedAt: new Date().toISOString(),
    };
    const postCommand = (body: unknown) => fetch(`${baseUrl}/api/commands`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-test-user': 'alice',
      },
      body: JSON.stringify(body),
    });
    const baseCommand = {
      worldInstanceId: instanceId,
      characterId: 'character-alice',
    };

    const movement = await postCommand({
      ...baseCommand,
      type: 'character.move',
      payload: { exitId: 'exit-north' },
    });
    expect(movement.status).toBe(409);
    expect(await movement.json()).toEqual({
      message: 'Only combat actions are available during a PvP encounter.',
    });

    const newChallenge = await postCommand({
      ...baseCommand,
      type: 'interaction.request',
      payload: {},
    });
    expect(newChallenge.status).toBe(409);

    const pvpAction = await postCommand({
      ...baseCommand,
      type: 'pvp.action',
      payload: {},
    });
    expect(pvpAction.status).toBe(200);
  });

  it('restricts active team combat to combat actions while allowing party departure', async () => {
    await enterWorld('alice', 'character-alice');
    state.teamCombatProjection = {
      encounter: {
        encounterId: 'team-encounter',
        locationId: 'npc-room',
        participants: [
          {
            participantId: 'alice-participant',
            teamId: 'party-team',
            kind: 'player',
            characterId: 'character-alice',
            playerId: 'player-alice',
            displayName: 'Alice',
            health: 17,
            maximumHealth: 17,
            defending: false,
            status: 'active',
          },
          {
            participantId: 'bandit-participant',
            teamId: 'bandit-team',
            kind: 'npc',
            npcId: 'bandit',
            displayName: 'Bandit',
            health: 10,
            maximumHealth: 10,
            defending: false,
            status: 'active',
          },
        ],
        contributingPlayerIds: ['player-alice'],
        currentParticipantId: 'alice-participant',
        round: 1,
        status: 'active',
        lastNarration: 'The fight begins.',
        consumedItemIdsByCharacter: {},
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    };
    const postCommand = (type: string) => fetch(`${baseUrl}/api/commands`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-test-user': 'alice',
      },
      body: JSON.stringify({
        type,
        worldInstanceId: instanceId,
        characterId: 'character-alice',
        payload: {},
      }),
    });

    const movement = await postCommand('character.move');
    expect(movement.status).toBe(409);
    expect(await movement.json()).toEqual({
      message: 'Only combat actions are available during a team encounter.',
    });

    const departure = await postCommand('party.leave');
    expect(departure.status).toBe(200);
  });

  it('rejects world actions for zero-health and defeated characters', async () => {
    await enterWorld('alice', 'character-alice');
    const postMovement = (commandId: string) => fetch(`${baseUrl}/api/commands`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-test-user': 'alice',
      },
      body: JSON.stringify({
        type: 'character.move',
        version: 1,
        commandId,
        worldInstanceId: instanceId,
        characterId: 'character-alice',
        expectedVersion: 0,
        payload: { exitId: 'exit-north' },
      }),
    });
    const healthyCharacter = state.characters['character-alice'];
    const defeatedProjections = [
      ['zero-health-block', { ...healthyCharacter, health: { current: 0, maximum: 10 } }],
      ['defeat-status-block', { ...healthyCharacter, combat: { status: 'defeat' } }],
    ] as const;

    for (const [commandId, projection] of defeatedProjections) {
      state.characterReplayOverride = projection;
      const response = await postMovement(commandId);
      expect(response.status, commandId).toBe(409);
      expect(await response.json()).toEqual({
        message: 'Your character has died. Start a new character to begin again.',
      });
    }
    expect(state.moveReceipts.size).toBe(0);
    expect(state.characters['character-alice'].locationId).toBe('npc-room');
  });

  it('validates world queries and enriches location descriptions for the active character', async () => {
    const query = {
      type: 'location.describe',
      version: 1,
      queryId: 'location-query-test',
      worldInstanceId: instanceId,
      characterId: 'character-alice',
      payload: {},
    };
    const postQuery = (body: unknown) => fetch(`${baseUrl}/api/queries`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-test-user': 'alice',
      },
      body: JSON.stringify(body),
    });

    const malformed = await postQuery({ ...query, payload: { unexpected: true } });
    expect(malformed.status).toBe(400);
    expect(await malformed.json()).toEqual({ message: 'Invalid world query.' });

    const withoutSession = await postQuery(query);
    expect(withoutSession.status).toBe(409);
    expect(await withoutSession.json()).toEqual({
      message: 'Enter the world with a character before making a query.',
    });

    await enterWorld('alice', 'character-alice');
    const wrongCharacter = await postQuery({ ...query, characterId: 'character-bob' });
    expect(wrongCharacter.status).toBe(403);
    expect(await wrongCharacter.json()).toEqual({
      message: 'This world session is bound to a different character.',
    });

    const description = await postQuery(query);
    expect(description.status).toBe(200);
    expect(await description.json()).toMatchObject({
      ok: true,
      value: {
        worldInstanceId: instanceId,
        locationId: 'npc-room',
        title: 'NPC Room',
        description: 'A quiet test room.',
        occupants: [],
      },
    });
  });

  it('rejects queries for inactive characters and maps engine query errors to HTTP statuses', async () => {
    await enterWorld('alice', 'character-alice');
    const query = {
      type: 'party.info',
      version: 1,
      queryId: 'party-query-coverage',
      worldInstanceId: instanceId,
      characterId: 'character-alice',
      payload: {},
    };
    const postQuery = () => fetch(`${baseUrl}/api/queries`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-test-user': 'alice',
      },
      body: JSON.stringify(query),
    });

    state.characterReplayOverride = {
      ...state.characters['character-alice'],
      archived: true,
    };
    const archived = await postQuery();
    expect(archived.status).toBe(409);
    expect(await archived.json()).toEqual({
      message: 'Enter the world with an active character before making a query.',
    });

    state.characterReplayOverride = {
      ...state.characters['character-alice'],
      health: { current: 0, maximum: 10 },
    };
    const defeated = await postQuery();
    expect(defeated.status).toBe(409);
    expect(await defeated.json()).toEqual({
      message: 'Your character has died. Start a new character to begin again.',
    });
    state.characterReplayOverride = null;

    const failures = [
      { code: 'INTERNAL_ERROR', status: 500, message: 'The query failed.', correlationId: 'query-correlation-id' },
      { code: 'NOT_FOUND', status: 404, message: 'That party was not found.' },
      { code: 'RULE_VIOLATION', status: 422, message: 'The query is not allowed.' },
      { code: 'FORBIDDEN', status: 403, message: 'Access is denied.' },
    ] as const;
    for (const failure of failures) {
      state.queryOverrides.set('party.info', {
        ok: false,
        code: failure.code,
        message: failure.message,
        ...(failure.correlationId ? { correlationId: failure.correlationId } : {}),
      });
      const response = await postQuery();
      expect(response.status, failure.code).toBe(failure.status);
      const body = await response.json() as { ok: boolean; code: string; message: string; requestId?: string };
      expect(body).toMatchObject({
        ok: false,
        code: failure.code,
        message: failure.message,
      });
      if (failure.code === 'INTERNAL_ERROR') {
        expect(body.requestId).toBe('query-correlation-id');
      }
    }

    state.queryOverrides.delete('party.info');
    const successful = await postQuery();
    expect(successful.status).toBe(200);
    expect(await successful.json()).toMatchObject({ ok: true, value: { party: null } });
  });

  it('uses the current request ID when an internal query error has no correlation ID', async () => {
    await enterWorld('alice', 'character-alice');
    state.queryOverrides.set('party.info', {
      ok: false,
      code: 'INTERNAL_ERROR',
      message: 'The query failed without a correlation ID.',
    });
    try {
      const response = await fetch(`${baseUrl}/api/queries`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-test-user': 'alice',
        },
        body: JSON.stringify({
          type: 'party.info',
          version: 1,
          queryId: 'uncorrelated-internal-query',
          worldInstanceId: instanceId,
          characterId: 'character-alice',
          payload: {},
        }),
      });

      expect(response.status).toBe(500);
      const body = await response.json() as { requestId: string };
      expect(body.requestId).toBe(response.headers.get('x-request-id'));
    } finally {
      state.queryOverrides.delete('party.info');
    }
  });

  it('returns safe status codes and request IDs for unexpected route errors', async () => {
    await enterWorld('alice', 'character-alice');
    const query = {
      type: 'party.info',
      version: 1,
      queryId: 'unexpected-query-error',
      worldInstanceId: instanceId,
      characterId: 'character-alice',
      payload: {},
    };
    const postQuery = () => fetch(`${baseUrl}/api/queries`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-test-user': 'alice',
      },
      body: JSON.stringify(query),
    });
    const cases: Array<{ error: unknown; status: number }> = [
      { error: Object.assign(new Error('unprocessable'), { status: 422 }), status: 422 },
      { error: Object.assign(new Error('out of range'), { status: 399 }), status: 500 },
      { error: 'unstructured failure', status: 500 },
    ];
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      for (const testCase of cases) {
        state.queryOverrides.set('party.info', () => {
          throw testCase.error;
        });
        const response = await postQuery();
        expect(response.status).toBe(testCase.status);
        const body = await response.json() as { message: string; requestId: string };
        expect(body.message).toBe('The game server could not complete that request.');
        expect(body.requestId).toBe(response.headers.get('x-request-id'));
      }
    } finally {
      state.queryOverrides.delete('party.info');
      errorLog.mockRestore();
    }
  });

  it('returns a specific error when JSON request bodies exceed the configured limit', async () => {
    const response = await fetch(`${baseUrl}/api/queries`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ payload: 'x'.repeat(17 * 1024) }),
    });

    expect(response.status).toBe(413);
    const body = await response.json() as { message: string; requestId: string };
    expect(body).toMatchObject({ message: 'The request body is too large.' });
    expect(body.requestId).toBe(response.headers.get('x-request-id'));
  });

  it('returns an interaction inbox for the active character', async () => {
    const unauthenticated = await fetch(`${baseUrl}/api/interactions`);
    expect(unauthenticated.status).toBe(401);

    await enterWorld('alice', 'character-alice');
    const inbox = await fetch(`${baseUrl}/api/interactions`, {
      headers: { 'x-test-user': 'alice' },
    });
    expect(inbox.status).toBe(200);
    expect(await inbox.json()).toEqual({ requests: [], encounter: null });
  });

  it('rejects unsafe real-time origins and closes subscriptions for unavailable worlds', async () => {
    const websocketUrl = `${baseUrl.replace(/^http/, 'ws')}/api/realtime`;
    const closeCode = (socket: WebSocket, subscribe = false) => new Promise<number>((resolve, reject) => {
      socket.once('close', (code) => resolve(code));
      socket.once('error', reject);
      if (subscribe) {
        socket.once('open', () => socket.send(JSON.stringify({
          type: 'subscribe',
          version: 1,
          channels: ['chat'],
        })));
      }
    });

    expect(await closeCode(new WebSocket(websocketUrl, { headers: {} }))).toBe(1008);
    expect(await closeCode(new WebSocket(websocketUrl, {
      headers: { Origin: 'https://untrusted.example' },
    }))).toBe(1008);

    const guestSession = await fetch(`${baseUrl}/api/guest-session`, { method: 'POST' });
    const cookie = guestSession.headers.get('set-cookie')?.split(';', 1)[0];
    expect(cookie).toBeTruthy();
    const unauthorizedWorldSocket = new WebSocket(`${websocketUrl}?world=not-registered`, {
      headers: { Origin: baseUrl, Cookie: cookie! },
    });
    expect(await closeCode(unauthorizedWorldSocket, true)).toBe(1005);

    await enterWorld('alice', 'character-alice');
    const liveSocket = new WebSocket(`${websocketUrl}?world=${encodeURIComponent(instanceId)}`, {
      headers: { Origin: baseUrl, 'x-test-user': 'alice' },
    });
    const frames: Array<{ type?: string }> = [];
    try {
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('Realtime subscription did not resync.')), 3_000);
        liveSocket.on('message', (data) => {
          const frame = JSON.parse(data.toString()) as { type?: string };
          frames.push(frame);
          if (frame.type === 'resync_required') {
            clearTimeout(timeout);
            resolve();
          }
        });
        liveSocket.once('error', reject);
        liveSocket.once('open', () => liveSocket.send(JSON.stringify({
          type: 'subscribe',
          version: 1,
          channels: ['chat', 'presence', 'interactions', 'party', 'team', 'character'],
        })));
      });
      expect(frames.map(({ type }) => type)).toContain('ready');
      expect(frames.map(({ type }) => type)).toContain('resync_required');

      const notifications = state.realtimeNotificationCallbacks;
      if (!notifications) throw new Error('Realtime notification callbacks were not registered.');
      notifications.invalidate({ world: instanceId, kind: 'room', roomId: 'npc-room' });
      notifications.refresh();
    } finally {
      if (liveSocket.readyState !== WebSocket.CLOSED) {
        const closed = once(liveSocket, 'close');
        liveSocket.close();
        await closed;
      }
    }
  });

  it('reports autonomous scheduler errors', async () => {
    expect(state.autonomousSchedulers.length).toBeGreaterThan(0);

    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const scheduler = state.autonomousSchedulers[0];
    scheduler?.options.onError(new Error('scheduler failure'), 'mara');
    expect(errorLog).toHaveBeenCalledWith(
      expect.stringContaining('NPC mara'),
      expect.any(Error),
    );
    errorLog.mockRestore();
  });

  it('lists recovery sessions and reports stamina scheduler failures', async () => {
    const scheduler = state.staminaSchedulers[0];
    if (!scheduler) throw new Error('Stamina recovery scheduler was not registered.');

    await enterWorld('alice', 'character-alice');
    const sessions = await scheduler.options.listSessions();
    expect(sessions).toHaveLength(1);
    expect(await scheduler.options.listSessions(new Date())).toBeDefined();

    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      scheduler.options.onError(new Error('recovery failure'), 'character-alice');
      expect(errorLog).toHaveBeenCalledWith(
        expect.stringContaining('character character-alice'),
        expect.any(Error),
      );
    } finally {
      errorLog.mockRestore();
    }
  });

  it('checks registered-world access and character ownership against the account', async () => {
    const authorization = state.engineAuthorizations[0] as {
      canAccessInstance: (session: { worldInstanceId: string }, id: string) => Promise<boolean>;
      ownsCharacter: (session: {
        sessionId: string;
        playerId: string;
        actorId: string;
        worldInstanceId: string;
        grantedPermissions: never[];
        authenticated: true;
        selectedCharacterId?: string;
      }, characterId: string) => Promise<boolean>;
    } | undefined;
    if (!authorization) throw new Error('World runtime authorization was not registered.');

    expect(await authorization.canAccessInstance({ worldInstanceId: instanceId }, instanceId)).toBe(true);
    expect(await authorization.canAccessInstance({ worldInstanceId: instanceId }, 'missing-world')).toBe(false);

    const session = {
      sessionId: 'session-one',
      playerId: 'player-alice',
      actorId: 'player-alice',
      worldInstanceId: instanceId,
      grantedPermissions: [] as never[],
      authenticated: true as const,
    };
    expect(await authorization.ownsCharacter(session, 'character-alice')).toBe(true);
    expect(await authorization.ownsCharacter(session, 'character-bob')).toBe(false);
  });

  it('reports lifecycle failures with or without a specific world object', () => {
    const onError = state.objectLifecycleErrorHandlers[0];
    if (!onError) throw new Error('Object lifecycle scheduler was not registered.');
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      onError(new Error('decay failure'), instanceId, 'corpse-1');
      onError(new Error('cleanup failure'), instanceId);

      expect(errorLog).toHaveBeenNthCalledWith(
        1,
        expect.stringContaining('Could not expire world object corpse-1'),
        expect.any(Error),
      );
      expect(errorLog).toHaveBeenNthCalledWith(
        2,
        expect.stringContaining(`Could not expire world object in ${instanceId}`),
        expect.any(Error),
      );
    } finally {
      errorLog.mockRestore();
    }
  });

  it('expires and cancels stale interaction requests on the scheduled maintenance tick', async () => {
    const callback = state.intervalCallbacks.find(({ delay }) => delay === 2_000)?.callback;
    if (!callback) throw new Error('Interaction-maintenance interval was not registered.');
    await enterWorld('alice', 'character-alice');
    (state.sessions.get('player-alice') as { lastSeenAt: Date }).lastSeenAt = new Date();
    await new Promise((resolve) => setTimeout(resolve, 10));

    state.interactionMaintenanceRequests.push(
      {
        requestId: 'already-settled',
        status: 'accepted',
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
        initiatorCharacterId: 'character-alice',
        recipientCharacterId: 'character-bob',
      },
      {
        requestId: 'expired-request',
        status: 'pending',
        expiresAt: new Date(Date.now() - 1_000).toISOString(),
        initiatorCharacterId: 'character-alice',
        recipientCharacterId: 'character-bob',
      },
      {
        requestId: 'offline-recipient',
        status: 'pending',
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
        initiatorCharacterId: 'character-alice',
        recipientCharacterId: 'character-bob',
      },
    );

    callback();
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(state.interactionStatusUpdates.map(([, , requestId, status]) => [requestId, status])).toEqual([
      ['expired-request', 'expired'],
      ['offline-recipient', 'cancelled'],
    ]);

    state.interactionStatusUpdates.length = 0;
    state.interactionMaintenanceRequests.length = 0;
    let releaseRead: () => void = () => undefined;
    state.readStreamGate = new Promise<void>((resolve) => {
      releaseRead = resolve;
    });
    callback();
    callback();
    releaseRead();
    await new Promise((resolve) => setTimeout(resolve, 10));
    state.readStreamGate = null;
    expect(state.interactionStatusUpdates).toEqual([]);

    state.readStreamError = new Error('Interaction stream read failed.');
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      callback();
      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(errorLog).toHaveBeenCalledWith('Could not process pending player interaction requests.');
    } finally {
      state.readStreamError = null;
      errorLog.mockRestore();
    }
  });

  afterAll(async () => {
    if (server?.listening) {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => error ? reject(error) : resolve());
      });
    }
  });

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
    return { response, body: await response.json() as {
      roomId?: string;
      messages?: Array<{ speakerType: string; speakerName: string; text: string }>;
      terminalEvents?: Array<{ id: number; speakerType: string; speakerName: string; text: string }>;
      cursor?: number;
    } };
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

  it('publishes once on entry, shares it with that room, and hides it from other rooms', async () => {
    await enterWorld('alice', 'character-alice');
    await enterWorld('bob', 'character-bob');

    const aliceChat = await readRoom('alice', 'npc-room');
    const bobChat = await readRoom('bob', 'npc-room');
    expect(aliceChat.response.status).toBe(200);
    expect(bobChat.response.status).toBe(200);
    expect(aliceChat.body.messages).toEqual([{
      speakerType: 'npc',
      speakerName: 'Mara',
      text: 'The north bridge is open.',
      id: expect.any(Number),
      roomId: 'npc-room',
      createdAt: expect.any(String),
    }]);
    expect(bobChat.body.messages).toEqual(aliceChat.body.messages);
    expect(state.messages).toHaveLength(1);

    await enterWorld('elsewhere', 'character-elsewhere');
    const otherRoomChat = await readRoom('elsewhere', 'other-room');
    expect(otherRoomChat.response.status).toBe(200);
    expect(otherRoomChat.body.messages).toEqual([]);

    const inaccessibleRoomChat = await readRoom('elsewhere', 'npc-room');
    expect(inaccessibleRoomChat.response.status).toBe(409);
  });

  it('routes NPC movement announcements to terminal updates instead of room chat', async () => {
    await enterWorld('alice', 'character-alice');
    const initial = await readRoom('alice', 'npc-room');
    expect(initial.response.status).toBe(200);
    expect(initial.body.messages?.some((message) => message.text.includes('heads south'))).toBe(false);

    const { publishNpcRoomMessage } = await import('./room-chat-service.js');
    const movementNotice = await publishNpcRoomMessage({
      worldInstanceId: instanceId,
      roomId: 'npc-room',
      npcId: 'mossgate-wandering-villager',
      npcName: 'Wandering Villager',
      text: 'A villager heads south, hands clasped behind their back.',
      sourceEffectId: 'world-npc-movement:test-effect:departure',
    });
    const arrivalNotice = await publishNpcRoomMessage({
      worldInstanceId: instanceId,
      roomId: 'npc-room',
      npcId: 'mossgate-patrolling-guard',
      npcName: 'Patrolling Guard',
      text: 'A town guard enters from the north, eyes alert.',
      sourceEffectId: 'world-npc-movement:test-effect:arrival',
    });
    const update = await readRoom('alice', 'npc-room', initial.body.cursor);
    expect(update.response.status).toBe(200);
    expect(update.body.messages).toEqual([]);
    expect(update.body.terminalEvents).toEqual([
      expect.objectContaining({
        id: movementNotice.id,
        speakerName: 'Wandering Villager',
        text: 'A villager heads south, hands clasped behind their back.',
      }),
      expect.objectContaining({
        id: arrivalNotice.id,
        speakerName: 'Patrolling Guard',
        text: 'A town guard enters from the north, eyes alert.',
      }),
    ]);
  });

  it('lets an NPC answer a matching public room message and shares the reply with room occupants', async () => {
    await enterWorld('alice', 'character-alice');
    await enterWorld('bob', 'character-bob');

    const unmatched = await sendRoomMessage('alice', 'npc-room', 'Good morning.');
    expect(unmatched.status).toBe(201);
    expect((await unmatched.json() as { npcMessage?: unknown }).npcMessage).toBeUndefined();

    const matching = await sendRoomMessage('alice', 'npc-room', 'Where is the marker?', 'matching-marker-question');
    expect(matching.status).toBe(201);
    const matchingBody = await matching.json() as {
      message?: { speakerType: string; text: string };
      npcMessage?: { speakerType: string; speakerName: string; text: string; roomId: string };
    };
    expect(matchingBody.message).toMatchObject({ speakerType: 'player', text: 'Where is the marker?' });
    expect(matchingBody.npcMessage).toMatchObject({
      speakerType: 'npc',
      speakerName: 'Mara',
      text: 'The marker still points east.',
      roomId: 'npc-room',
    });
    const matchingRetry = await sendRoomMessage(
      'alice',
      'npc-room',
      'Where is the marker?',
      'matching-marker-question',
    );
    expect(matchingRetry.status).toBe(200);
    expect((await matchingRetry.json() as { npcMessage?: unknown }).npcMessage).toBeUndefined();
    expect(state.messages.filter((message) => message.speakerType === 'player')).toHaveLength(2);
    expect(state.messages.filter((message) =>
      message.speakerType === 'npc' && message.message === 'The marker still points east.',
    )).toHaveLength(1);
    const reusedSubmissionId = await sendRoomMessage(
      'alice',
      'npc-room',
      'A different message',
      'matching-marker-question',
    );
    expect(reusedSubmissionId.status).toBe(409);

    const bobChat = await readRoom('bob', 'npc-room');
    expect(bobChat.body.messages).toContainEqual(expect.objectContaining({
      speakerType: 'npc',
      speakerName: 'Mara',
      text: 'The marker still points east.',
    }));

    const repeated = await sendRoomMessage('bob', 'npc-room', 'The marker?');
    expect(repeated.status).toBe(201);
    expect((await repeated.json() as { npcMessage?: unknown }).npcMessage).toBeUndefined();
    expect(bobChat.body.messages?.filter((message) =>
      message.speakerType === 'npc' &&
      message.speakerName === 'Mara' &&
      message.text === 'The marker still points east.',
    )).toHaveLength(1);
  });

  it('rejects cross-origin state-changing requests before they mutate room chat', async () => {
    await enterWorld('alice', 'character-alice');
    const messageCountBeforeRequest = state.messages.length;
    const response = await fetch(`${baseUrl}/api/chat`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: 'https://attacker.example',
        'x-test-user': 'alice',
      },
      body: JSON.stringify({ roomId: 'npc-room', text: 'forged message' }),
    });

    expect(response.status).toBe(403);
    expect(state.messages).toHaveLength(messageCountBeforeRequest);
  });

  it('returns a bounded request-body error with a request ID', async () => {
    const response = await fetch(`${baseUrl}/api/chat`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: baseUrl,
        'x-test-user': 'alice',
      },
      body: JSON.stringify({ roomId: 'npc-room', text: 'x'.repeat(20_000) }),
    });
    const body = await response.json() as { message?: string; requestId?: string };

    expect(response.status).toBe(413);
    expect(body.message).toBe('The request body is too large.');
    expect(body.requestId).toEqual(expect.any(String));
    expect(response.headers.get('x-request-id')).toBe(body.requestId);
  });

  it('announces on successful movement into an NPC room and applies the arrival cooldown', async () => {
    await enterWorld('mover', 'character-mover');
    expect(state.messages).toEqual([]);

    const arrival = await move('mover', 'character-mover', 'to-arrival-room');
    expect(arrival.status).toBe(200);
    const arrivalChat = await readRoom('mover', 'arrival-room');
    expect(arrivalChat.body.messages).toEqual([expect.objectContaining({
      speakerType: 'npc',
      speakerName: 'Mara',
      text: 'The north bridge is open.',
      roomId: 'arrival-room',
    })]);

    expect((await move('mover', 'character-mover', 'back-to-entry')).status).toBe(200);
    expect((await move('mover', 'character-mover', 'to-arrival-room')).status).toBe(200);
    expect(state.messages).toHaveLength(1);
  });

  it('does not announce when movement enters a room without an announcing NPC', async () => {
    await enterWorld('mover', 'character-mover');

    const arrival = await move('mover', 'character-mover', 'to-quiet-room');
    expect(arrival.status).toBe(200);
    const quietChat = await readRoom('mover', 'quiet-room');

    expect(quietChat.response.status).toBe(200);
    expect(quietChat.body.messages).toEqual([]);
    expect(state.messages).toEqual([]);
  });

  it('does not re-run NPC entry effects for a successful idempotent movement retry', async () => {
    await enterWorld('mover', 'character-mover');
    const commandId = 'same-move-retried';

    expect((await move('mover', 'character-mover', 'to-arrival-room', commandId)).status).toBe(200);
    expect(announcementState.attempts).toBe(1);

    expect((await move('mover', 'character-mover', 'to-arrival-room', commandId)).status).toBe(200);

    expect(announcementState.attempts).toBe(1);
  });

  it('deduplicates NPC announcements for a shared party arrival', async () => {
    const handler = state.effectHandlers.get('world.location.entered');
    expect(handler).toBeDefined();
    const arrivalId = 'team-road:shared-ambush';
    for (const [characterId, effectId] of [
      ['character-alice', 'party-arrival-alice'],
      ['character-bob', 'party-arrival-bob'],
    ]) {
      await handler?.(
        {
          characterId,
          fromLocationId: 'entry-room',
          toLocationId: 'arrival-room',
          arrivalId,
        },
        {
          effectId,
          worldInstanceId: instanceId,
          sourceStreamId: characterId,
          causationCommandId: effectId,
          world: state.world,
        },
      );
    }

    expect(announcementState.attempts).toBe(1);
    expect(state.messages.filter((message) =>
      message.roomId === 'arrival-room' && message.speakerType === 'npc',
    )).toHaveLength(1);
  });

  it('closes the server from its SIGTERM handler', async () => {
    expect(shutdownOnSigterm).toBeTypeOf('function');
    const closed = once(server, 'close');
    shutdownOnSigterm?.();
    await closed;
    expect(server.listening).toBe(false);
  });
});
