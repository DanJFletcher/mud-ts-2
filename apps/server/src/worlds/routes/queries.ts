import { WorldQuerySchema } from '../world-query-schema.js';
import { READABLE_ACTIONS_HEADER, LocationProjectionSchema } from '@mudd/contracts';
import { locationForClient } from '../location-client-projection.js';
import { type ServerDependencies } from '../../app/dependencies.js';
import { replayCharacter } from '../../app/character-replay.js';

export function registerQueryRoutes(app: import('express').Express, dependencies: Pick<
  ServerDependencies,
  | 'listRoomOccupants'
  | 'store'
  | 'accountFor'
  | 'selectedRuntime'
  | 'activeSession'
  | 'worldContext'
  | 'locationWithRoomPresence'
>) {
  const {
    listRoomOccupants,
    store,
    accountFor,
    selectedRuntime,
    activeSession,
    worldContext,
    locationWithRoomPresence,
  } = dependencies;
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
        return res.json({ ...result, value: locationForClient(value, req.get(READABLE_ACTIONS_HEADER)) });
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
        ...(result.ok && describesLocation ? {
          value: locationForClient(LocationProjectionSchema.parse(result.value), req.get(READABLE_ACTIONS_HEADER)),
        } : {}),
        ...(!result.ok && result.code === 'INTERNAL_ERROR'
          ? { requestId: result.correlationId ?? res.locals.requestId }
          : {}),
      });
    } catch (error) {
      next(error);
    }
  });
}
