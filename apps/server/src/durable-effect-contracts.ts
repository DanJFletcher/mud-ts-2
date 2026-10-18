import { z } from 'zod';

export const LOCATION_ENTERED_EFFECT = 'world.location.entered';
export const PLAYER_ROOM_MESSAGE_EFFECT = 'room-chat.player-message';

export const LocationEnteredEffectSchema = z.object({
  characterId: z.string().min(1).max(120),
  fromLocationId: z.string().min(1).max(120).optional(),
  toLocationId: z.string().min(1).max(120),
}).strict();

export const PlayerRoomMessageEffectSchema = z.object({
  roomChatMessageId: z.number().int().positive(),
}).strict();
