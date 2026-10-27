import { z } from 'zod';
import type { ProposedEventEffect } from '@mudd/engine-core';

export const ROOM_ANNOUNCEMENT_EFFECT = 'mudd.world.room_announcement';
export const ROOM_ANNOUNCEMENT_SOURCE_PREFIX = 'world-room-announcement:';
export const RoomAnnouncementEffectSchema = z.object({
  locationId: z.string().min(1).max(128),
  message: z.string().trim().min(1).max(500),
}).strict();

export function roomAnnouncementEffect(locationId: string, message: string): ProposedEventEffect {
  return {
    type: ROOM_ANNOUNCEMENT_EFFECT,
    version: 1,
    payload: RoomAnnouncementEffectSchema.parse({ locationId, message }),
  };
}
