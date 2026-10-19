import { describe, expect, it } from 'vitest';
import type { CharacterProjection } from '@mudd/contracts';
import { projectRoomOccupants, ROOM_PRESENCE_TTL_MS } from './room-presence-projection.js';

const now = new Date('2026-10-19T12:00:00.000Z');

function candidate(options: Readonly<{
  id: string;
  name?: string;
  locationId?: string;
  worldInstanceId?: string;
  lastSeenAt?: Date;
  archived?: boolean;
  health?: CharacterProjection['health'];
  combat?: CharacterProjection['combat'];
}>): Parameters<typeof projectRoomOccupants>[0]['candidates'][number] {
  const worldInstanceId = options.worldInstanceId ?? 'world-a';
  return {
    worldInstanceId,
    characterId: options.id,
    lastSeenAt: options.lastSeenAt ?? new Date(now.getTime() - 30_000),
    character: {
      worldInstanceId,
      characterId: options.id,
      name: options.name ?? options.id,
      locationId: options.locationId ?? 'room-a',
      archived: options.archived ?? false,
      ...(options.health ? { health: options.health } : {}),
      ...(options.combat ? { combat: options.combat } : {}),
    },
  };
}

describe('room presence projection', () => {
  it('lists only fresh, living characters in the same room and world, excluding the viewer', () => {
    const occupants = projectRoomOccupants({
      candidates: [
        candidate({ id: 'char-z', name: 'Willow' }),
        candidate({ id: 'char-a', name: 'Alder' }),
        candidate({ id: 'self' }),
        candidate({ id: 'away', locationId: 'room-b' }),
        candidate({ id: 'other-world', worldInstanceId: 'world-b' }),
        candidate({
          id: 'stale',
          lastSeenAt: new Date(now.getTime() - ROOM_PRESENCE_TTL_MS - 1),
        }),
        candidate({ id: 'archived', archived: true }),
        candidate({ id: 'dead', health: { current: 0, maximum: 10 } }),
      ],
      worldInstanceId: 'world-a',
      locationId: 'room-a',
      viewerCharacterId: 'self',
      now,
    });

    expect(occupants).toEqual([
      { id: 'char-a', displayName: 'Alder' },
      { id: 'char-z', displayName: 'Willow' },
    ]);
  });

  it('keeps a heartbeat exactly at the 90-second boundary online', () => {
    const occupants = projectRoomOccupants({
      candidates: [
        candidate({
          id: 'boundary',
          lastSeenAt: new Date(now.getTime() - ROOM_PRESENCE_TTL_MS),
        }),
      ],
      worldInstanceId: 'world-a',
      locationId: 'room-a',
      viewerCharacterId: 'self',
      now,
    });

    expect(occupants).toEqual([{ id: 'boundary', displayName: 'boundary' }]);
  });
});
