import { createServer } from 'node:net';
import { once } from 'node:events';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  characters: {
    'character-alice': {
      characterId: 'character-alice',
      name: 'Alice',
      locationId: 'npc-room',
      archived: false,
    },
    'character-bob': {
      characterId: 'character-bob',
      name: 'Bob',
      locationId: 'npc-room',
      archived: false,
    },
    'character-elsewhere': {
      characterId: 'character-elsewhere',
      name: 'Elsewhere',
      locationId: 'other-room',
      archived: false,
    },
  },
  charactersByOwner: {
    'character-alice': 'player-alice',
    'character-bob': 'player-bob',
    'character-elsewhere': 'player-elsewhere',
  },
  sessions: new Map(),
  messages: [],
  nextMessageId: 1,
}));

const instanceId = 'npc-announcement-test-world';
const playersByAuthId: Record<string, { playerId: string; displayName: string }> = {
  alice: { playerId: 'player-alice', displayName: 'Alice' },
  bob: { playerId: 'player-bob', displayName: 'Bob' },
  elsewhere: { playerId: 'player-elsewhere', displayName: 'Elsewhere' },
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

vi.mock('@mudd/contracts', async () => {
  const { z } = await import('zod');
  const unusedSchema = { safeParse: () => ({ success: false }), parse: () => ({}) };
  return {
    ArchiveCharacterCommandSchema: unusedSchema,
    CreateCharacterCommandSchema: unusedSchema,
    IdSchema: z.string(),
    LocationDescribeQuerySchema: unusedSchema,
    NpcTalkQuerySchema: unusedSchema,
    ObjectReadQuerySchema: unusedSchema,
    ObjectInspectQuerySchema: unusedSchema,
    RestoreCharacterCommandSchema: unusedSchema,
    RenameCharacterCommandSchema: unusedSchema,
  };
});

vi.mock('@mudd/core-plugins', () => ({
  characterPlugin: {},
  movementPlugin: {},
  npcDialoguePlugin: {},
}));

vi.mock('@mudd/engine-core', () => ({
  EngineHost: class {
    async start() {}
    async stop() {}
    async dispatch() {
      return { receipt: { ok: true } };
    }
  },
  replayCharacter: (character: unknown) => character,
}));

vi.mock('@mudd/world-demo', () => ({
  DEMO_WORLD_INSTANCE_ID: instanceId,
  demoWorld: {
    locations: [
      {
        id: 'npc-room',
        npcs: [{
          id: 'mara',
          name: 'Mara',
          announcements: ['The north bridge is open.'],
        }],
      },
      { id: 'other-room', npcs: [] },
    ],
  },
}));

vi.mock('./db/client.js', async () => {
  const { PgDialect } = await import('drizzle-orm/pg-core');
  const dialect = new PgDialect();

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
        return {
          returning: async () => {
            const tableName = table[Symbol.for('drizzle:BaseName')];
            if (tableName === 'world_sessions') {
              state.sessions.set(values.playerId, values);
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
            return [];
          },
        };
      },
    };
  }

  const db = {
    select,
    insert,
    transaction: async (callback: (transaction: unknown) => Promise<unknown>) => callback({
      select,
      insert,
      execute: async () => undefined,
    }),
  };
  return { db, pool: { end: async () => undefined } };
});

vi.mock('./middlewares/clerkProxyMiddleware.js', () => ({
  CLERK_PROXY_PATH: '/api/__clerk',
  clerkProxyMiddleware: () => (_request: unknown, _response: unknown, next: () => void) => next(),
  getClerkProxyHost: () => 'localhost',
}));

vi.mock('./persistence/postgres-event-store.js', () => ({
  PostgresEventStore: class {
    async readStream(_worldInstanceId: string, characterId: string) {
      return state.characters[characterId as keyof typeof state.characters] ?? null;
    }
  },
}));

vi.mock('./session-service.js', () => ({
  expiredGuestCookie: '',
  getAccountIdentity: async (_request: unknown, auth: { userId: string | null; sessionId: string }) => {
    const account = auth.userId ? playersByAuthId[auth.userId] : undefined;
    if (!account) return undefined;
    return {
      ...account,
      clearGuestCookie: false,
      session: {
        sessionId: auth.sessionId,
        playerId: account.playerId,
        actorId: account.playerId,
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

  async function readRoom(userId: string, roomId: string) {
    const response = await fetch(`${baseUrl}/api/chat?roomId=${roomId}`, {
      headers: { 'x-test-user': userId },
    });
    return { response, body: await response.json() as {
      roomId?: string;
      messages?: Array<{ speakerType: string; speakerName: string; text: string }>;
    } };
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
});
