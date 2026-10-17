import express, { type Request, type Response } from 'express';
import cors from 'cors';
import { getAuth, clerkMiddleware } from '@clerk/express';
import { publishableKeyFromHost } from '@clerk/shared/keys';
import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';
import {
  ArchiveCharacterCommandSchema,
  CreateCharacterCommandSchema,
  IdSchema,
  LocationDescribeQuerySchema,
  ObjectReadQuerySchema,
  ObjectInspectQuerySchema,
  RestoreCharacterCommandSchema,
  RenameCharacterCommandSchema,
} from '@mudd/contracts';
import { EngineHost, replayCharacter } from '@mudd/engine-core';
import { characterPlugin, movementPlugin } from '@mudd/core-plugins';
import { DEMO_WORLD_INSTANCE_ID, demoWorld } from '@mudd/world-demo';
import { db, pool } from './db/client.js';
import { characters, worldSessions } from './db/schema.js';
import { PostgresEventStore } from './persistence/postgres-event-store.js';
import { expiredGuestCookie, getAccountIdentity, type AccountIdentity } from './session-service.js';
import { CLERK_PROXY_PATH, clerkProxyMiddleware, getClerkProxyHost } from './middlewares/clerkProxyMiddleware.js';

const store = new PostgresEventStore();
const authorization = {
  async canAccessInstance(session: { worldInstanceId: string }, id: string) {
    return session.worldInstanceId === id && id === DEMO_WORLD_INSTANCE_ID;
  },
  async ownsCharacter(session: { playerId: string }, id: string) {
    const [row] = await db.select({ id: characters.id }).from(characters)
      .where(and(eq(characters.id, id), eq(characters.playerId, session.playerId)))
      .limit(1);
    return Boolean(row);
  },
};
const engine = new EngineHost([characterPlugin, movementPlugin], store, authorization, demoWorld);
await engine.start();

const app = express();
app.set('trust proxy', 1);
app.use(CLERK_PROXY_PATH, clerkProxyMiddleware());
app.use(cors({ credentials: true, origin: true }));
app.use(express.json({ limit: '16kb' }));
app.use(clerkMiddleware((req) => ({
  publishableKey: publishableKeyFromHost(getClerkProxyHost(req) ?? '', process.env.CLERK_PUBLISHABLE_KEY),
})));

async function accountFor(request: Request, response: Response): Promise<AccountIdentity | undefined> {
  const auth = getAuth(request);
  const identity = await getAccountIdentity(request, { userId: auth.userId, sessionId: auth.sessionId });
  if (!identity) {
    response.status(401).json({ message: 'Sign in to access your characters.' });
    return undefined;
  }
  if (identity.clearGuestCookie) response.setHeader('Set-Cookie', expiredGuestCookie);
  return identity;
}

async function activeSession(identity: AccountIdentity) {
  const [session] = await db.select().from(worldSessions).where(and(
    eq(worldSessions.playerId, identity.playerId),
    eq(worldSessions.worldInstanceId, DEMO_WORLD_INSTANCE_ID),
  )).limit(1);
  return session;
}

function worldContext(identity: AccountIdentity, session: typeof worldSessions.$inferSelect) {
  return {
    ...identity.session,
    sessionId: session.id,
    worldInstanceId: session.worldInstanceId,
    selectedCharacterId: session.characterId,
  };
}

app.get('/api/characters', async (req, res, next) => {
  try {
    const identity = await accountFor(req, res);
    if (!identity) return;
    const rows = await db.select({
      id: characters.id,
      worldInstanceId: characters.worldInstanceId,
    }).from(characters).where(and(
      eq(characters.playerId, identity.playerId),
      eq(characters.worldInstanceId, DEMO_WORLD_INSTANCE_ID),
    )).orderBy(desc(characters.createdAt));
    const characterList = await Promise.all(rows.map(async (row) => {
      const projection = replayCharacter(await store.readStream(row.worldInstanceId, row.id));
      if (!projection) throw new Error('A character record exists without its creation event.');
      return {
        ...projection,
        locationTitle: demoWorld.locations.find((item) => item.id === projection.locationId)?.name ?? projection.locationId,
      };
    }));
    const current = await activeSession(identity);
    return res.json({
      player: { id: identity.playerId, displayName: identity.displayName },
      characters: characterList,
      activeWorldSession: current ? { id: current.id, characterId: current.characterId } : null,
    });
  } catch (error) {
    next(error);
  }
});

app.post('/api/world-session', async (req, res, next) => {
  try {
    const identity = await accountFor(req, res);
    if (!identity) return;
    const input = z.object({ characterId: IdSchema }).safeParse(req.body);
    if (!input.success) return res.status(400).json({ message: 'Choose a valid character.' });

    const result = await db.transaction(async (tx) => {
      await tx.execute(sql`SELECT id FROM players WHERE id = ${identity.playerId} FOR UPDATE`);
      await tx.execute(sql`SELECT id FROM characters WHERE id = ${input.data.characterId} FOR UPDATE`);
      const [character] = await tx.select({ id: characters.id }).from(characters).where(and(
        eq(characters.id, input.data.characterId),
        eq(characters.playerId, identity.playerId),
        eq(characters.worldInstanceId, DEMO_WORLD_INSTANCE_ID),
        isNull(characters.archivedAt),
      )).limit(1);
      if (!character) return { kind: 'missing' as const };

      const [current] = await tx.select().from(worldSessions).where(and(
        eq(worldSessions.playerId, identity.playerId),
        eq(worldSessions.worldInstanceId, DEMO_WORLD_INSTANCE_ID),
      )).limit(1);
      if (current) {
        return current.characterId === character.id
          ? { kind: 'active' as const, session: current }
          : { kind: 'occupied' as const };
      }

      const [created] = await tx.insert(worldSessions).values({
        id: globalThis.crypto.randomUUID(),
        playerId: identity.playerId,
        worldInstanceId: DEMO_WORLD_INSTANCE_ID,
        characterId: character.id,
      }).returning();
      if (!created) throw new Error('Could not start the world session.');
      return { kind: 'active' as const, session: created };
    });

    if (result.kind === 'missing') return res.status(404).json({ message: 'That character is unavailable.' });
    if (result.kind === 'occupied') return res.status(409).json({ message: 'Leave the current world session before switching characters.' });
    return res.json({ sessionId: result.session.id, characterId: result.session.characterId });
  } catch (error) {
    next(error);
  }
});

app.delete('/api/world-session', async (req, res, next) => {
  try {
    const identity = await accountFor(req, res);
    if (!identity) return;
    await db.delete(worldSessions).where(and(
      eq(worldSessions.playerId, identity.playerId),
      eq(worldSessions.worldInstanceId, DEMO_WORLD_INSTANCE_ID),
    ));
    return res.status(204).end();
  } catch (error) {
    next(error);
  }
});

app.get('/api/game', async (req, res, next) => {
  try {
    const identity = await accountFor(req, res);
    if (!identity) return;
    const current = await activeSession(identity);
    if (!current) return res.status(409).json({ message: 'Choose a character before entering the world.' });
    const events = await store.readStream(current.worldInstanceId, current.characterId);
    const character = replayCharacter(events);
    if (!character || character.archived) return res.status(409).json({ message: 'That character is no longer available.' });
    const query = LocationDescribeQuerySchema.parse({
      type: 'location.describe',
      version: 1,
      queryId: globalThis.crypto.randomUUID(),
      worldInstanceId: current.worldInstanceId,
      characterId: current.characterId,
      payload: {},
    });
    const result = await engine.query(query, worldContext(identity, current));
    if (!result.ok) return res.status(403).json({ message: result.message });
    return res.json({
      player: { id: identity.playerId, displayName: identity.displayName },
      character,
      location: result.value,
    });
  } catch (error) {
    next(error);
  }
});

app.post('/api/commands', async (req, res, next) => {
  try {
    const identity = await accountFor(req, res);
    if (!identity) return;
    const command = req.body as { type?: string; characterId?: string };
    if (command?.type === 'character.create' && !CreateCharacterCommandSchema.safeParse(command).success) {
      return res.status(400).json({ message: 'Invalid character creation command.' });
    } else if (command?.type === 'character.rename' && !RenameCharacterCommandSchema.safeParse(command).success) {
      return res.status(400).json({ message: 'Invalid character rename command.' });
    } else if (command?.type === 'character.archive' && !ArchiveCharacterCommandSchema.safeParse(command).success) {
      return res.status(400).json({ message: 'Invalid character archive command.' });
    } else if (command?.type === 'character.restore' && !RestoreCharacterCommandSchema.safeParse(command).success) {
      return res.status(400).json({ message: 'Invalid character restore command.' });
    }

    let context = identity.session;
    if (command?.type === 'character.archive' && typeof command.characterId === 'string') {
      const current = await activeSession(identity);
      if (current?.characterId === command.characterId) {
        return res.status(409).json({ message: 'Leave the world before archiving this character.' });
      }
    }

    if (!['character.create', 'character.rename', 'character.archive', 'character.restore'].includes(command?.type ?? '')) {
      const current = await activeSession(identity);
      if (!current) return res.status(409).json({ message: 'Enter the world with a character before taking world actions.' });
      if (typeof command?.characterId === 'string' && command.characterId !== current.characterId) {
        return res.status(403).json({ message: 'This world session is bound to a different character.' });
      }
      context = worldContext(identity, current);
    }

    const result = await engine.dispatch(req.body, context);
    return res.json(result);
  } catch (error) {
    next(error);
  }
});

app.post('/api/queries', async (req, res, next) => {
  try {
    const identity = await accountFor(req, res);
    if (!identity) return;
    const locationQuery = LocationDescribeQuerySchema.safeParse(req.body);
    const objectReadQuery = ObjectReadQuerySchema.safeParse(req.body);
    const objectInspectQuery = ObjectInspectQuerySchema.safeParse(req.body);
    let query:
      | z.infer<typeof LocationDescribeQuerySchema>
      | z.infer<typeof ObjectReadQuerySchema>
      | z.infer<typeof ObjectInspectQuerySchema>;
    if (locationQuery.success) query = locationQuery.data;
    else if (objectReadQuery.success) query = objectReadQuery.data;
    else if (objectInspectQuery.success) query = objectInspectQuery.data;
    else return res.status(400).json({ message: 'Invalid world query.' });
    const current = await activeSession(identity);
    if (!current) return res.status(409).json({ message: 'Enter the world with a character before making a query.' });
    if (query.characterId !== current.characterId) {
      return res.status(403).json({ message: 'This world session is bound to a different character.' });
    }
    const result = await engine.query(query, worldContext(identity, current));
    return res.status(result.ok ? 200 : 403).json(result);
  } catch (error) {
    next(error);
  }
});

app.get('/api/health', (_req, res) => res.json({ status: 'ok' }));
app.use((error: unknown, _req: Request, res: Response, _next: express.NextFunction) => {
  console.error('Request failed:', error instanceof Error ? error.message : 'unknown error');
  res.status(500).json({ message: 'The game server could not complete that request.' });
});

const port = Number(process.env.API_PORT ?? 5001);
const server = app.listen(port, '0.0.0.0', () => {
  console.log(`MUDD server listening on ${port}`);
});

async function shutdown() {
  server.close();
  await engine.stop();
  await pool.end();
}
process.on('SIGTERM', () => void shutdown());
process.on('SIGINT', () => void shutdown());
