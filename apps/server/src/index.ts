import express from 'express';
import { and, eq } from 'drizzle-orm';
import { CreateCharacterCommandSchema, LocationDescribeQuerySchema } from '@mudd/contracts';
import { EngineHost } from '@mudd/engine-core';
import { characterPlugin, movementPlugin } from '@mudd/core-plugins';
import { DEMO_WORLD_INSTANCE_ID, demoWorld } from '@mudd/world-demo';
import { db, pool } from './db/client.js';
import { characters } from './db/schema.js';
import { PostgresEventStore } from './persistence/postgres-event-store.js';
import { getGuestIdentity } from './session-service.js';

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
app.use(express.json({ limit: '16kb' }));

app.get('/api/game', async (req, res, next) => {
  try {
    const identity = await getGuestIdentity(req);
    if (identity.cookie) res.setHeader('Set-Cookie', identity.cookie);
    const [characterRow] = await db.select({
      id: characters.id,
      name: characters.name,
      worldInstanceId: characters.worldInstanceId,
    }).from(characters).where(and(
      eq(characters.playerId, identity.playerId),
      eq(characters.worldInstanceId, DEMO_WORLD_INSTANCE_ID),
    )).limit(1);
    if (!characterRow) {
      return res.json({ player: { id: identity.playerId, displayName: identity.displayName } });
    }
    const events = await store.readStream(characterRow.worldInstanceId, characterRow.id);
    const { replayCharacter } = await import('@mudd/engine-core');
    const character = replayCharacter(events);
    if (!character) throw new Error('A character record exists without its creation event.');
    const query = LocationDescribeQuerySchema.parse({
      type: 'location.describe',
      version: 1,
      queryId: globalThis.crypto.randomUUID(),
      worldInstanceId: DEMO_WORLD_INSTANCE_ID,
      characterId: character.characterId,
      payload: {},
    });
    const location = await engine.query(query, identity.session);
    if (!location.ok) throw new Error(location.message);
    return res.json({
      player: { id: identity.playerId, displayName: identity.displayName },
      character,
      location: location.value,
    });
  } catch (error) {
    next(error);
  }
});

app.post('/api/commands', async (req, res, next) => {
  try {
    const identity = await getGuestIdentity(req);
    if (identity.cookie) res.setHeader('Set-Cookie', identity.cookie);
    const command = req.body as { type?: string };
    if (command?.type === 'character.create') {
      const parsed = CreateCharacterCommandSchema.safeParse(command);
      if (!parsed.success) return res.status(400).json({ message: 'Invalid character creation command.' });
      const [existing] = await db.select({ id: characters.id }).from(characters)
        .where(and(
          eq(characters.playerId, identity.playerId),
          eq(characters.worldInstanceId, DEMO_WORLD_INSTANCE_ID),
        )).limit(1);
      if (existing) return res.status(409).json({ message: 'This guest already has a character in the demo world.' });
    }
    const result = await engine.dispatch(req.body, identity.session);
    return res.json(result);
  } catch (error) {
    next(error);
  }
});

app.post('/api/queries', async (req, res, next) => {
  try {
    const identity = await getGuestIdentity(req);
    if (identity.cookie) res.setHeader('Set-Cookie', identity.cookie);
    const query = LocationDescribeQuerySchema.safeParse(req.body);
    if (!query.success) return res.status(400).json({ message: 'Invalid location query.' });
    const result = await engine.query(query.data, identity.session);
    return res.status(result.ok ? 200 : 403).json(result);
  } catch (error) {
    next(error);
  }
});

app.get('/api/health', (_req, res) => res.json({ status: 'ok' }));
app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
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
