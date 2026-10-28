import { createServer } from 'node:net';
import { once } from 'node:events';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  world: {
    packId: 'npc-announcement-test-pack',
    packVersion: '1.0.0',
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
  mobileNpcDefinitions: () => [],
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
  projectInteractionEvents: () => ({ requests: [], latestEncounterEvent: undefined }),
  projectCharacterInteractions: () => ({ requests: [], encounter: null }),
  updateInteractionRequestStatus: async () => false,
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
    constructor(plugins: unknown[] = []) {
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
      if (query.type === 'party.info') {
        return { ok: true, value: { party: null, revision: 0, activity: [] } };
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
    async dispatchSystem() {
      return { receipt: { ok: true } };
    }
  },
  replayCharacter: (character: unknown) => {
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
  createAutonomousNpcScheduler: () => ({
    start: vi.fn(),
    stop: vi.fn(),
    tick: vi.fn(),
  }),
}));

// This HTTP routing fixture does not model recovery histories/heartbeats.
// Recovery has its own clock-driven tests.
vi.mock('./stamina-recovery-scheduler.js', () => ({
  createStaminaRecoveryScheduler: () => ({ start: vi.fn(), stop: vi.fn(), tick: vi.fn() }),
}));
vi.mock('./realtime-notifications.js', () => ({
  startRealtimeNotifications: () => vi.fn(),
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
              worldInstanceId: instanceId,
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
  const db = {
    select,
    insert,
    update,
    transaction: async (callback: (transaction: unknown) => Promise<unknown>) => callback({
      select,
      insert,
      update,
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
      return state.characters[characterId as keyof typeof state.characters] ?? null;
    }
  },
}));

vi.mock('./session-service.js', () => ({
  expiredGuestCookie: '',
  createGuestIdentity: async () => {
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

    process.env.API_PORT = String(port);
    const serverModule = await import('./index.js');
    server = serverModule.server;
    if (!server.listening) await once(server, 'listening');
    baseUrl = `http://127.0.0.1:${port}`;
  });

  beforeEach(() => {
    state.sessions.clear();
    state.guestIdentity = null;
    state.messages.length = 0;
    state.nextMessageId = 1;
    state.chatSubmissions.clear();
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

  it('rejects unauthenticated, unavailable-world, and malformed chat requests', async () => {
    const unauthenticated = await fetch(`${baseUrl}/api/chat?roomId=npc-room`);
    expect(unauthenticated.status).toBe(401);

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
});
