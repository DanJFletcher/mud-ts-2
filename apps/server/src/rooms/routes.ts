import { z } from 'zod';
import { IdSchema } from '@mudd/contracts';
import { createRateLimiter } from '../app/request-security.js';
import { type ServerDependencies } from '../app/dependencies.js';

export function registerRoomRoutes(app: import('express').Express, dependencies: Pick<
  ServerDependencies,
  | 'createPlayerRoomChatMessage'
  | 'getRoomChatMessageBySourceEffectId'
  | 'listRoomChatMessages'
  | 'MAX_ROOM_CHAT_MESSAGE_LENGTH'
  | 'accountFor'
  | 'selectedRuntime'
  | 'activeCharacter'
  | 'runPendingEffectBatch'
>) {
  const {
    createPlayerRoomChatMessage,
    getRoomChatMessageBySourceEffectId,
    listRoomChatMessages,
    MAX_ROOM_CHAT_MESSAGE_LENGTH,
    accountFor,
    selectedRuntime,
    activeCharacter,
    runPendingEffectBatch,
  } = dependencies;
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
}
