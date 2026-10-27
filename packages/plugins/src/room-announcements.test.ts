import { describe, expect, it } from 'vitest';
import {
  ROOM_ANNOUNCEMENT_EFFECT,
  ROOM_ANNOUNCEMENT_SOURCE_PREFIX,
  RoomAnnouncementEffectSchema,
  roomAnnouncementEffect,
} from './room-announcements.js';

describe('room announcements', () => {
  it('builds a validated room-scoped announcement effect', () => {
    expect(ROOM_ANNOUNCEMENT_EFFECT).toBe('mudd.world.room_announcement');
    expect(ROOM_ANNOUNCEMENT_SOURCE_PREFIX).toBe('world-room-announcement:');
    expect(roomAnnouncementEffect('bellwold-market', '  Taren arrives.  ')).toEqual({
      type: ROOM_ANNOUNCEMENT_EFFECT,
      version: 1,
      payload: { locationId: 'bellwold-market', message: 'Taren arrives.' },
    });
  });

  it('rejects missing, blank, oversized, or unexpected announcement data', () => {
    expect(() => roomAnnouncementEffect('', 'Someone arrives.')).toThrow();
    expect(() => roomAnnouncementEffect('room', '   ')).toThrow();
    expect(() => roomAnnouncementEffect('room', 'x'.repeat(501))).toThrow();
    expect(RoomAnnouncementEffectSchema.safeParse({
      locationId: 'room',
      message: 'Someone arrives.',
      unexpected: true,
    }).success).toBe(false);
  });
});
