import type { RoomPresenceCandidate } from './room-presence-projection.js';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const databaseState = vi.hoisted(() => ({
  selectedRows: [] as unknown[],
  updateRows: [] as unknown[],
  updateValues: null as unknown,
  orderByCalls: 0,
}));

vi.mock('./db/client.js', () => ({
  db: {
    update: () => ({
      set: (values: unknown) => {
        databaseState.updateValues = values;
        return {
          where: () => ({
            returning: () => Promise.resolve(databaseState.updateRows),
          }),
        };
      },
    }),
    select: () => ({
      from: () => ({
        innerJoin: () => ({
          where: () => {
            const result = Promise.resolve(databaseState.selectedRows);
            return Object.assign(result, {
              orderBy: () => {
                databaseState.orderByCalls += 1;
                return result;
              },
            });
          },
        }),
      }),
    }),
  },
}));

const now = new Date('2026-10-28T12:00:00.000Z');
const worldInstanceId = 'world-a';
const locationId = 'room-a';

type ActiveCandidate = RoomPresenceCandidate & { playerId: string };

function candidate(options: Readonly<{
  playerId?: string;
  characterId: string;
  worldInstanceId?: string;
  lastSeenAt?: Date;
  character?: RoomPresenceCandidate['character'];
}>): ActiveCandidate {
  const candidateWorldId = options.worldInstanceId ?? worldInstanceId;
  const character = 'character' in options
    ? options.character
    : {
      worldInstanceId: candidateWorldId,
      characterId: options.characterId,
      name: options.characterId,
      locationId,
      archived: false,
    };
  return {
    playerId: options.playerId ?? `player-${options.characterId}`,
    worldInstanceId: candidateWorldId,
    characterId: options.characterId,
    lastSeenAt: options.lastSeenAt ?? now,
    character,
  };
}

async function loadService() {
  vi.resetModules();
  return import('./room-presence-service.js');
}

beforeEach(() => {
  databaseState.selectedRows = [];
  databaseState.updateRows = [];
  databaseState.updateValues = null;
  databaseState.orderByCalls = 0;
});

describe('room presence service', () => {
  it('updates only when the session row is returned', async () => {
    const { touchWorldSessionPresence } = await loadService();
    const heartbeat = new Date('2026-10-28T12:00:30.000Z');

    databaseState.updateRows = [{ id: 'session-a' }];
    expect(await touchWorldSessionPresence(
      'player-a',
      worldInstanceId,
      'session-a',
      heartbeat,
    )).toBe(true);
    expect(databaseState.updateValues).toEqual({ lastSeenAt: heartbeat });

    databaseState.updateRows = [];
    expect(await touchWorldSessionPresence(
      'player-a',
      worldInstanceId,
      'missing-session',
      heartbeat,
    )).toBe(false);
  });

  it('projects only current occupants from the queried room candidates', async () => {
    const { listRoomOccupants } = await loadService();
    databaseState.selectedRows = [
      candidate({ characterId: 'self' }),
      candidate({ characterId: 'rowan', character: {
        worldInstanceId,
        characterId: 'rowan',
        name: 'Rowan',
        locationId,
        archived: false,
      } }),
      candidate({ characterId: 'elsewhere', character: {
        worldInstanceId,
        characterId: 'elsewhere',
        name: 'Elsewhere',
        locationId: 'room-b',
        archived: false,
      } }),
      candidate({
        characterId: 'stale',
        lastSeenAt: new Date(now.getTime() - 90_001),
      }),
      candidate({
        characterId: 'wrong-world',
        worldInstanceId: 'world-b',
      }),
      candidate({
        characterId: 'archived',
        character: {
          worldInstanceId,
          characterId: 'archived',
          name: 'Archived',
          locationId,
          archived: true,
        },
      }),
    ];

    const occupants = await listRoomOccupants(
      { readStream: vi.fn() },
      worldInstanceId,
      locationId,
      'self',
      now,
    );
    expect(occupants).toEqual([{ id: 'rowan', displayName: 'Rowan' }]);
  });

  it('returns the newest eligible character for each active player', async () => {
    const { listActiveRoomCharacters } = await loadService();
    databaseState.selectedRows = [
      candidate({ playerId: 'player-a', characterId: 'newest' }),
      candidate({ playerId: 'player-a', characterId: 'older' }),
      candidate({
        playerId: 'player-b',
        characterId: 'boundary',
        lastSeenAt: new Date(now.getTime() - 90_000),
      }),
      candidate({
        playerId: 'player-c',
        characterId: 'stale',
        lastSeenAt: new Date(now.getTime() - 90_001),
      }),
      candidate({ playerId: 'player-d', characterId: 'missing', character: undefined }),
      candidate({
        playerId: 'player-e',
        characterId: 'wrong-world',
        character: {
          worldInstanceId: 'world-b',
          characterId: 'wrong-world',
          name: 'Wrong World',
          locationId,
          archived: false,
        },
      }),
      candidate({
        playerId: 'player-f',
        characterId: 'mismatched-id',
        character: {
          worldInstanceId,
          characterId: 'different-character',
          name: 'Mismatched',
          locationId,
          archived: false,
        },
      }),
      candidate({
        playerId: 'player-g',
        characterId: 'wrong-room',
        character: {
          worldInstanceId,
          characterId: 'wrong-room',
          name: 'Wrong Room',
          locationId: 'room-b',
          archived: false,
        },
      }),
      candidate({
        playerId: 'player-h',
        characterId: 'archived',
        character: {
          worldInstanceId,
          characterId: 'archived',
          name: 'Archived',
          locationId,
          archived: true,
        },
      }),
      candidate({
        playerId: 'player-i',
        characterId: 'defeated',
        character: {
          worldInstanceId,
          characterId: 'defeated',
          name: 'Defeated',
          locationId,
          archived: false,
          combat: { status: 'defeat' },
        },
      }),
      candidate({
        playerId: 'player-j',
        characterId: 'fighting',
        character: {
          worldInstanceId,
          characterId: 'fighting',
          name: 'Fighting',
          locationId,
          archived: false,
          combat: { status: 'active' },
        },
      }),
      candidate({
        playerId: 'player-k',
        characterId: 'dead',
        character: {
          worldInstanceId,
          characterId: 'dead',
          name: 'Dead',
          locationId,
          archived: false,
          health: { current: 0, maximum: 10 },
        },
      }),
    ];

    expect(await listActiveRoomCharacters(
      { readStream: vi.fn() },
      worldInstanceId,
      locationId,
      now,
    )).toEqual([
      { playerId: 'player-a', characterId: 'newest', displayName: 'newest' },
      { playerId: 'player-b', characterId: 'boundary', displayName: 'boundary' },
    ]);
    expect(databaseState.orderByCalls).toBe(1);
  });
});
