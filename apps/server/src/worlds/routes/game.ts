import { type ServerDependencies } from '../../app/dependencies.js';
import { READABLE_ACTIONS_HEADER } from '@mudd/contracts';
import { locationForClient } from '../location-client-projection.js';

export function registerGameRoutes(app: import('express').Express, dependencies: Pick<
  ServerDependencies,
  | 'accountFor'
  | 'selectedRuntime'
  | 'activeSession'
  | 'buildGameProjection'
>) {
  const { accountFor, selectedRuntime, activeSession, buildGameProjection } = dependencies;
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
        location: locationForClient(projection.value.location, req.get(READABLE_ACTIONS_HEADER)),
      });
    } catch (error) {
      next(error);
    }
  });
}
