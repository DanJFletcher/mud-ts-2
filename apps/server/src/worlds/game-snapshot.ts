import { measureStage } from '../app/performance.js';
import { z } from 'zod';
import { InitializeCharacterWalletCommandSchema, CharacterStatsQuerySchema, LocationDescribeQuerySchema, LocationProjectionSchema, MovementResultProjectionSchema, type LocationGroupDefinition, type SessionContext } from '@mudd/contracts';
import { projectQuestJournal, questWorldOutcomeKeys, SYSTEM_ACTOR_ID, type DispatchResult } from '@mudd/engine-core';
import { projectQuestWorldOutcomes, QUEST_WORLD_OUTCOMES_STREAM_ID, WOODCUTTING_TREES_STREAM_ID, projectWoodcuttingTreePresence, worldItemsStreamId } from '@mudd/core-plugins';
import { worldSessions } from '../db/schema.js';
import { projectLocationWithGroups } from './location-group-projection.js';
import { shouldInitializeCharacterWallet } from './world-wallet-policy.js';
import { projectWorldMap } from './world-map-projection.js';
import { projectWoodcuttingRoom } from './woodcutting-room-projection.js';
import { type AccountIdentity } from '../auth/session-service.js';
import { type WorldRuntime } from './world-registry.js';
import { type ServerDependencies } from '../app/dependencies.js';
import { replayCharacter } from '../app/character-replay.js';

export function createGameSnapshots(dependencies: Pick<
  ServerDependencies,
  | 'listRoomOccupants'
  | 'store'
  | 'runtimeFor'
  | 'worldContext'
>) {
  const { listRoomOccupants, store, runtimeFor, worldContext } = dependencies;
  async function resetStaminaRecoveryAnchor(
    runtime: WorldRuntime,
    characterId: string,
    presenceAnchorAt?: Date,
  ) {
    for (let attempt = 0;attempt < 3;attempt += 1) {
      const character = replayCharacter(await store.readStream(runtime.worldInstanceId, characterId));
      if (!character || character.archived || character.health?.current === 0) return false;
      const resetAnchorAt = new Date();
      const settleAt = presenceAnchorAt ?? resetAnchorAt;
      const result = await runtime.engine.dispatchSystem({
        type: 'character.stamina.recover',
        version: 2,
        commandId: `stamina-reconnect:${character.characterId}:${character.revision}`,
        worldInstanceId: runtime.worldInstanceId,
        characterId: character.characterId,
        expectedVersion: character.revision,
        payload: {
          settleAt: settleAt.toISOString(),
          resetAnchorAt: resetAnchorAt.toISOString(),
        },
      }, SYSTEM_ACTOR_ID, undefined, presenceAnchorAt);
      if (result.receipt.ok) return true;
      if (result.receipt.code !== 'VERSION_CONFLICT') {
        throw new Error(result.receipt.message);
      }
    }
    throw new Error('Could not safely reset the stamina recovery anchor.');
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

  type RoomOccupants = Awaited<ReturnType<typeof listRoomOccupants>>;

  async function locationWithRoomPresence(
    location: unknown,
    worldInstanceId: string,
    viewerCharacterId: string,
    locationGroups: readonly LocationGroupDefinition[],
    prefetched?: { locationId: string; occupants: RoomOccupants; },
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
    | { ok: true; value: ReturnType<typeof MovementResultProjectionSchema.parse>; }
    | { ok: false; status: number; code: string; message: string; };

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
    // Shared quest outcomes are read only for worlds whose quests can settle them.
    const questWorldOutcomes = questWorldOutcomeKeys(runtime.world).size > 0
      ? projectQuestWorldOutcomes(await store.readStream(session.worldInstanceId, QUEST_WORLD_OUTCOMES_STREAM_ID))
      : undefined;
    const currentWorldLocation = runtime.world.locations.find((entry) => entry.id === character.locationId);
    const currentStateId = character.locationStateId ?? currentWorldLocation?.defaultStateId;
    return {
      ok: true,
      value: MovementResultProjectionSchema.parse({
        serverTime: new Date().toISOString(),
        character,
        stats: statsResult.value,
        location,
        map: projectWorldMap(character, runtime.world, locationGroupCatalog.groups),
        questJournal: projectQuestJournal(character, runtime.world, questWorldOutcomes?.values),
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
      // These appends run outside the request cache, so discard the actor and
      // shared-world snapshots before the response projection reads them.
      store.invalidateCommandReadCache(runtime.worldInstanceId, characterId);
      store.invalidateCommandReadCache(
        runtime.worldInstanceId,
        worldItemsStreamId(runtime.worldInstanceId),
      );
    }
  }

  async function commandResponseProjection(
    identity: AccountIdentity,
    runtime: WorldRuntime,
    session: typeof worldSessions.$inferSelect,
    requestId: string,
    command: { commandId: string; type: string | undefined; movement: boolean; },
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
  return { ensureCharacterWallet, locationWithRoomPresence, buildGameProjection, settleCommandOutcome, commandResponseProjection, resetStaminaRecoveryAnchor };
}

export type GameSnapshots = ReturnType<typeof createGameSnapshots>;
