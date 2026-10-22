import type { EnginePlugin } from '@mudd/engine-core';
import {
  getRoomChatMessageById,
  getRoomChatMessageBySourceEffectId,
  publishNpcRoomMessage,
} from './room-chat-service.js';
import { WorldNpcMovedEventSchema } from '@mudd/contracts';
import { NPC_MOVEMENT_MESSAGE_SOURCE_PREFIX } from './room-chat-service.js';
import { createNpcRoomAnnouncer } from './npc-announcer.js';
import { createNpcRoomChatReactor } from './npc-chat-reactor.js';
import {
  LOCATION_ENTERED_EFFECT,
  LocationEnteredEffectSchema,
  PLAYER_ROOM_MESSAGE_EFFECT,
  PlayerRoomMessageEffectSchema,
} from './durable-effect-contracts.js';

export const worldEventEffectsPlugin: EnginePlugin = {
  manifest: {
    id: 'mudd.demo-event-effects',
    version: '1.0.0',
    apiVersion: '1.0',
    category: 'first-party',
  },
  register({ registerEffect, registerEventHandler }) {
    const announceNpcRoomMessage = createNpcRoomAnnouncer(publishNpcRoomMessage);
    const reactToNpcRoomChat = createNpcRoomChatReactor(publishNpcRoomMessage);

    registerEventHandler(
      'world.npc.moved',
      1,
      WorldNpcMovedEventSchema.shape.payload,
      async (event, context) => {
        const npc = context.world.locations
          .flatMap((location) => location.npcs ?? [])
          .find((candidate) => candidate.id === event.npcId);
        if (!npc) return;
        const departureDirection = event.direction ?? 'onward';
        const reverseExit = context.world.locations
          .find((location) => location.id === event.toLocationId)
          ?.exits.find((exit) => exit.toLocationId === event.fromLocationId);
        const arrivalDirection = reverseExit?.direction ?? oppositeDirection(departureDirection);
        const narrative = npc.movement?.narrative;
        const departure = formatMovementNarrative(
          narrative?.departure ?? `${npc.name} heads {direction}.`,
          departureDirection,
        );
        const arrival = formatMovementNarrative(
          narrative?.arrival ?? `${npc.name} arrives from the {direction}.`,
          arrivalDirection,
        );
        await publishNpcRoomMessage({
          worldInstanceId: context.worldInstanceId,
          roomId: event.fromLocationId,
          npcId: npc.id,
          npcName: npc.name,
          text: departure,
          sourceEffectId: `${NPC_MOVEMENT_MESSAGE_SOURCE_PREFIX}${context.effectId}:departure`,
        });
        await publishNpcRoomMessage({
          worldInstanceId: context.worldInstanceId,
          roomId: event.toLocationId,
          npcId: npc.id,
          npcName: npc.name,
          text: arrival,
          sourceEffectId: `${NPC_MOVEMENT_MESSAGE_SOURCE_PREFIX}${context.effectId}:arrival`,
        });
      },
    );

    registerEffect(LOCATION_ENTERED_EFFECT, 1, LocationEnteredEffectSchema, async (effect, context) => {
      const location = context.world.locations.find((candidate) => candidate.id === effect.toLocationId);
      for (const npc of location?.npcs ?? []) {
        if (npc.movement) continue;
        if (!npc.announcements?.length) continue;
        const sourceEffectId = effect.arrivalId
          ? `${context.worldInstanceId}:${effect.arrivalId}:${npc.id}`
          : `${context.effectId}:${npc.id}`;
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

      const location = context.world.locations.find((candidate) => candidate.id === playerMessage.roomId);
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

function formatMovementNarrative(template: string, direction: string): string {
  return template.replaceAll('{direction}', direction);
}

function oppositeDirection(direction: string): string {
  const opposites: Record<string, string> = {
    north: 'south',
    south: 'north',
    east: 'west',
    west: 'east',
    up: 'down',
    down: 'up',
  };
  return opposites[direction.toLocaleLowerCase()] ?? direction;
}
