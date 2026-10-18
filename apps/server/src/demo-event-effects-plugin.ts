import type { EnginePlugin } from '@mudd/engine-core';
import { demoWorld } from '@mudd/world-demo';
import {
  getRoomChatMessageById,
  getRoomChatMessageBySourceEffectId,
  publishNpcRoomMessage,
} from './room-chat-service.js';
import { createNpcRoomAnnouncer } from './npc-announcer.js';
import { createNpcRoomChatReactor } from './npc-chat-reactor.js';
import {
  LOCATION_ENTERED_EFFECT,
  LocationEnteredEffectSchema,
  PLAYER_ROOM_MESSAGE_EFFECT,
  PlayerRoomMessageEffectSchema,
} from './durable-effect-contracts.js';

export const demoEventEffectsPlugin: EnginePlugin = {
  manifest: {
    id: 'mudd.demo-event-effects',
    version: '1.0.0',
    apiVersion: '1.0',
    category: 'first-party',
  },
  register({ registerEffect }) {
    const announceNpcRoomMessage = createNpcRoomAnnouncer(publishNpcRoomMessage);
    const reactToNpcRoomChat = createNpcRoomChatReactor(publishNpcRoomMessage);

    registerEffect(LOCATION_ENTERED_EFFECT, 1, LocationEnteredEffectSchema, async (effect, context) => {
      const location = demoWorld.locations.find((candidate) => candidate.id === effect.toLocationId);
      for (const npc of location?.npcs ?? []) {
        if (!npc.announcements?.length) continue;
        const sourceEffectId = `${context.effectId}:${npc.id}`;
        if (await getRoomChatMessageBySourceEffectId(sourceEffectId)) continue;
        await announceNpcRoomMessage({
          worldInstanceId: context.worldInstanceId,
          roomId: effect.toLocationId,
          npcId: npc.id,
          npcName: npc.name,
          announcements: npc.announcements,
          sourceEffectId,
        });
      }
    });

    registerEffect(PLAYER_ROOM_MESSAGE_EFFECT, 1, PlayerRoomMessageEffectSchema, async (effect, context) => {
      const playerMessage = await getRoomChatMessageById(effect.roomChatMessageId);
      if (!playerMessage || playerMessage.speakerType !== 'player') return;
      if (await getRoomChatMessageBySourceEffectId(context.effectId)) return;

      const location = demoWorld.locations.find((candidate) => candidate.id === playerMessage.roomId);
      for (const npc of location?.npcs ?? []) {
        if (!npc.roomChatReactions?.length) continue;
        const response = await reactToNpcRoomChat({
          worldInstanceId: context.worldInstanceId,
          roomId: playerMessage.roomId,
          npcId: npc.id,
          npcName: npc.name,
          playerMessage: playerMessage.text,
          reactions: npc.roomChatReactions,
          sourceEffectId: context.effectId,
        });
        if (response) return;
      }
    });
  },
};
