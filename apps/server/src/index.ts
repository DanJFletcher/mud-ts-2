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
  CharacterStatsQuerySchema,
  IdSchema,
  LocationDescribeQuerySchema,
  NpcTalkQuerySchema,
  ObjectReadQuerySchema,
  ObjectInspectQuerySchema,
  RestoreCharacterCommandSchema,
  RenameCharacterCommandSchema,
  MerchantCatalogQuerySchema,
  LocationProjectionSchema,
  InteractionInboxSchema,
  PvpEncounterProjectionSchema,
  PartyInfoQuerySchema,
  PartyInfoProjectionSchema,
  PartyListQuerySchema,
  PartyQuestJournalQuerySchema,
  TeamCombatInfoQuerySchema,
  TeamCombatInfoProjectionSchema,
  LocationGroupsListQuerySchema,
  locationGroupMembershipsForLocation,
  resolveLocationDisplayName,
  type LocationGroupDefinition,
} from '@mudd/contracts';
import { projectQuestJournal, replayCharacter } from '@mudd/engine-core';
import {
  interactionStreamId,
  mobileNpcDefinitions,
  projectInteractionEvents,
  updateInteractionRequestStatus,
} from '@mudd/core-plugins';
import { DEMO_WORLD_INSTANCE_ID } from '@mudd/world-demo';
import { db, pool } from './db/client.js';
import { characters, durableEffects, worldSessions } from './db/schema.js';
import { PostgresEventStore } from './persistence/postgres-event-store.js';
import { projectLocationWithGroups } from './location-group-projection.js';
import { listRoomOccupants, touchWorldSessionPresence } from './room-presence-service.js';
import { createAutonomousNpcScheduler } from './autonomous-npc-scheduler.js';
import { LOCATION_ENTERED_EFFECT } from './durable-effect-contracts.js';
import { shouldInitializeCharacterWallet } from './world-wallet-policy.js';
import { projectWorldMap } from './world-map-projection.js';
import {
  createGuestIdentity,
  expiredGuestCookie,
  getAccountIdentity,
  type AccountIdentity,
} from './session-service.js';
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
import {
  createWorldRuntimes,
  registeredWorlds,
  startWorldRuntimes,
  stopWorldRuntimes,
  toWorldSummary,
  type WorldRuntime,
} from './world-registry.js';

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
const registeredWorldIds = new Set(registeredWorlds.map((world) => world.worldInstanceId));
const authorization = {
  async canAccessInstance(session: { worldInstanceId: string }, id: string) {
    return session.worldInstanceId === id && registeredWorldIds.has(id);
  },
  async ownsCharacter(session: { playerId: string }, id: string) {
    const [row] = await db.select({ id: characters.id }).from(characters)
      .where(and(eq(characters.id, id), eq(characters.playerId, session.playerId)))
      .limit(1);
    return Boolean(row);
  },
};
const worldRuntimes = createWorldRuntimes(store, authorization);
await startWorldRuntimes(worldRuntimes);
function runtimeFor(worldInstanceId: string): WorldRuntime {
  const runtime = worldRuntimes.get(worldInstanceId);
  if (!runtime) throw new Error(`No world is registered for instance ${worldInstanceId}.`);
  return runtime;
}

const autonomousNpcSchedulers = [...worldRuntimes.values()]
  .filter((runtime) => mobileNpcDefinitions(runtime.world).length > 0)
  .map((runtime) => createAutonomousNpcScheduler({
    engine: runtime.engine,
    store,
    world: runtime.world,
    worldInstanceId: runtime.worldInstanceId,
    onError(error, npcId) {
      console.error(
        `Could not run autonomous movement for NPC ${npcId} in world ${runtime.worldInstanceId}.`,
        error,
      );
    },
  }));
for (const scheduler of autonomousNpcSchedulers) scheduler.start();

let effectBatchRunning = false;
async function runPendingEffectBatch() {
  if (effectBatchRunning) return;
  effectBatchRunning = true;
  try {
    for (const runtime of worldRuntimes.values()) {
      await runtime.engine.processPendingEffects(25, runtime.worldInstanceId);
    }
  } catch {
    console.error('Could not process durable event effects.');
  } finally {
    effectBatchRunning = false;
  }
}
void runPendingEffectBatch();
const effectPoller = setInterval(() => void runPendingEffectBatch(), 1_000);
effectPoller.unref();

let interactionMaintenanceRunning = false;
const INTERACTION_HEARTBEAT_FRESH_MS = 45_000;
async function runInteractionMaintenance() {
  if (interactionMaintenanceRunning) return;
  interactionMaintenanceRunning = true;
  try {
    for (const runtime of worldRuntimes.values()) {
      const worldInstanceId = runtime.worldInstanceId;
      const events = await store.readStream(worldInstanceId, interactionStreamId(worldInstanceId));
      const { requests } = projectInteractionEvents(events);
      const sessions = await db.select({
        characterId: worldSessions.characterId,
        lastSeenAt: worldSessions.lastSeenAt,
      }).from(worldSessions).where(eq(worldSessions.worldInstanceId, worldInstanceId));
      const online = new Set(sessions
        .filter((session) => Date.now() - session.lastSeenAt.getTime() <= INTERACTION_HEARTBEAT_FRESH_MS)
        .map((session) => session.characterId));
      const now = Date.now();
      for (const request of requests) {
        if (request.status !== 'pending') continue;
        if (Date.parse(request.expiresAt) <= now) {
          await updateInteractionRequestStatus(store, worldInstanceId, request.requestId, 'expired');
        } else if (
          !online.has(request.initiatorCharacterId) ||
          !online.has(request.recipientCharacterId)
        ) {
          await updateInteractionRequestStatus(store, worldInstanceId, request.requestId, 'cancelled');
        }
      }
    }
  } catch {
    console.error('Could not process pending player interaction requests.');
  } finally {
    interactionMaintenanceRunning = false;
  }
}
void runInteractionMaintenance();
const interactionPoller = setInterval(() => void runInteractionMaintenance(), 2_000);
interactionPoller.unref();

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
app.use('/api', (req, res, next) => {
  const requestedWorldId = req.get('x-mudd-world-instance') || DEMO_WORLD_INSTANCE_ID;
  const runtime = worldRuntimes.get(requestedWorldId);
  if (!runtime) return res.status(404).json({ message: 'That world is not available.' });
  res.locals.worldRuntime = runtime;
  res.locals.worldInstanceId = runtime.worldInstanceId;
  return next();
});
app.use(clerkMiddleware((req) => ({
  publishableKey: publishableKeyFromHost(getClerkProxyHost(req) ?? '', process.env.CLERK_PUBLISHABLE_KEY),
})));

async function accountFor(request: Request, response: Response): Promise<AccountIdentity | undefined> {
  const auth = getAuth(request);
  const identity = await getAccountIdentity(request, { userId: auth.userId, sessionId: auth.sessionId });
  if (!identity) {
    response.status(401).json({ message: 'Start a guest session or sign in to access your characters.' });
    return undefined;
  }
  if (identity.clearGuestCookie) response.setHeader('Set-Cookie', expiredGuestCookie);
  return identity;
}

app.post('/api/guest-session', createRateLimiter({ windowMs: 60_000, maxRequests: 10 }), async (req, res, next) => {
  try {
    if (getAuth(req).userId) {
      return res.status(409).json({ message: 'Sign out before starting a guest session.' });
    }
    const { identity, setCookie } = await createGuestIdentity(req);
    if (setCookie) res.setHeader('Set-Cookie', setCookie);
    return res.json({ player: { id: identity.playerId, displayName: identity.displayName } });
  } catch (error) {
    next(error);
  }
});

function selectedRuntime(response: Response): WorldRuntime {
  const runtime = response.locals.worldRuntime as WorldRuntime | undefined;
  if (!runtime) throw new Error('The selected world is not available.');
  return runtime;
}

async function activeSession(identity: AccountIdentity, worldInstanceId: string) {
  const [session] = await db.select().from(worldSessions).where(and(
    eq(worldSessions.playerId, identity.playerId),
    eq(worldSessions.worldInstanceId, worldInstanceId),
  )).limit(1);
  return session;
}

async function activeCharacter(identity: AccountIdentity, worldInstanceId: string) {
  const session = await activeSession(identity, worldInstanceId);
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
  const runtime = runtimeFor(session.worldInstanceId);
  if (!shouldInitializeCharacterWallet(runtime.world, character)) return character;
  const command = InitializeCharacterWalletCommandSchema.parse({
    type: 'character.wallet.initialize',
    version: 1,
    commandId: globalThis.crypto.randomUUID(),
    worldInstanceId: session.worldInstanceId,
    characterId: session.characterId,
    expectedVersion: character.revision,
    payload: {},
  });
  await runtime.engine.dispatch(command, worldContext(identity, session));
  const initialized = replayCharacter(await store.readStream(session.worldInstanceId, session.characterId));
  if (!initialized?.wallet) throw new Error('Could not initialize the character wallet.');
  return initialized;
}

async function locationWithRoomPresence(
  location: unknown,
  worldInstanceId: string,
  viewerCharacterId: string,
  locationGroups: readonly LocationGroupDefinition[],
) {
  const projection = projectLocationWithGroups(LocationProjectionSchema.parse(location), locationGroups);
  const occupants = await listRoomOccupants(
    store,
    worldInstanceId,
    projection.locationId,
    viewerCharacterId,
  );
  return LocationProjectionSchema.parse({ ...projection, occupants });
}

app.get('/api/worlds', (_req, res) => {
  return res.json(registeredWorlds.map(toWorldSummary));
});

app.get('/api/characters', async (req, res, next) => {
  try {
    const identity = await accountFor(req, res);
    if (!identity) return;
    const selected = selectedRuntime(res);
    const rows = await db.select({
      id: characters.id,
      worldInstanceId: characters.worldInstanceId,
    }).from(characters).where(eq(characters.playerId, identity.playerId))
      .orderBy(desc(characters.createdAt));
    const characterList = await Promise.all(rows.map(async (row) => {
      const projection = replayCharacter(await store.readStream(row.worldInstanceId, row.id));
      if (!projection) throw new Error('A character record exists without its creation event.');
      const runtime = runtimeFor(row.worldInstanceId);
      const locationGroupCatalog = await runtime.locationGroupsFeature.catalog.read();
      const location = runtime.world.locations.find((item) => item.id === projection.locationId);
      const locationGroups = locationGroupMembershipsForLocation(
        locationGroupCatalog.groups,
        projection.locationId,
      );
      const locationName = resolveLocationDisplayName(
        location?.name ?? projection.locationId,
        locationGroups,
      );
      return {
        ...projection,
        locationTitle: locationName.qualifiedName,
        worldName: runtime.world.displayName,
      };
    }));
    const activeSessions = await db.select().from(worldSessions)
      .where(eq(worldSessions.playerId, identity.playerId));
    const selectedSession = activeSessions.find((session) => session.worldInstanceId === selected.worldInstanceId);
    return res.json({
      player: { id: identity.playerId, displayName: identity.displayName },
      characters: characterList,
      activeWorldSession: selectedSession
        ? { id: selectedSession.id, characterId: selectedSession.characterId }
        : null,
      activeWorldSessions: activeSessions.map((session) => ({
        worldInstanceId: session.worldInstanceId,
        id: session.id,
        characterId: session.characterId,
      })),
    });
  } catch (error) {
    next(error);
  }
});

app.post('/api/world-session', async (req, res, next) => {
  try {
    const identity = await accountFor(req, res);
    if (!identity) return;
    const selected = selectedRuntime(res);
    const input = z.object({
      characterId: IdSchema,
      worldInstanceId: z.string().min(1).optional(),
    }).strict().safeParse(req.body);
    if (!input.success) return res.status(400).json({ message: 'Choose a valid character.' });
    const worldInstanceId = input.data.worldInstanceId ?? selected.worldInstanceId;
    if (worldInstanceId !== selected.worldInstanceId) {
      return res.status(400).json({ message: 'Choose a character from the selected world.' });
    }
    const characterProjection = replayCharacter(await store.readStream(
      worldInstanceId,
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
        eq(characters.worldInstanceId, worldInstanceId),
        isNull(characters.archivedAt),
      )).limit(1);
      if (!character) return { kind: 'missing' as const };

      const [current] = await tx.select().from(worldSessions).where(and(
        eq(worldSessions.playerId, identity.playerId),
        eq(worldSessions.worldInstanceId, worldInstanceId),
      )).limit(1);
      if (current) {
        return current.characterId === character.id
          ? { kind: 'active' as const, session: current }
          : { kind: 'occupied' as const };
      }

      const [created] = await tx.insert(worldSessions).values({
        id: globalThis.crypto.randomUUID(),
        playerId: identity.playerId,
        worldInstanceId,
        characterId: character.id,
      }).returning();
      if (!created) throw new Error('Could not start the world session.');
      if (characterProjection && !characterProjection.archived) {
        const effectId = globalThis.crypto.randomUUID();
        await tx.insert(durableEffects).values({
          id: effectId,
          worldInstanceId,
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
    const selected = selectedRuntime(res);
    const current = await activeSession(identity, selected.worldInstanceId);
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
    const selected = selectedRuntime(res);
    await db.delete(worldSessions).where(and(
      eq(worldSessions.playerId, identity.playerId),
      eq(worldSessions.worldInstanceId, selected.worldInstanceId),
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
    const selected = selectedRuntime(res);
    const current = await activeSession(identity, selected.worldInstanceId);
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
    const result = await selected.engine.query(query, worldContext(identity, current), {
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
    const locationGroupCatalog = await selected.locationGroupsFeature.catalog.read();
    const location = await locationWithRoomPresence(
      result.value,
      current.worldInstanceId,
      current.characterId,
      locationGroupCatalog.groups,
    );
    const statsQuery = CharacterStatsQuerySchema.parse({
      type: 'character.stats',
      version: 1,
      queryId: globalThis.crypto.randomUUID(),
      worldInstanceId: current.worldInstanceId,
      characterId: current.characterId,
      payload: {},
    });
    const statsResult = await selected.engine.query(statsQuery, worldContext(identity, current), {
      characterProjection: character,
      correlationId: res.locals.requestId,
    });
    if (!statsResult.ok) {
      const status = statsResult.code === 'INTERNAL_ERROR' ? 500 : statsResult.code === 'NOT_FOUND' ? 404 : 403;
      return res.status(status).json({
        message: statsResult.message,
        ...(statsResult.code === 'INTERNAL_ERROR' ? { requestId: statsResult.correlationId ?? res.locals.requestId } : {}),
      });
    }
    return res.json({
      player: { id: identity.playerId, displayName: identity.displayName },
      character,
      stats: statsResult.value,
      ...(selected.world.currency
        ? {
          currency: {
            id: selected.world.currency.id,
            name: selected.world.currency.name,
            symbol: selected.world.currency.symbol,
          },
        }
        : {}),
      location,
      map: projectWorldMap(character, selected.world, locationGroupCatalog.groups),
      questJournal: projectQuestJournal(character, selected.world),
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

    const current = await activeCharacter(identity, selectedRuntime(res).worldInstanceId);
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
    return res.json({
      roomId: roomId.data,
      messages: messages.messages,
      terminalEvents: messages.terminalEvents,
      cursor: messages.cursor,
    });
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

    const current = await activeCharacter(identity, selectedRuntime(res).worldInstanceId);
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

app.get('/api/interactions', async (req, res, next) => {
  try {
    const identity = await accountFor(req, res);
    if (!identity) return;
    const current = await activeCharacter(identity, selectedRuntime(res).worldInstanceId);
    if (!current) return res.status(409).json({ message: 'Enter the world with a character before checking interactions.' });
    const events = await store.readStream(current.session.worldInstanceId, interactionStreamId(current.session.worldInstanceId));
    const projected = projectInteractionEvents(events);
    const characterId = current.character.characterId;
    const requests = projected.requests
      .filter((request) =>
        request.initiatorCharacterId === characterId ||
        request.recipientCharacterId === characterId)
      .slice(-30);
    const eventEncounter = projected.latestEncounterEvent?.payload.encounter;
    const parsedEncounter = PvpEncounterProjectionSchema.safeParse(eventEncounter);
    const encounter = parsedEncounter.success &&
      parsedEncounter.data.participants.some((participant) => participant.characterId === characterId)
      ? parsedEncounter.data
      : null;
    return res.json(InteractionInboxSchema.parse({ requests, encounter }));
  } catch (error) {
    next(error);
  }
});

app.post('/api/commands', createRateLimiter({ windowMs: 60_000, maxRequests: 120 }), async (req, res, next) => {
  try {
    const identity = await accountFor(req, res);
    if (!identity) return;
    const selected = selectedRuntime(res);
    const command = req.body as { type?: string; characterId?: string };
    const commandWorldInstanceId = (req.body as { worldInstanceId?: unknown } | null)?.worldInstanceId;
    if (typeof commandWorldInstanceId === 'string' && commandWorldInstanceId !== selected.worldInstanceId) {
      return res.status(400).json({ message: 'Choose a command for the selected world.' });
    }
    if (command?.type === 'character.create' && !CreateCharacterCommandSchema.safeParse(command).success) {
      return res.status(400).json({ message: 'Invalid character creation command.' });
    } else if (command?.type === 'character.rename' && !RenameCharacterCommandSchema.safeParse(command).success) {
      return res.status(400).json({ message: 'Invalid character rename command.' });
    } else if (command?.type === 'character.archive' && !ArchiveCharacterCommandSchema.safeParse(command).success) {
      return res.status(400).json({ message: 'Invalid character archive command.' });
    } else if (command?.type === 'character.restore' && !RestoreCharacterCommandSchema.safeParse(command).success) {
      return res.status(400).json({ message: 'Invalid character restore command.' });
    }

    let context = { ...identity.session, worldInstanceId: selected.worldInstanceId };
    if (command?.type === 'character.archive' && typeof command.characterId === 'string') {
      const current = await activeSession(identity, selected.worldInstanceId);
      if (current?.characterId === command.characterId) {
        return res.status(409).json({ message: 'Leave the world before archiving this character.' });
      }
    }

    const characterCommand = ['character.create', 'character.rename', 'character.archive', 'character.restore']
      .includes(command?.type ?? '');
    if (characterCommand && command?.type !== 'character.create' && typeof command.characterId === 'string') {
      const [ownedCharacter] = await db.select({ id: characters.id }).from(characters).where(and(
        eq(characters.id, command.characterId),
        eq(characters.playerId, identity.playerId),
        eq(characters.worldInstanceId, selected.worldInstanceId),
      )).limit(1);
      if (!ownedCharacter) return res.status(404).json({ message: 'That character does not belong to this world.' });
    }

    if (!characterCommand) {
      const current = await activeSession(identity, selected.worldInstanceId);
      if (!current) return res.status(409).json({ message: 'Enter the world with a character before taking world actions.' });
      if (typeof command?.characterId === 'string' && command.characterId !== current.characterId) {
        return res.status(403).json({ message: 'This world session is bound to a different character.' });
      }
      const currentCharacter = replayCharacter(await store.readStream(current.worldInstanceId, current.characterId));
      if (currentCharacter?.combat?.status === 'defeat' || currentCharacter?.health?.current === 0) {
        return res.status(409).json({ message: 'Your character has died. Start a new character to begin again.' });
      }
      const interactionEvents = await store.readStream(
        current.worldInstanceId,
        interactionStreamId(current.worldInstanceId),
      );
      const latestInteraction = projectInteractionEvents(interactionEvents).latestEncounterEvent;
      const latestEncounter = PvpEncounterProjectionSchema.safeParse(latestInteraction?.payload.encounter);
      const characterInPvp = latestEncounter.success &&
        latestEncounter.data.status !== 'completed' &&
        latestEncounter.data.participants.some((participant) => participant.characterId === current.characterId);
      if (characterInPvp && command.type !== 'pvp.action') {
        return res.status(409).json({ message: 'Only combat actions are available during a PvP encounter.' });
      }
      if (!characterInPvp && command.type === 'pvp.action') {
        return res.status(409).json({ message: 'There is no active PvP encounter for this character.' });
      }
      const combatPayload = (req.body as { payload?: { action?: unknown; targetNpcId?: unknown } }).payload;
      if (
        command.type === 'combat.action' &&
        combatPayload?.action === 'attack' &&
        typeof combatPayload.targetNpcId === 'string'
      ) {
        const partyInfo = await selected.engine.query({
          type: 'party.info',
          version: 1,
          queryId: `combat-party-guard:${res.locals.requestId}`,
          worldInstanceId: current.worldInstanceId,
          characterId: current.characterId,
          payload: {},
        }, worldContext(identity, current));
        const parsedPartyInfo = partyInfo.ok
          ? PartyInfoProjectionSchema.safeParse(partyInfo.value)
          : undefined;
        if (!parsedPartyInfo?.success) {
          return res.status(500).json({ message: 'The party status could not be checked before combat.' });
        }
        if (parsedPartyInfo.data.party) {
          return res.status(409).json({ message: 'Use the cooperative encounter controls to begin combat with your party.' });
        }
      }
      const teamCombatInfo = await selected.engine.query({
        type: 'team.combat.info',
        version: 1,
        queryId: `guard:${res.locals.requestId}`,
        worldInstanceId: current.worldInstanceId,
        characterId: current.characterId,
        payload: {},
      }, worldContext(identity, current));
      const parsedTeamCombatInfo = teamCombatInfo.ok
        ? TeamCombatInfoProjectionSchema.safeParse(teamCombatInfo.value)
        : undefined;
      if (!parsedTeamCombatInfo?.success) {
        return res.status(500).json({ message: 'The team combat state could not be checked.' });
      }
      const teamEncounter = parsedTeamCombatInfo.data.encounter;
      const characterInTeamCombat = teamEncounter?.status === 'active' &&
        teamEncounter.participants.some((participant) =>
          participant.kind === 'player' &&
          participant.characterId === current.characterId &&
          participant.status === 'active',
        );
      const mayChangePartyRosterDuringEncounter =
        command.type === 'party.leave' || command.type === 'party.close';
      if (
        characterInTeamCombat &&
        command.type !== 'team.combat.action' &&
        !mayChangePartyRosterDuringEncounter
      ) {
        return res.status(409).json({ message: 'Only combat actions are available during a team encounter.' });
      }
      if (!characterInTeamCombat && command.type === 'team.combat.action') {
        return res.status(409).json({ message: 'There is no active team encounter for this character.' });
      }
      if (command.type === 'interaction.request') {
        const recipientCharacterId = (req.body as { payload?: { recipientCharacterId?: unknown } }).payload?.recipientCharacterId;
        if (typeof recipientCharacterId !== 'string') {
          return res.status(400).json({ message: 'Choose a player to challenge.' });
        }
        const [recipientSession] = await db.select({
          characterId: worldSessions.characterId,
          lastSeenAt: worldSessions.lastSeenAt,
        }).from(worldSessions).where(and(
          eq(worldSessions.worldInstanceId, current.worldInstanceId),
          eq(worldSessions.characterId, recipientCharacterId),
        )).limit(1);
        if (!recipientSession || Date.now() - recipientSession.lastSeenAt.getTime() > INTERACTION_HEARTBEAT_FRESH_MS) {
          return res.status(409).json({ message: 'That player is not online right now.' });
        }
      }
      context = worldContext(identity, current);
    }

    const result = await selected.engine.dispatch(req.body, context, res.locals.requestId);
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
    const partyListQuery = PartyListQuerySchema.safeParse(req.body);
    const partyInfoQuery = PartyInfoQuerySchema.safeParse(req.body);
    const partyQuestsQuery = PartyQuestJournalQuerySchema.safeParse(req.body);
    const teamCombatInfoQuery = TeamCombatInfoQuerySchema.safeParse(req.body);
    const locationGroupsQuery = LocationGroupsListQuerySchema.safeParse(req.body);
    let query:
      | z.infer<typeof LocationDescribeQuerySchema>
      | z.infer<typeof ObjectReadQuerySchema>
      | z.infer<typeof ObjectInspectQuerySchema>
      | z.infer<typeof NpcTalkQuerySchema>
      | z.infer<typeof MerchantCatalogQuerySchema>
      | z.infer<typeof PartyListQuerySchema>
      | z.infer<typeof PartyInfoQuerySchema>
      | z.infer<typeof PartyQuestJournalQuerySchema>
      | z.infer<typeof TeamCombatInfoQuerySchema>
      | z.infer<typeof LocationGroupsListQuerySchema>;
    if (locationQuery.success) query = locationQuery.data;
    else if (objectReadQuery.success) query = objectReadQuery.data;
    else if (objectInspectQuery.success) query = objectInspectQuery.data;
    else if (npcTalkQuery.success) query = npcTalkQuery.data;
    else if (merchantCatalogQuery.success) query = merchantCatalogQuery.data;
    else if (partyListQuery.success) query = partyListQuery.data;
    else if (partyInfoQuery.success) query = partyInfoQuery.data;
    else if (partyQuestsQuery.success) query = partyQuestsQuery.data;
    else if (teamCombatInfoQuery.success) query = teamCombatInfoQuery.data;
    else if (locationGroupsQuery.success) query = locationGroupsQuery.data;
    else return res.status(400).json({ message: 'Invalid world query.' });
    const selected = selectedRuntime(res);
    const current = await activeSession(identity, selected.worldInstanceId);
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
    const result = await selected.engine.query(query, worldContext(identity, current), {
      characterProjection: character,
      correlationId: res.locals.requestId,
    });
    if (result.ok && query.type === 'location.describe') {
      const locationGroupCatalog = await selected.locationGroupsFeature.catalog.read();
      const value = await locationWithRoomPresence(
        result.value,
        current.worldInstanceId,
        current.characterId,
        locationGroupCatalog.groups,
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
  for (const scheduler of autonomousNpcSchedulers) scheduler.stop();
  await stopWorldRuntimes(worldRuntimes);
  await pool.end();
}
process.on('SIGTERM', () => void shutdown());
process.on('SIGINT', () => void shutdown());
