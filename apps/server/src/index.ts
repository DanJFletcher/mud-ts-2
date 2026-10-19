import express, { type Request, type Response } from 'express';
import cors from 'cors';
import { getAuth, clerkMiddleware } from '@clerk/express';
import { publishableKeyFromHost } from '@clerk/shared/keys';
import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';
import {
  ArchiveCharacterCommandSchema,
  InitializeCharacterWalletCommandSchema,
  CreateCharacterCommandSchema,
  IdSchema,
  LocationDescribeQuerySchema,
  NpcTalkQuerySchema,
  ObjectReadQuerySchema,
  ObjectInspectQuerySchema,
  RestoreCharacterCommandSchema,
  RenameCharacterCommandSchema,
  MerchantCatalogQuerySchema,
  LocationProjectionSchema,
} from '@mudd/contracts';
import { EngineHost, projectQuestJournal, replayCharacter } from '@mudd/engine-core';
import { characterPlugin, combatPlugin, merchantPlugin, movementPlugin, npcDialoguePlugin } from '@mudd/core-plugins';
import { DEMO_WORLD_INSTANCE_ID, demoWorld } from '@mudd/world-demo';
import { db, pool } from './db/client.js';
import { characters, durableEffects, worldSessions } from './db/schema.js';
import { PostgresEventStore } from './persistence/postgres-event-store.js';
import { listRoomOccupants, touchWorldSessionPresence } from './room-presence-service.js';
import { demoEventEffectsPlugin } from './demo-event-effects-plugin.js';
import { LOCATION_ENTERED_EFFECT } from './durable-effect-contracts.js';
import { projectWorldMap } from './world-map-projection.js';
import { expiredGuestCookie, getAccountIdentity, type AccountIdentity } from './session-service.js';
import { CLERK_PROXY_PATH, clerkProxyMiddleware, getClerkProxyHost } from './middlewares/clerkProxyMiddleware.js';
import {
  createPlayerRoomChatMessage,
  getRoomChatMessageBySourceEffectId,
  listRoomChatMessages,
  MAX_ROOM_CHAT_MESSAGE_LENGTH,
} from './room-chat-service.js';
import {
  createOriginGuard,
  createRateLimiter,
  createRequestId,
  createTrustedHostGuard,
  parseAllowedOrigins,
  parseTrustedHosts,
} from './request-security.js';

const trustedProxyHops = Number(process.env.TRUSTED_PROXY_HOPS ?? (process.env.NODE_ENV === 'production' ? '1' : '0'));
if (!Number.isInteger(trustedProxyHops) || trustedProxyHops < 0) {
  throw new Error('TRUSTED_PROXY_HOPS must be a non-negative integer.');
}
const allowedOrigins = parseAllowedOrigins(
  process.env.CORS_ALLOWED_ORIGINS,
  process.env.NODE_ENV === 'production'
    ? undefined
    : [process.env.REPLIT_DEV_DOMAIN, process.env.REPLIT_DOMAINS].filter(Boolean).join(','),
);
const trustedHosts = parseTrustedHosts(process.env.TRUSTED_HOSTS);
if (process.env.NODE_ENV === 'production' && trustedHosts.size === 0) {
  throw new Error('TRUSTED_HOSTS must be configured before starting the production server.');
}

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
const engine = new EngineHost(
  [characterPlugin, combatPlugin, movementPlugin, npcDialoguePlugin, merchantPlugin, demoEventEffectsPlugin],
  store,
  authorization,
  demoWorld,
);
await engine.start();

let effectBatchRunning = false;
async function runPendingEffectBatch() {
  if (effectBatchRunning) return;
  effectBatchRunning = true;
  try {
    await engine.processPendingEffects();
  } catch {
    console.error('Could not process durable event effects.');
  } finally {
    effectBatchRunning = false;
  }
}
void runPendingEffectBatch();
const effectPoller = setInterval(() => void runPendingEffectBatch(), 1_000);
effectPoller.unref();

const app = express();
app.set('trust proxy', trustedProxyHops);
app.use(createRequestId());
app.use(createTrustedHostGuard(trustedHosts));
app.use(CLERK_PROXY_PATH, clerkProxyMiddleware());
app.use(cors({
  credentials: true,
  origin: (origin, callback) => callback(null, Boolean(origin && allowedOrigins.has(origin))),
}));
app.use(createOriginGuard(allowedOrigins, (diagnostic) => {
  console.warn('Rejected request by origin guard.', diagnostic);
}));
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

async function activeCharacter(identity: AccountIdentity) {
  const session = await activeSession(identity);
  if (!session) return undefined;
  const character = replayCharacter(await store.readStream(session.worldInstanceId, session.characterId));
  if (!character || character.archived) return undefined;
  return { session, character };
}

function worldContext(identity: AccountIdentity, session: typeof worldSessions.$inferSelect) {
  return {
    ...identity.session,
    sessionId: session.id,
    worldInstanceId: session.worldInstanceId,
    selectedCharacterId: session.characterId,
  };
}

async function ensureCharacterWallet(
  identity: AccountIdentity,
  session: typeof worldSessions.$inferSelect,
  character: NonNullable<ReturnType<typeof replayCharacter>>,
) {
  if (
    character.wallet ||
    character.combat?.status === 'defeat' ||
    character.health?.current === 0
  ) return character;
  const command = InitializeCharacterWalletCommandSchema.parse({
    type: 'character.wallet.initialize',
    version: 1,
    commandId: globalThis.crypto.randomUUID(),
    worldInstanceId: session.worldInstanceId,
    characterId: session.characterId,
    expectedVersion: character.revision,
    payload: {},
  });
  await engine.dispatch(command, worldContext(identity, session));
  const initialized = replayCharacter(await store.readStream(session.worldInstanceId, session.characterId));
  if (!initialized?.wallet) throw new Error('Could not initialize the character wallet.');
  return initialized;
}

async function locationWithRoomPresence(
  location: unknown,
  worldInstanceId: string,
  viewerCharacterId: string,
) {
  const projection = LocationProjectionSchema.parse(location);
  const occupants = await listRoomOccupants(
    store,
    worldInstanceId,
    projection.locationId,
    viewerCharacterId,
  );
  return LocationProjectionSchema.parse({ ...projection, occupants });
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
    const characterProjection = replayCharacter(await store.readStream(
      DEMO_WORLD_INSTANCE_ID,
      input.data.characterId,
    ));
    if (characterProjection?.combat?.status === 'defeat' || characterProjection?.health?.current === 0) {
      return res.status(409).json({ message: 'Your character has died. Start a new character to begin again.' });
    }

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
      if (characterProjection && !characterProjection.archived) {
        const effectId = globalThis.crypto.randomUUID();
        await tx.insert(durableEffects).values({
          id: effectId,
          worldInstanceId: DEMO_WORLD_INSTANCE_ID,
          sourceStreamId: character.id,
          causationCommandId: created.id,
          effectType: LOCATION_ENTERED_EFFECT,
          effectVersion: 1,
          payload: {
            characterId: character.id,
            toLocationId: characterProjection.locationId,
          },
          dedupeKey: `world-session:${created.id}`,
        });
      }
      return { kind: 'active' as const, session: created };
    });

    if (result.kind === 'missing') return res.status(404).json({ message: 'That character is unavailable.' });
    if (result.kind === 'occupied') return res.status(409).json({ message: 'Leave the current world session before switching characters.' });
    await runPendingEffectBatch();
    return res.json({ sessionId: result.session.id, characterId: result.session.characterId });
  } catch (error) {
    next(error);
  }
});

app.post('/api/world-session/heartbeat', createRateLimiter({ windowMs: 60_000, maxRequests: 20 }), async (req, res, next) => {
  try {
    const identity = await accountFor(req, res);
    if (!identity) return;
    const current = await activeSession(identity);
    if (!current) return res.status(409).json({ message: 'Enter the world with a character before sending presence.' });

    const character = replayCharacter(await store.readStream(current.worldInstanceId, current.characterId));
    if (!character || character.archived) {
      return res.status(409).json({ message: 'Enter the world with an active character before sending presence.' });
    }
    if (character.combat?.status === 'defeat' || character.health?.current === 0) {
      return res.status(409).json({ message: 'Your character has died. Start a new character to begin again.' });
    }

    const refreshed = await touchWorldSessionPresence(
      identity.playerId,
      current.worldInstanceId,
      current.id,
    );
    if (!refreshed) return res.status(409).json({ message: 'Your world session is no longer active.' });

    return res.json({
      worldInstanceId: current.worldInstanceId,
      locationId: character.locationId,
      occupants: await listRoomOccupants(
        store,
        current.worldInstanceId,
        character.locationId,
        current.characterId,
      ),
    });
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
    const replayedCharacter = replayCharacter(events);
    if (!replayedCharacter || replayedCharacter.archived) {
      return res.status(409).json({ message: 'That character is no longer available.' });
    }
    const character = await ensureCharacterWallet(identity, current, replayedCharacter);
    const query = LocationDescribeQuerySchema.parse({
      type: 'location.describe',
      version: 1,
      queryId: globalThis.crypto.randomUUID(),
      worldInstanceId: current.worldInstanceId,
      characterId: current.characterId,
      payload: {},
    });
    const result = await engine.query(query, worldContext(identity, current), {
      characterProjection: character,
      correlationId: res.locals.requestId,
    });
    if (!result.ok) {
      const status = result.code === 'INTERNAL_ERROR' ? 500 : result.code === 'NOT_FOUND' ? 404 : 403;
      return res.status(status).json({
        message: result.message,
        ...(result.code === 'INTERNAL_ERROR' ? { requestId: result.correlationId ?? res.locals.requestId } : {}),
      });
    }
    const location = await locationWithRoomPresence(
      result.value,
      current.worldInstanceId,
      current.characterId,
    );
    return res.json({
      player: { id: identity.playerId, displayName: identity.displayName },
      character,
      location,
      map: projectWorldMap(character),
      questJournal: projectQuestJournal(character, demoWorld),
    });
  } catch (error) {
    next(error);
  }
});

app.get('/api/chat', async (req, res, next) => {
  try {
    const identity = await accountFor(req, res);
    if (!identity) return;

    const roomId = z.string().trim().min(1).max(120).safeParse(req.query.roomId);
    const parsedAfterId = req.query.afterId === undefined
      ? undefined
      : z.coerce.number().int().nonnegative().safeParse(req.query.afterId);
    if (!roomId.success || (parsedAfterId && !parsedAfterId.success)) {
      return res.status(400).json({ message: 'Invalid room chat request.' });
    }

    const current = await activeCharacter(identity);
    if (!current) return res.status(409).json({ message: 'Enter the world with a character before using room chat.' });
    if (current.character.combat?.status === 'defeat' || current.character.health?.current === 0) {
      return res.status(409).json({ message: 'Your character has died. Start a new character to begin again.' });
    }
    const messages = await listRoomChatMessages({
      worldInstanceId: current.session.worldInstanceId,
      playerId: identity.playerId,
      characterId: current.character.characterId,
      roomId: roomId.data,
      afterId: parsedAfterId?.success ? parsedAfterId.data : undefined,
    });
    if (!messages) return res.status(409).json({ message: 'You have moved to a different room.' });
    return res.json({ roomId: roomId.data, messages });
  } catch (error) {
    next(error);
  }
});

app.post('/api/chat', createRateLimiter({ windowMs: 60_000, maxRequests: 30 }), async (req, res, next) => {
  try {
    const identity = await accountFor(req, res);
    if (!identity) return;

    const input = z.object({
      roomId: z.string().trim().min(1).max(120),
      clientMessageId: IdSchema,
      text: z.string().trim().min(1).max(MAX_ROOM_CHAT_MESSAGE_LENGTH),
    }).strict().safeParse(req.body);
    if (!input.success) {
      return res.status(400).json({ message: `Enter a message up to ${MAX_ROOM_CHAT_MESSAGE_LENGTH} characters.` });
    }

    const current = await activeCharacter(identity);
    if (!current) return res.status(409).json({ message: 'Enter the world with a character before using room chat.' });
    if (current.character.combat?.status === 'defeat' || current.character.health?.current === 0) {
      return res.status(409).json({ message: 'Your character has died. Start a new character to begin again.' });
    }
    if (input.data.roomId !== current.character.locationId) {
      return res.status(409).json({ message: 'You have moved to a different room.' });
    }

    const submission = await createPlayerRoomChatMessage({
      worldInstanceId: current.session.worldInstanceId,
      playerId: identity.playerId,
      roomId: input.data.roomId,
      characterId: current.character.characterId,
      clientMessageId: input.data.clientMessageId,
      text: input.data.text,
    });
    if (submission.kind === 'unavailable') {
      return res.status(409).json({ message: 'You have moved to a different room or left the world.' });
    }
    if (submission.kind === 'conflict') {
      return res.status(409).json({ message: 'This message ID was already used for a different message.' });
    }
    if (submission.effectId) await runPendingEffectBatch();
    const npcMessage = submission.kind === 'created' && submission.effectId
      ? await getRoomChatMessageBySourceEffectId(submission.effectId)
      : undefined;
    return res.status(submission.kind === 'created' ? 201 : 200).json({
      message: submission.message,
      ...(npcMessage ? { npcMessage } : {}),
    });
  } catch (error) {
    next(error);
  }
});

app.post('/api/commands', createRateLimiter({ windowMs: 60_000, maxRequests: 120 }), async (req, res, next) => {
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
      const currentCharacter = replayCharacter(await store.readStream(current.worldInstanceId, current.characterId));
      if (currentCharacter?.combat?.status === 'defeat' || currentCharacter?.health?.current === 0) {
        return res.status(409).json({ message: 'Your character has died. Start a new character to begin again.' });
      }
      context = worldContext(identity, current);
    }

    const result = await engine.dispatch(req.body, context, res.locals.requestId);
    if (result.receipt.ok) await runPendingEffectBatch();
    if (!result.receipt.ok && result.receipt.code === 'INTERNAL_ERROR') {
      return res.status(500).json({
        ...result,
        message: result.receipt.message,
        requestId: res.locals.requestId,
      });
    }
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
    const npcTalkQuery = NpcTalkQuerySchema.safeParse(req.body);
    const merchantCatalogQuery = MerchantCatalogQuerySchema.safeParse(req.body);
    let query:
      | z.infer<typeof LocationDescribeQuerySchema>
      | z.infer<typeof ObjectReadQuerySchema>
      | z.infer<typeof ObjectInspectQuerySchema>
      | z.infer<typeof NpcTalkQuerySchema>
      | z.infer<typeof MerchantCatalogQuerySchema>;
    if (locationQuery.success) query = locationQuery.data;
    else if (objectReadQuery.success) query = objectReadQuery.data;
    else if (objectInspectQuery.success) query = objectInspectQuery.data;
    else if (npcTalkQuery.success) query = npcTalkQuery.data;
    else if (merchantCatalogQuery.success) query = merchantCatalogQuery.data;
    else return res.status(400).json({ message: 'Invalid world query.' });
    const current = await activeSession(identity);
    if (!current) return res.status(409).json({ message: 'Enter the world with a character before making a query.' });
    if (query.characterId !== current.characterId) {
      return res.status(403).json({ message: 'This world session is bound to a different character.' });
    }
    const character = replayCharacter(await store.readStream(current.worldInstanceId, current.characterId));
    if (!character || character.archived) {
      return res.status(409).json({ message: 'Enter the world with an active character before making a query.' });
    }
    if (character.combat?.status === 'defeat' || character.health?.current === 0) {
      return res.status(409).json({ message: 'Your character has died. Start a new character to begin again.' });
    }
    const result = await engine.query(query, worldContext(identity, current), {
      characterProjection: character,
      correlationId: res.locals.requestId,
    });
    if (result.ok && query.type === 'location.describe') {
      const value = await locationWithRoomPresence(
        result.value,
        current.worldInstanceId,
        current.characterId,
      );
      return res.json({ ...result, value });
    }
    const status = result.ok
      ? 200
      : result.code === 'INTERNAL_ERROR'
        ? 500
        : result.code === 'NOT_FOUND'
          ? 404
          : result.code === 'RULE_VIOLATION'
            ? 422
            : 403;
    return res.status(status).json({
      ...result,
      ...(!result.ok && result.code === 'INTERNAL_ERROR'
        ? { requestId: result.correlationId ?? res.locals.requestId }
        : {}),
    });
  } catch (error) {
    next(error);
  }
});

app.get('/api/health', (_req, res) => res.json({ status: 'ok' }));
app.use((error: unknown, _req: Request, res: Response, _next: express.NextFunction) => {
  const requestId = String(res.locals.requestId ?? 'unknown');
  console.error(`[${requestId}] Request failed`, error);
  const status = error && typeof error === 'object' && 'status' in error &&
    typeof error.status === 'number' && error.status >= 400 && error.status <= 599
    ? error.status
    : 500;
  res.status(status).json({
    message: status === 413
      ? 'The request body is too large.'
      : 'The game server could not complete that request.',
    requestId,
  });
});

const port = Number(process.env.API_PORT ?? 5001);
export const server = app.listen(port, '0.0.0.0', () => {
  console.log(`MUDD server listening on ${port}`);
});

async function shutdown() {
  server.close();
  await engine.stop();
  await pool.end();
}
process.on('SIGTERM', () => void shutdown());
process.on('SIGINT', () => void shutdown());
