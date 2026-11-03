import { measureStage, measureDatabaseOperation } from '../../app/performance.js';
import { and, eq } from 'drizzle-orm';
import { ArchiveCharacterCommandSchema, COMMAND_PROJECTION_HEADER, GAME_COMMAND_PROJECTION, CreateCharacterCommandSchema, RestoreCharacterCommandSchema, RenameCharacterCommandSchema, PvpEncounterProjectionSchema, PartyInfoProjectionSchema, TeamCombatInfoProjectionSchema } from '@mudd/contracts';
import { interactionStreamId, projectCharacterInteractions } from '@mudd/core-plugins';
import { characters, worldSessions } from '../../db/schema.js';
import { invalidateCachedWorldSession } from '../../auth/request-identity-cache.js';
import { createRateLimiter } from '../../app/request-security.js';
import { type ServerDependencies } from '../../app/dependencies.js';
import { replayCharacter } from '../../app/character-replay.js';
import { INTERACTION_HEARTBEAT_FRESH_MS } from '../session-policy.js';

export function registerCommandRoutes(app: import('express').Express, dependencies: Pick<
  ServerDependencies,
  | 'db'
  | 'touchWorldSessionPresence'
  | 'store'
  | 'accountFor'
  | 'selectedRuntime'
  | 'activeSession'
  | 'worldContext'
  | 'settleCommandOutcome'
  | 'commandResponseProjection'
  | 'runPendingEffectBatch'
>) {
  const {
    db,
    touchWorldSessionPresence,
    store,
    accountFor,
    selectedRuntime,
    activeSession,
    worldContext,
    settleCommandOutcome,
    commandResponseProjection,
    runPendingEffectBatch,
  } = dependencies;
  app.post(
    '/api/commands',
    createRateLimiter({ windowMs: 60_000, maxRequests: 120 }),
    (req, res, next) => {
      const command = req.body as { characterId?: unknown; } | null;
      const characterId = typeof command?.characterId === 'string' ? command.characterId : '';
      const expectedVersion = typeof (req.body as { expectedVersion?: unknown; } | null)?.expectedVersion === 'number'
        ? (req.body as { expectedVersion: number; }).expectedVersion
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
        const command = req.body as { type?: string; characterId?: string; };
        const commandWorldInstanceId = (req.body as { worldInstanceId?: unknown; } | null)?.worldInstanceId;
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
          const combatPayload = (req.body as { payload?: { action?: unknown; targetNpcId?: unknown; }; }).payload;
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
            const recipientCharacterId = (req.body as { payload?: { recipientCharacterId?: unknown; }; }).payload?.recipientCharacterId;
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

        const presenceAnchorAt = commandSession?.lastSeenAt;
        if (commandSession) {
          const touched = await touchWorldSessionPresence(
            identity.playerId,
            commandSession.worldInstanceId,
            commandSession.id,
          );
          if (!touched) return res.status(409).json({ message: 'Your world session is no longer active.' });
        }
        const result = await measureStage('command', () => selected.engine.dispatch(
          req.body,
          context,
          res.locals.requestId,
          presenceAnchorAt,
        ));
        if (command?.type === 'character.archive' && result.receipt.ok) {
          invalidateCachedWorldSession(identity.playerId, selected.worldInstanceId);
        }
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
}
