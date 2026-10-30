import express, { type Request, type Response } from 'express';
import expressWs from 'express-ws';
import { createRealtimeGateway } from './realtime-gateway.js';
import { startRealtimeNotifications } from './realtime-notifications.js';
import {
  requestMeasurements,
  newMeasurements,
  measureStage,
  measureDatabaseOperation,
  formatDatabaseOperationTimings,
  eventLoopDelayMs,
} from './performance.js';
import cors from 'cors';
import { getAuth, clerkMiddleware } from '@clerk/express';
import { publishableKeyFromHost } from '@clerk/shared/keys';
import { and, desc, eq, gte, sql } from 'drizzle-orm';
import { z } from 'zod';
import {
  ArchiveCharacterCommandSchema,
  COMMAND_PROJECTION_HEADER,
  GAME_COMMAND_PROJECTION,
  InitializeCharacterWalletCommandSchema,
  CreateCharacterCommandSchema,
  CharacterStatsQuerySchema,
  IdSchema,
  LocationDescribeQuerySchema,
  RestoreCharacterCommandSchema,
  RenameCharacterCommandSchema,
  LocationProjectionSchema,
  MovementResultProjectionSchema,
  InteractionInboxSchema,
  PvpEncounterProjectionSchema,
  PartyInfoProjectionSchema,
  REALTIME_PROTOCOL_VERSION,
  TeamCombatInfoProjectionSchema,
  locationGroupMembershipsForLocation,
  resolveLocationDisplayName,
  type LocationGroupDefinition,
  type SessionContext,
} from '@mudd/contracts';
import { WorldQuerySchema } from './world-query-schema.js';
import { installProductionWebServing } from './web-serving.js';
import {
  projectQuestJournal,
  replayCharacter as reconstructCharacter,
  SYSTEM_ACTOR_ID,
  type DispatchResult,
} from '@mudd/engine-core';
import {
  interactionStreamId,
  mobileNpcDefinitions,
  projectInteractionEvents,
  projectCharacterInteractions,
  updateInteractionRequestStatus,
  WOODCUTTING_TREES_STREAM_ID,
  projectWoodcuttingTreePresence,
} from '@mudd/core-plugins';
import { DEMO_WORLD_INSTANCE_ID } from '@mudd/world-demo';
import { db, pool, warmDatabasePool } from './db/client.js';
import { characters, worldSessions, roomChatMessages } from './db/schema.js';
import { PostgresEventStore } from './persistence/postgres-event-store.js';
import { projectLocationWithGroups } from './location-group-projection.js';
import { listRoomOccupants, touchWorldSessionPresence } from './room-presence-service.js';
import { createAutonomousNpcScheduler } from './autonomous-npc-scheduler.js';
import { createStaminaRecoveryScheduler } from './stamina-recovery-scheduler.js';
import { createObjectLifecycleScheduler } from './object-lifecycle-scheduler.js';
import { enterWorld } from './world-entry.js';
import { shouldInitializeCharacterWallet } from './world-wallet-policy.js';
import { projectWorldMap } from './world-map-projection.js';
import { projectWoodcuttingRoom } from './woodcutting-room-projection.js';
import {
  createGuestIdentity,
  expiredGuestCookie,
  getAccountIdentity,
  type AccountIdentity,
} from './session-service.js';
import { createCharacterOwnershipCheck } from './character-authorization.js';
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
} from './request-security.js';
import { readServerConfiguration } from './server-config.js';
import {
  createWorldRuntimes,
  registeredWorlds,
  startWorldRuntimes,
  stopWorldRuntimes,
  toWorldSummary,
  type WorldRuntime,
} from './world-registry.js';

const { trustedProxyHops, allowedOrigins, trustedHosts } = readServerConfiguration(process.env);

await warmDatabasePool();
const store = new PostgresEventStore();
await store.rebuildRoomStates();
function replayCharacter(events: Parameters<typeof reconstructCharacter>[0]) {
  const started = performance.now();
  try { return reconstructCharacter(events); }
  finally {
    const metrics = requestMeasurements.getStore();
    if (metrics) metrics.stages.characterReplay =
      (metrics.stages.characterReplay ?? 0) + performance.now() - started;
  }
}
const registeredWorldIds = new Set(registeredWorlds.map((world) => world.worldInstanceId));
const authorization = {
  async canAccessInstance(session: { worldInstanceId: string }, id: string) {
    return session.worldInstanceId === id && registeredWorldIds.has(id);
  },
  ownsCharacter: createCharacterOwnershipCheck(async (playerId, id) => {
    const [row] = await measureDatabaseOperation('character.ownership_lookup', () =>
      db.select({ id: characters.id }).from(characters)
        .where(and(eq(characters.id, id), eq(characters.playerId, playerId)))
        .limit(1));
    return Boolean(row);
  }),
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

const staminaRecoverySchedulers = [...worldRuntimes.values()].map((runtime) =>
  createStaminaRecoveryScheduler({
    engine: runtime.engine,
    store,
    worldInstanceId: runtime.worldInstanceId,
    listSessions: async (activeSince) => {
      const sessions = await db.select({
        characterId: worldSessions.characterId,
        lastSeenAt: worldSessions.lastSeenAt,
      }).from(worldSessions).where(and(
        eq(worldSessions.worldInstanceId, runtime.worldInstanceId),
        ...(activeSince ? [gte(worldSessions.lastSeenAt, activeSince)] : []),
      ));
      return sessions;
    },
    onError(error, characterId) {
      console.error(`Could not settle vitals for character ${characterId} in ${runtime.worldInstanceId}.`, error);
    },
  }),
);
for (const scheduler of staminaRecoverySchedulers) scheduler.start();
const objectLifecycleScheduler = createObjectLifecycleScheduler({
  runtimes: [...worldRuntimes.values()],
  store,
  onError(error, worldInstanceId, objectId) {
    console.error(
      `Could not expire world object${objectId ? ` ${objectId}` : ''} in ${worldInstanceId}.`,
      error,
    );
  },
});

async function resetStaminaRecoveryAnchor(runtime: WorldRuntime, characterId: string) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const character = replayCharacter(await store.readStream(runtime.worldInstanceId, characterId));
    if (!character || character.archived || character.health?.current === 0) return false;
    const result = await runtime.engine.dispatchSystem({
      type: 'character.stamina.recover',
      version: 1,
      commandId: `stamina-reconnect:${character.characterId}:${character.revision}`,
      worldInstanceId: runtime.worldInstanceId,
      characterId: character.characterId,
      expectedVersion: character.revision,
      payload: { settleAt: new Date().toISOString(), resetAnchor: true },
    }, SYSTEM_ACTOR_ID);
    if (result.receipt.ok) return true;
    if (result.receipt.code !== 'VERSION_CONFLICT') {
      throw new Error(result.receipt.message);
    }
  }
  throw new Error('Could not safely reset the stamina recovery anchor.');
}

const EFFECT_BATCH_LIMIT = 25;
const MAX_EFFECT_BATCH_PASSES = 8;
const runningEffectBatches = new Set<string>();
const requestedEffectBatches = new Set<string>();
async function runWorldEffectBatch(runtime: WorldRuntime) {
  const worldInstanceId = runtime.worldInstanceId;
  if (runningEffectBatches.has(worldInstanceId)) {
    // Don't overlap batches for a world; the running one repeats once it finishes.
    requestedEffectBatches.add(worldInstanceId);
    return;
  }
  runningEffectBatches.add(worldInstanceId);
  try {
    for (let pass = 0; pass < MAX_EFFECT_BATCH_PASSES; pass += 1) {
      requestedEffectBatches.delete(worldInstanceId);
      const processed = await measureDatabaseOperation('effect_batch.process_pending', () =>
        runtime.engine.processPendingEffects(EFFECT_BATCH_LIMIT, worldInstanceId));
      if (!requestedEffectBatches.has(worldInstanceId) && !(processed >= EFFECT_BATCH_LIMIT)) break;
    }
  } catch {
    console.error('Could not process durable event effects.');
  } finally {
    runningEffectBatches.delete(worldInstanceId);
  }
}
/** Process due effects for one world, or for every world when none is given. */
async function runPendingEffectBatch(worldInstanceId?: string) {
  return store.withoutCommandReadCache(async () => {
    const runtimes = worldInstanceId === undefined
      ? [...worldRuntimes.values()]
      : [worldRuntimes.get(worldInstanceId)].filter((runtime): runtime is WorldRuntime => Boolean(runtime));
    await Promise.all(runtimes.map((runtime) => runWorldEffectBatch(runtime)));
  });
}
// Every commit already wakes this process through LISTEN, so newly queued
// effects run promptly without polling each world every second. The slower
// poll remains for delayed retries and missed notifications.
const EFFECT_WAKEUP_DEBOUNCE_MS = 50;
const effectWakeups = new Map<string, ReturnType<typeof setTimeout>>();
function wakeEffectBatch(worldInstanceId: unknown) {
  if (typeof worldInstanceId !== 'string' || !worldRuntimes.has(worldInstanceId)) return;
  if (effectWakeups.has(worldInstanceId)) return;
  const timer = setTimeout(() => {
    effectWakeups.delete(worldInstanceId);
    void runPendingEffectBatch(worldInstanceId);
  }, EFFECT_WAKEUP_DEBOUNCE_MS);
  timer.unref();
  effectWakeups.set(worldInstanceId, timer);
}
void runPendingEffectBatch();
const effectPoller = setInterval(() => void runPendingEffectBatch(), 5_000);
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
const websocketApp = expressWs(app, undefined, { wsOptions: { maxPayload: 1024 } }).app;
app.set('trust proxy', trustedProxyHops);
app.use(createRequestId());
app.use((req, res, next) => {
  const requestedTraceId = req.get('x-mudd-trace-id') ?? '';
  const tracePhase = req.get('x-mudd-trace-phase');
  const traceableRoute =
    (req.method === 'POST' && req.path === '/api/commands' && tracePhase === 'command') ||
    (req.method === 'GET' && req.path === '/api/game' && tracePhase === 'snapshot') ||
    (req.method === 'GET' && req.path === '/api/characters' && tracePhase === 'characters') ||
    (req.method === 'POST' && req.path === '/api/world-session/heartbeat' && tracePhase === 'heartbeat');
  const traceId = traceableRoute && /^[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/i.test(requestedTraceId)
    ? requestedTraceId
    : undefined;
  const measurements = newMeasurements(traceId);
  if (traceId) res.setHeader('x-mudd-trace-id', traceId);
  const startedAt = performance.now();
  const json = res.json.bind(res);
  res.json = ((body: unknown) => {
    const started = performance.now();
    try { return json(body); }
    finally { measurements.stages.responseSerialization = performance.now() - started; }
  }) as typeof res.json;
  res.once('finish', () => {
    const durationMs = performance.now() - startedAt;
    if (durationMs < 250 && !traceId) return;
    const databaseOperations = formatDatabaseOperationTimings(measurements);
    const loggedMeasurements = {
      stages: measurements.stages,
      queries: measurements.queries,
      poolWaitMs: measurements.poolWaitMs,
      queryMs: measurements.queryMs,
      connectionsOpened: measurements.connectionsOpened,
      ...(databaseOperations.length > 0 ? { databaseOperations } : {}),
      ...(traceId ? { queryTimings: measurements.queryTimings } : {}),
    };
    const log = {
      event: traceId ? 'mudd_traced_http_request' : 'slow_http_request',
      requestId: res.locals.requestId,
      ...(traceId ? {
        traceId,
        tracePhase,
        ...(tracePhase === 'command' && typeof req.body?.type === 'string'
          ? { commandType: req.body.type }
          : {}),
      } : {}),
      method: req.method,
      path: req.path,
      status: res.statusCode,
      durationMs: Math.round(durationMs),
      measurements: loggedMeasurements,
      eventLoop: eventLoopDelayMs(),
      dbPool: {
        total: pool.totalCount,
        idle: pool.idleCount,
        waiting: pool.waitingCount,
      },
    };
    (traceId ? console.info : console.warn)(JSON.stringify(log));
  });
  requestMeasurements.run(measurements, next);
});
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
app.use(clerkMiddleware((req: Request) => ({
  publishableKey: publishableKeyFromHost(getClerkProxyHost(req) ?? '', process.env.CLERK_PUBLISHABLE_KEY),
})));

async function accountFor(request: Request, response: Response): Promise<AccountIdentity | undefined> {
  const auth = getAuth(request);
  const identity = await measureStage('account', () => getAccountIdentity(request, { userId: auth.userId, sessionId: auth.sessionId }));
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
  const [session] = await measureDatabaseOperation('world_session.active_lookup', () =>
    measureStage('session', () => db.select().from(worldSessions).where(and(
      eq(worldSessions.playerId, identity.playerId),
      eq(worldSessions.worldInstanceId, worldInstanceId),
    )).limit(1)));
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

const realtimeGateway = createRealtimeGateway(async (req, channels) => {
  const auth = getAuth(req);
  if (auth.sessionClaims?.exp && Date.now() >= auth.sessionClaims.exp * 1000) return undefined;
  const identity = await getAccountIdentity(req, { userId: auth.userId, sessionId: auth.sessionId });
  if (!identity) return undefined;
  const worldId = typeof req.query.world === 'string' ? req.query.world : '';
  const runtime = worldRuntimes.get(worldId);
  if (!runtime) return undefined;
  const current = await activeCharacter(identity, worldId);
  if (!current) return undefined;
  const { session, character } = current;
  const context = worldContext(identity, session);
  const [chat, presence, interactions, party, team] = await Promise.all([
    channels.includes('chat') ? db.select({ cursor: sql<number>`coalesce(max(${roomChatMessages.id}), 0)` }).from(roomChatMessages)
      .where(and(eq(roomChatMessages.worldInstanceId, worldId), eq(roomChatMessages.roomId, character.locationId)))
      : Promise.resolve([]),
    channels.includes('presence')
      ? listRoomOccupants(store, worldId, character.locationId, character.characterId) : Promise.resolve([]),
    channels.includes('interactions') ? store.readStream(worldId, interactionStreamId(worldId)).then((events) =>
      projectCharacterInteractions(events, character.characterId))
      : Promise.resolve(null),
    channels.includes('party') ? runtime.engine.query({ type: 'party.info', version: 1, queryId: crypto.randomUUID(),
      worldInstanceId: worldId, characterId: character.characterId, payload: {} }, context) : Promise.resolve(null),
    channels.includes('team') ? runtime.engine.query({ type: 'team.combat.info', version: 1, queryId: crypto.randomUUID(),
      worldInstanceId: worldId, characterId: character.characterId, payload: {} }, context) : Promise.resolve(null),
  ]);
  if (party && !party.ok || team && !team.ok) return undefined;
  const guestExpiry = Date.now() + 60_000;
  const tokenExpiry = auth.sessionClaims?.exp ? auth.sessionClaims.exp * 1000 : guestExpiry;
  return { worldInstanceId: worldId, characterId: character.characterId, playerId: identity.playerId,
    expiresAt: Math.min(guestExpiry, tokenExpiry),
    roomId: character.locationId, values: {
    chat: [character.locationId, chat[0]?.cursor], presence: [character.locationId, presence],
    interactions, party: party?.ok ? party.value : null, team: team?.ok ? team.value : null,
    character: channels.includes('character') ? character.revision : undefined,
  } };
});
websocketApp.ws('/api/realtime', (socket, req) => {
  // Exact same-origin or explicitly configured origins only; never allow absent
  // or opaque browser origins on the socket path.
  const origin = req.get('origin');
  if (!origin || !(allowedOrigins.has(origin) || origin === `${req.protocol}://${req.get('host')}`)) {
    socket.close(1008); return;
  }
  // Installed PWAs can run older SDK builds; only clients that ask for protocol 2
  // receive its additional frame fields.
  realtimeGateway.connect(socket, req, {
    protocolVersion: req.query.protocol === String(REALTIME_PROTOCOL_VERSION) ? REALTIME_PROTOCOL_VERSION : 1,
  });
});
const stopRealtimeNotifications = startRealtimeNotifications((change) => {
  realtimeGateway.invalidate(change);
  wakeEffectBatch(change.world);
}, () => {
  realtimeGateway.refreshAll();
  void runPendingEffectBatch();
});

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

type RoomOccupants = Awaited<ReturnType<typeof listRoomOccupants>>;

async function locationWithRoomPresence(
  location: unknown,
  worldInstanceId: string,
  viewerCharacterId: string,
  locationGroups: readonly LocationGroupDefinition[],
  prefetched?: { locationId: string; occupants: RoomOccupants },
) {
  const projection = projectLocationWithGroups(LocationProjectionSchema.parse(location), locationGroups);
  // Callers start the occupant lookup alongside the describe query to save a
  // round trip; reuse it only if it was made for the room being described.
  const occupants = prefetched?.locationId === projection.locationId
    ? prefetched.occupants
    : await listRoomOccupants(
      store,
      worldInstanceId,
      projection.locationId,
      viewerCharacterId,
    );
  return LocationProjectionSchema.parse({ ...projection, occupants });
}

type GameProjectionResult =
  | { ok: true; value: ReturnType<typeof MovementResultProjectionSchema.parse> }
  | { ok: false; status: number; code: string; message: string };

async function buildGameProjection(
  identity: AccountIdentity,
  runtime: WorldRuntime,
  session: typeof worldSessions.$inferSelect,
  requestId: string,
): Promise<GameProjectionResult> {
  const events = await store.readStream(session.worldInstanceId, session.characterId);
  const replayedCharacter = replayCharacter(events);
  if (!replayedCharacter || replayedCharacter.archived) {
    return { ok: false, status: 409, code: 'CHARACTER_UNAVAILABLE', message: 'That character is no longer available.' };
  }
  const character = await ensureCharacterWallet(identity, session, replayedCharacter);
  const query = LocationDescribeQuerySchema.parse({
    type: 'location.describe',
    version: 1,
    queryId: globalThis.crypto.randomUUID(),
    worldInstanceId: session.worldInstanceId,
    characterId: session.characterId,
    payload: {},
  });
  const statsQuery = CharacterStatsQuerySchema.parse({
    type: 'character.stats',
    version: 1,
    queryId: globalThis.crypto.randomUUID(),
    worldInstanceId: session.worldInstanceId,
    characterId: session.characterId,
    payload: {},
  });
  const localWoodcuttingTrees = runtime.world.woodcuttingTrees
    .filter((tree) => tree.locationId === character.locationId);
  const treeEventsPromise = localWoodcuttingTrees.length > 0
    ? measureStage('woodcuttingTreeProjection', () =>
      store.readStream(session.worldInstanceId, WOODCUTTING_TREES_STREAM_ID))
    : Promise.resolve([]);
  const [result, statsResult, locationGroupCatalog, treeEvents, occupants] = await Promise.all([
    measureStage('locationProjection', () => runtime.engine.query(query, worldContext(identity, session), {
      characterProjection: character,
      correlationId: requestId,
      measureStage,
    })),
    measureStage('statsProjection', () => runtime.engine.query(statsQuery, worldContext(identity, session), {
      characterProjection: character,
      correlationId: requestId,
    })),
    measureStage('locationGroupCatalog', () => runtime.locationGroupsFeature.catalog.read()),
    treeEventsPromise,
    measureStage('roomOccupants', () => listRoomOccupants(
      store,
      session.worldInstanceId,
      character.locationId,
      session.characterId,
    )),
  ]);
  if (!result.ok) {
    const status = result.code === 'INTERNAL_ERROR' ? 500 : result.code === 'NOT_FOUND' ? 404 : 403;
    return { ok: false, status, code: result.code, message: result.message };
  }
  if (!statsResult.ok) {
    const status = statsResult.code === 'INTERNAL_ERROR' ? 500 : statsResult.code === 'NOT_FOUND' ? 404 : 403;
    return { ok: false, status, code: statsResult.code, message: statsResult.message };
  }

  const baseLocation = await locationWithRoomPresence(
    result.value,
    session.worldInstanceId,
    session.characterId,
    locationGroupCatalog.groups,
    { locationId: character.locationId, occupants },
  );
  const treePresence = projectWoodcuttingTreePresence(
    localWoodcuttingTrees,
    treeEvents,
    new Date(),
  );
  const woodcuttingRoom = projectWoodcuttingRoom(baseLocation, treePresence);
  const location = woodcuttingRoom.location;
  const currentWorldLocation = runtime.world.locations.find((entry) => entry.id === character.locationId);
  const currentStateId = character.locationStateId ?? currentWorldLocation?.defaultStateId;
  return {
    ok: true,
    value: MovementResultProjectionSchema.parse({
      character,
      stats: statsResult.value,
      location,
      map: projectWorldMap(character, runtime.world, locationGroupCatalog.groups),
      questJournal: projectQuestJournal(character, runtime.world),
      availableFishingSpots: runtime.world.fishingSpots
        .filter((spot) => spot.locationId === character.locationId &&
          (!spot.stateId || spot.stateId === currentStateId))
        .map(({ id, label }) => ({ id, label })),
       availableWoodcuttingTrees: woodcuttingRoom.availableTrees,
      dailyActivities: {
        cycle: new Date().toISOString().slice(0, 10),
        boards: runtime.world.dailyBoards.filter((board) => board.locationId === character.locationId)
          .map(({ id, name }) => ({ id, name })),
        sources: runtime.world.supplySources.filter((source) => source.locationId === character.locationId),
      },
    }),
  };
}

/**
 * Run the effects that finish a committed command's own outcome, such as a
 * claimed item reaching the pack, so a projection built next includes them.
 * Failing here never fails the command; it only withholds the projection.
 */
async function settleCommandOutcome(
  runtime: WorldRuntime,
  context: SessionContext,
  result: DispatchResult,
  characterId: string,
  requestId: string,
): Promise<boolean> {
  if (result.completingEffects === 0) return true;
  try {
    // Like the background worker, run effects outside the request's read cache.
    return await measureStage('commandEffects', () => store.withoutCommandReadCache(() =>
      runtime.engine.settleCommandEffects(context, result)));
  } catch (error) {
    console.warn(JSON.stringify({
      event: 'command_effects_unsettled',
      requestId,
      commandId: result.receipt.commandId,
      errorName: error instanceof Error ? error.name : 'UnknownError',
    }));
    return false;
  } finally {
    // Their appends could not invalidate that cache, so drop its snapshot of the
    // actor's stream before the projection reads it.
    store.invalidateCommandReadCache(runtime.worldInstanceId, characterId);
  }
}

async function commandResponseProjection(
  identity: AccountIdentity,
  runtime: WorldRuntime,
  session: typeof worldSessions.$inferSelect,
  requestId: string,
  command: { commandId: string; type: string | undefined; movement: boolean },
) {
  // Moves keep the stage and log names that existing traces use.
  const unavailable = command.movement ? 'movement_projection_unavailable' : 'command_projection_unavailable';
  try {
    const projection = await measureStage(command.movement ? 'movementProjection' : 'commandProjection', () =>
      buildGameProjection(identity, runtime, session, requestId));
    if (projection.ok) return projection.value;
    console.warn(JSON.stringify({
      event: unavailable,
      requestId,
      commandId: command.commandId,
      commandType: command.type,
      code: projection.code,
    }));
  } catch (error) {
    console.warn(JSON.stringify({
      event: unavailable,
      requestId,
      commandId: command.commandId,
      commandType: command.type,
      errorName: error instanceof Error ? error.name : 'UnknownError',
      ...(error instanceof z.ZodError
        ? { schemaIssues: error.issues.map((issue) => ({ path: issue.path.join('.'), code: issue.code })) }
        : {}),
    }));
  }
  return undefined;
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
      lastPlayedAt: characters.lastPlayedAt,
    }).from(characters).where(eq(characters.playerId, identity.playerId))
      .orderBy(desc(characters.createdAt));
    const rowsByWorld = new Map<string, typeof rows>();
    for (const row of rows) {
      const worldRows = rowsByWorld.get(row.worldInstanceId) ?? [];
      worldRows.push(row);
      rowsByWorld.set(row.worldInstanceId, worldRows);
    }
    const worldCharacterData = new Map(await Promise.all([...rowsByWorld].map(async ([worldInstanceId, worldRows]) => {
      const runtime = runtimeFor(worldInstanceId);
      const [streams, locationGroupCatalog] = await Promise.all([
        store.readStreams
          ? store.readStreams(worldInstanceId, worldRows.map((row) => row.id))
          : Promise.all(worldRows.map(async (row) => [
              row.id,
              await store.readStream(worldInstanceId, row.id),
            ] as const)).then((entries) => new Map(entries)),
        runtime.locationGroupsFeature.catalog.read(),
      ]);
      return [worldInstanceId, { runtime, streams, locationGroupCatalog }] as const;
    })));
    const characterList = rows.map((row) => {
      const worldData = worldCharacterData.get(row.worldInstanceId);
      if (!worldData) throw new Error('A character world could not be loaded.');
      const { runtime, locationGroupCatalog } = worldData;
      const projection = replayCharacter(worldData.streams.get(row.id) ?? []);
      if (!projection) throw new Error('A character record exists without its creation event.');
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
        lastPlayedAt: row.lastPlayedAt?.toISOString() ?? null,
      };
    });
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

    const result = await enterWorld(db, {
      playerId: identity.playerId, characterId: input.data.characterId, worldInstanceId,
      locationId: characterProjection && !characterProjection.archived ? characterProjection.locationId : undefined,
    });

    if (result.kind === 'missing') return res.status(404).json({ message: 'That character is unavailable.' });
    if (result.kind === 'occupied') return res.status(409).json({ message: 'Leave the current world session before switching characters.' });
    const lastSeenAt = result.session.lastSeenAt instanceof Date
      ? result.session.lastSeenAt.getTime()
      : undefined;
    if (lastSeenAt === undefined || Date.now() - lastSeenAt > INTERACTION_HEARTBEAT_FRESH_MS) {
      if (lastSeenAt !== undefined) {
        await touchWorldSessionPresence(identity.playerId, result.session.worldInstanceId, result.session.id);
      }
      const reset = await resetStaminaRecoveryAnchor(selected, result.session.characterId);
      if (!reset) return res.status(409).json({ message: 'Your character is no longer available.' });
    }
    await runPendingEffectBatch(result.session.worldInstanceId);
    return res.json({ sessionId: result.session.id, characterId: result.session.characterId });
  } catch (error) {
    next(error);
  }
});

app.post('/api/world-session/heartbeat', createRateLimiter({ windowMs: 60_000, maxRequests: 90 }), async (req, res, next) => {
  try {
    const identity = await accountFor(req, res);
    if (!identity) return;
    const selected = selectedRuntime(res);
    const current = await activeSession(identity, selected.worldInstanceId);
    if (!current) return res.status(409).json({ message: 'Enter the world with a character before sending presence.' });

    const character = await measureStage('heartbeat.characterReplay', async () =>
      replayCharacter(await store.readStream(current.worldInstanceId, current.characterId)));
    if (!character || character.archived) {
      return res.status(409).json({ message: 'Enter the world with an active character before sending presence.' });
    }
    if (character.combat?.status === 'defeat' || character.health?.current === 0) {
      return res.status(409).json({ message: 'Your character has died. Start a new character to begin again.' });
    }

    const wasStale = Date.now() - current.lastSeenAt.getTime() > INTERACTION_HEARTBEAT_FRESH_MS;
    const refreshed = await measureStage('heartbeat.sessionTouch', () =>
      touchWorldSessionPresence(
        identity.playerId,
        current.worldInstanceId,
        current.id,
      ));
    if (!refreshed) return res.status(409).json({ message: 'Your world session is no longer active.' });
    if (wasStale) {
      const reset = await measureStage('heartbeat.staminaAnchorReset', () =>
        resetStaminaRecoveryAnchor(selected, current.characterId));
      if (!reset) return res.status(409).json({ message: 'Your character is no longer available.' });
    }

    return res.json({
      worldInstanceId: current.worldInstanceId,
      locationId: character.locationId,
      occupants: await measureStage('heartbeat.roomOccupants', () =>
        listRoomOccupants(
          store,
          current.worldInstanceId,
          character.locationId,
          current.characterId,
        )),
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
    const projection = await buildGameProjection(identity, selected, current, res.locals.requestId);
    if (!projection.ok) {
      return res.status(projection.status).json({
        message: projection.message,
        ...(projection.status === 500 ? { requestId: res.locals.requestId } : {}),
      });
    }
    return res.json({
      player: { id: identity.playerId, displayName: identity.displayName },
      ...(selected.world.currency
        ? {
          currency: {
            id: selected.world.currency.id,
            name: selected.world.currency.name,
            symbol: selected.world.currency.symbol,
          },
        }
        : {}),
      ...projection.value,
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
    // Only this room's world can hold the NPC reply; don't wait on other worlds.
    if (submission.effectId) await runPendingEffectBatch(current.session.worldInstanceId);
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
    const characterId = current.character.characterId;
    const { requests, encounter } = projectCharacterInteractions(events, characterId);
    return res.json(InteractionInboxSchema.parse({ requests, encounter }));
  } catch (error) {
    next(error);
  }
});

app.post(
  '/api/commands',
  createRateLimiter({ windowMs: 60_000, maxRequests: 120 }),
  (req, res, next) => {
    const command = req.body as { characterId?: unknown } | null;
    const characterId = typeof command?.characterId === 'string' ? command.characterId : '';
    const expectedVersion = typeof (req.body as { expectedVersion?: unknown } | null)?.expectedVersion === 'number'
      ? (req.body as { expectedVersion: number }).expectedVersion
      : undefined;
    if (expectedVersion === undefined) return next();
    return store.withCommandReadCache(
      res.locals.worldInstanceId,
      characterId,
      () => next(),
      expectedVersion,
    );
  },
  async (req, res, next) => {
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
    let commandSession: typeof worldSessions.$inferSelect | undefined;
    if (command?.type === 'character.archive' && typeof command.characterId === 'string') {
      const current = await activeSession(identity, selected.worldInstanceId);
      if (current?.characterId === command.characterId) {
        return res.status(409).json({ message: 'Leave the world before archiving this character.' });
      }
    }

    const characterCommand = ['character.create', 'character.rename', 'character.archive', 'character.restore', 'character.class.choose']
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
      commandSession = current;
      if (typeof command?.characterId === 'string' && command.characterId !== current.characterId) {
        return res.status(403).json({ message: 'This world session is bound to a different character.' });
      }
      const interactionStreamIdForWorld = interactionStreamId(current.worldInstanceId);
      const guardStreamIds = [current.characterId, interactionStreamIdForWorld];
      const guardStreamsRead = store.readStreams
        ? store.readStreams(current.worldInstanceId, guardStreamIds)
        : Promise.all(guardStreamIds.map(async (streamId) => [
            streamId,
            await store.readStream(current.worldInstanceId, streamId),
          ] as const)).then((entries) => new Map(entries));
      const [guardStreams, teamCombatInfo] = await measureStage(
        'commandGuardReads',
        () => Promise.all([
          guardStreamsRead,
          selected.engine.query({
            type: 'team.combat.info',
            version: 1,
            queryId: `guard:${res.locals.requestId}`,
            worldInstanceId: current.worldInstanceId,
            characterId: current.characterId,
            payload: {},
          }, worldContext(identity, current)),
        ]),
      );
      const currentCharacter = replayCharacter(guardStreams.get(current.characterId) ?? []);
      const interactionEvents = guardStreams.get(interactionStreamIdForWorld) ?? [];
      if (currentCharacter?.combat?.status === 'defeat' || currentCharacter?.health?.current === 0) {
        return res.status(409).json({ message: 'Your character has died. Start a new character to begin again.' });
      }
      const latestEncounter = PvpEncounterProjectionSchema.safeParse(
        projectCharacterInteractions(interactionEvents, current.characterId).encounter);
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
        const [recipientSession] = await measureDatabaseOperation('interaction.recipient_presence_lookup', () =>
          db.select({
            characterId: worldSessions.characterId,
            lastSeenAt: worldSessions.lastSeenAt,
          }).from(worldSessions).where(and(
            eq(worldSessions.worldInstanceId, current.worldInstanceId),
            eq(worldSessions.characterId, recipientCharacterId),
          )).limit(1));
        if (!recipientSession || Date.now() - recipientSession.lastSeenAt.getTime() > INTERACTION_HEARTBEAT_FRESH_MS) {
          return res.status(409).json({ message: 'That player is not online right now.' });
        }
      }
      context = worldContext(identity, current);
    }

    const result = await measureStage('command', () => selected.engine.dispatch(req.body, context, res.locals.requestId));
    // The completing-effect count only steers settlement below; clients never see it.
    const { completingEffects: _completingEffects, ...dispatched } = result;
    if (result.commitOutcome === 'duplicate' && commandSession) {
      store.invalidateCommandReadCache(selected.worldInstanceId, commandSession.characterId);
    }
    if (!result.receipt.ok && result.receipt.code === 'INTERNAL_ERROR') {
      return res.status(500).json({
        ...dispatched,
        message: result.receipt.message,
        requestId: res.locals.requestId,
      });
    }
    const movementCommand = command.type === 'character.move' || command.type === 'character.road.step';
    // Opted-in clients get the projection for every world command; older ones only for moves.
    const projectionRequested = req.get(COMMAND_PROJECTION_HEADER) === GAME_COMMAND_PROJECTION;
    const projectionSession = result.receipt.ok && (projectionRequested || movementCommand)
      ? commandSession
      : undefined;
    let effectsSettled = false;
    if (projectionSession) {
      // A duplicate cannot report which effects its original commit queued.
      // Moves queue none that complete them, so only they keep a projection.
      effectsSettled = result.commitOutcome === 'duplicate'
        ? movementCommand
        : await settleCommandOutcome(selected, context, result, projectionSession.characterId, res.locals.requestId);
    }
    // Effects are durably queued with the command. Their worker is already
    // running; don't make the action wait for unrelated effects across worlds.
    // It starts after settlement so it cannot claim this command's own effects.
    if (result.receipt.ok) void runPendingEffectBatch(selected.worldInstanceId);
    let projection;
    if (projectionSession && effectsSettled) {
      projection = await commandResponseProjection(identity, selected, projectionSession, res.locals.requestId, {
        commandId: result.receipt.commandId,
        type: command.type,
        movement: movementCommand,
      });
    } else if (projectionSession) {
      // The client falls back to a snapshot; this shows how often that happens.
      console.info(JSON.stringify({
        event: 'command_projection_deferred',
        requestId: res.locals.requestId,
        commandId: result.receipt.commandId,
        commandType: command.type,
        reason: result.commitOutcome === 'duplicate' ? 'duplicate' : 'effects_unsettled',
      }));
    }
    return res.json({
      ...dispatched,
      ...(projection && projectionRequested ? { gameProjection: projection } : {}),
      ...(projection && !projectionRequested ? { movementProjection: projection } : {}),
    });
  } catch (error) {
    next(error);
  }
  },
);

app.post('/api/queries', async (req, res, next) => {
  try {
    const identity = await accountFor(req, res);
    if (!identity) return;
    const parsedQuery = WorldQuerySchema.safeParse(req.body);
    if (!parsedQuery.success) return res.status(400).json({ message: 'Invalid world query.' });
    const query = parsedQuery.data;
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
    const describesLocation = query.type === 'location.describe';
    // A look also needs the group catalog and room occupants; fetch them alongside
    // the query instead of after it.
    const [result, locationGroupCatalog, occupants] = await Promise.all([
      selected.engine.query(query, worldContext(identity, current), {
        characterProjection: character,
        correlationId: res.locals.requestId,
      }),
      describesLocation ? selected.locationGroupsFeature.catalog.read() : undefined,
      describesLocation
        ? listRoomOccupants(store, current.worldInstanceId, character.locationId, current.characterId)
        : undefined,
    ]);
    if (result.ok && locationGroupCatalog && occupants) {
      const value = await locationWithRoomPresence(
        result.value,
        current.worldInstanceId,
        current.characterId,
        locationGroupCatalog.groups,
        { locationId: character.locationId, occupants },
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
installProductionWebServing(app, express.static, process.env.NODE_ENV === 'production', import.meta.url);
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

const port = Number(
  process.env.PORT ?? process.env.API_PORT ?? (process.env.NODE_ENV === 'production' ? 5000 : 5001),
);
export const server = app.listen(port, '0.0.0.0', () => {
  console.log(`MUDD server listening on ${port}`);
});

async function shutdown() {
  clearInterval(effectPoller);
  for (const timer of effectWakeups.values()) clearTimeout(timer);
  effectWakeups.clear();
  stopRealtimeNotifications();
  realtimeGateway.close();
  server.close();
  for (const scheduler of autonomousNpcSchedulers) scheduler.stop();
  for (const scheduler of staminaRecoverySchedulers) scheduler.stop();
  objectLifecycleScheduler.stop();
  await stopWorldRuntimes(worldRuntimes);
  await pool.end();
}
process.on('SIGTERM', () => void shutdown());
process.on('SIGINT', () => void shutdown());
