import { desc, eq } from 'drizzle-orm';
import { locationGroupMembershipsForLocation, resolveLocationDisplayName } from '@mudd/contracts';
import { characters, worldSessions } from '../../db/schema.js';
import { type ServerDependencies } from '../../app/dependencies.js';
import { replayCharacter } from '../../app/character-replay.js';

export function registerCharacterRoutes(app: import('express').Express, dependencies: Pick<
  ServerDependencies,
  | 'db'
  | 'registeredWorlds'
  | 'toWorldSummary'
  | 'store'
  | 'runtimeFor'
  | 'accountFor'
  | 'selectedRuntime'
>) {
  const { db, registeredWorlds, toWorldSummary, store, runtimeFor, accountFor, selectedRuntime } = dependencies;
  app.get('/api/worlds', (_req, res) => {
    return res.json(registeredWorlds.map(toWorldSummary));
  });

  app.get('/api/characters', async (req, res, next) => {
    try {
      const identity = await accountFor(req, res, false);
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
}
