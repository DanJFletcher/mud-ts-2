import { measureStage } from '../../app/performance.js';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { IdSchema } from '@mudd/contracts';
import { worldSessions } from '../../db/schema.js';
import { enterWorld } from '../world-entry.js';
import { invalidateCachedWorldSession } from '../../auth/request-identity-cache.js';
import { createRateLimiter } from '../../app/request-security.js';
import { type ServerDependencies } from '../../app/dependencies.js';
import { replayCharacter } from '../../app/character-replay.js';
import { INTERACTION_HEARTBEAT_FRESH_MS } from '../session-policy.js';

export function registerSessionRoutes(app: import('express').Express, dependencies: Pick<
  ServerDependencies,
  | 'db'
  | 'listRoomOccupants'
  | 'touchWorldSessionPresence'
  | 'worldActivity'
  | 'store'
  | 'accountFor'
  | 'selectedRuntime'
  | 'activeSession'
  | 'resetStaminaRecoveryAnchor'
  | 'runPendingEffectBatch'
>) {
  const {
    db,
    listRoomOccupants,
    touchWorldSessionPresence,
    worldActivity,
    store,
    accountFor,
    selectedRuntime,
    activeSession,
    resetStaminaRecoveryAnchor,
    runPendingEffectBatch,
  } = dependencies;
  app.post('/api/world-session', async (req, res, next) => {
    try {
      const identity = await accountFor(req, res, false);
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
      invalidateCachedWorldSession(identity.playerId, result.session.worldInstanceId);
      worldActivity.record(result.session.worldInstanceId);
      const lastSeenAt = result.session.lastSeenAt instanceof Date
        ? result.session.lastSeenAt.getTime()
        : undefined;
      if (lastSeenAt === undefined || Date.now() - lastSeenAt > INTERACTION_HEARTBEAT_FRESH_MS) {
        if (lastSeenAt !== undefined) {
          await touchWorldSessionPresence(identity.playerId, result.session.worldInstanceId, result.session.id);
        }
        const reset = await resetStaminaRecoveryAnchor(
          selected,
          result.session.characterId,
          result.session.lastSeenAt instanceof Date ? result.session.lastSeenAt : undefined,
        );
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
          resetStaminaRecoveryAnchor(selected, current.characterId, current.lastSeenAt));
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
      const identity = await accountFor(req, res, false);
      if (!identity) return;
      const selected = selectedRuntime(res);
      await db.delete(worldSessions).where(and(
        eq(worldSessions.playerId, identity.playerId),
        eq(worldSessions.worldInstanceId, selected.worldInstanceId),
      ));
      invalidateCachedWorldSession(identity.playerId, selected.worldInstanceId);
      return res.status(204).end();
    } catch (error) {
      next(error);
    }
  });
}
