import { InteractionInboxSchema } from '@mudd/contracts';
import { interactionStreamId, projectCharacterInteractions } from '@mudd/core-plugins';
import { type ServerDependencies } from '../../app/dependencies.js';

export function registerInteractionRoutes(app: import('express').Express, dependencies: Pick<
  ServerDependencies,
  | 'store'
  | 'accountFor'
  | 'selectedRuntime'
  | 'activeCharacter'
>) {
  const { store, accountFor, selectedRuntime, activeCharacter } = dependencies;
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
}
