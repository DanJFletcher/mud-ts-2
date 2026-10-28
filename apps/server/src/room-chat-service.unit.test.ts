import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockDb } = vi.hoisted(() => ({
  mockDb: {
    transaction: vi.fn(),
    select: vi.fn(),
  },
}));

vi.mock('./db/client.js', () => ({ db: mockDb }));

import {
  createPlayerRoomChatMessage,
  getRoomChatMessageById,
  getRoomChatMessageBySourceEffectId,
  listRoomChatMessages,
  NPC_MOVEMENT_MESSAGE_SOURCE_PREFIX,
  publishNpcRoomMessage,
} from './room-chat-service.js';
import { ROOM_ANNOUNCEMENT_SOURCE_PREFIX } from '@mudd/core-plugins';
import { PLAYER_ROOM_MESSAGE_EFFECT } from './durable-effect-contracts.js';

function queryResult(rows: unknown[]) {
  const query: Record<string, unknown> = {};
  for (const method of ['from', 'where', 'orderBy']) {
    query[method] = () => query;
  }
  query.limit = async () => rows;
  query.then = (resolve: (value: unknown[]) => unknown, reject: (reason: unknown) => unknown) =>
    Promise.resolve(rows).then(resolve, reject);
  return query;
}

function setTransaction(selectRows: unknown[][], txOverrides: Record<string, unknown> = {}) {
  const rows = [...selectRows];
  const tx = {
    execute: vi.fn(async () => undefined),
    select: vi.fn(() => queryResult(rows.shift() ?? [])),
    ...txOverrides,
  };
  mockDb.transaction.mockImplementation(async (run: (tx: unknown) => Promise<unknown>) => run(tx));
  return tx;
}

function chatRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 10,
    worldInstanceId: 'world-1',
    playerId: 'player-1',
    submissionId: 'submission-1',
    roomId: 'market-square',
    speakerType: 'player',
    speakerId: 'character-1',
    speakerName: 'Rowan',
    message: 'Good morning.',
    sourceEffectId: null,
    createdAt: new Date('2026-10-27T12:34:56.000Z'),
    ...overrides,
  };
}

function authorizedChatReads(messageRows: unknown[]) {
  return [
    [{ id: 'session-1' }],
    [{ id: 'character-1' }],
    [{ revision: 7 }],
    [{
      characterId: 'character-1',
      worldInstanceId: 'world-1',
      locationId: 'market-square',
      revision: 7,
      schemaVersion: 1,
      state: {
        characterId: 'character-1',
        worldInstanceId: 'world-1',
        locationId: 'market-square',
        name: 'Rowan',
        archived: false,
      },
    }],
    ...messageRows,
  ];
}

describe('room-chat-service unit behavior', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('rejects empty and oversized player messages before opening a transaction', async () => {
    const input = {
      worldInstanceId: 'world-1',
      playerId: 'player-1',
      roomId: 'market-square',
      characterId: 'character-1',
      clientMessageId: 'submission-1',
    };

    await expect(createPlayerRoomChatMessage({ ...input, text: ' \n ' }))
      .rejects.toThrow('Room messages must be between 1 and 500 characters.');
    await expect(createPlayerRoomChatMessage({ ...input, text: 'x'.repeat(501) }))
      .rejects.toThrow('Room messages must be between 1 and 500 characters.');
    expect(mockDb.transaction).not.toHaveBeenCalled();
  });

  it('maps message lookups and returns undefined for missing records', async () => {
    mockDb.select.mockReturnValueOnce(queryResult([chatRow()]))
      .mockReturnValueOnce(queryResult([]))
      .mockReturnValueOnce(queryResult([chatRow({
        id: 11,
        speakerType: 'npc',
        speakerId: 'orin-vale',
        speakerName: 'Orin Vale',
        submissionId: null,
        message: 'The river runs high today.',
        sourceEffectId: 'effect-11',
      })]));

    await expect(getRoomChatMessageById(10)).resolves.toEqual({
      id: 10,
      roomId: 'market-square',
      speakerType: 'player',
      speakerName: 'Rowan',
      text: 'Good morning.',
      createdAt: '2026-10-27T12:34:56.000Z',
    });
    await expect(getRoomChatMessageById(999)).resolves.toBeUndefined();
    await expect(getRoomChatMessageBySourceEffectId('effect-11')).resolves.toMatchObject({
      id: 11,
      speakerType: 'npc',
      speakerName: 'Orin Vale',
      text: 'The river runs high today.',
    });
  });

  it('returns the stored NPC message when a source-effect insert is a duplicate', async () => {
    const existing = chatRow({
      id: 12,
      playerId: null,
      submissionId: null,
      speakerType: 'npc',
      speakerId: 'orin-vale',
      speakerName: 'Orin Vale',
      message: 'A familiar greeting.',
      sourceEffectId: 'world-event-12',
    });
    const tx = setTransaction([[existing]], {
      insert: vi.fn(() => ({
        values: () => ({
          onConflictDoNothing: () => ({ returning: async () => [] }),
        }),
      })),
    });

    const result = await publishNpcRoomMessage({
      worldInstanceId: 'world-1',
      roomId: 'market-square',
      npcId: 'orin-vale',
      npcName: 'Orin Vale',
      text: 'A familiar greeting.',
      sourceEffectId: 'world-event-12',
    });

    expect(result).toMatchObject({
      id: 12,
      roomId: 'market-square',
      speakerType: 'npc',
      speakerName: 'Orin Vale',
      text: 'A familiar greeting.',
    });
    expect(tx.execute).toHaveBeenCalledTimes(1);
    expect(tx.insert).toHaveBeenCalledTimes(1);
  });

  it('stops player chat when the session no longer authorizes the character', async () => {
    const tx = setTransaction([[]]);

    const result = await createPlayerRoomChatMessage({
      worldInstanceId: 'world-1',
      playerId: 'player-1',
      roomId: 'market-square',
      characterId: 'character-1',
      clientMessageId: 'submission-1',
      text: 'Hello.',
    });

    expect(result).toEqual({ kind: 'unavailable' });
    expect(tx.select).toHaveBeenCalledTimes(2);
    expect(tx.execute).toHaveBeenCalledTimes(2);
  });

  it('reconciles a matching submission and rejects reuse with different content', async () => {
    const existing = chatRow();
    const tx = setTransaction([[existing], [{ id: 'effect-1' }]]);

    const duplicate = await createPlayerRoomChatMessage({
      worldInstanceId: 'world-1',
      playerId: 'player-1',
      roomId: 'market-square',
      characterId: 'character-1',
      clientMessageId: 'submission-1',
      text: '  Good morning.  ',
    });
    expect(duplicate).toMatchObject({ kind: 'duplicate', effectId: 'effect-1' });
    expect(tx.select).toHaveBeenCalledTimes(2);

    setTransaction([[existing]]);
    const conflict = await createPlayerRoomChatMessage({
      worldInstanceId: 'world-1',
      playerId: 'player-1',
      roomId: 'different-room',
      characterId: 'character-1',
      clientMessageId: 'submission-1',
      text: 'Good morning.',
    });
    expect(conflict).toEqual({ kind: 'conflict' });
  });

  it('separates terminal arrival events from visible room chat during incremental polling', async () => {
    const rows = [
      chatRow({ id: 11, submissionId: 'own-submission' }),
      chatRow({
        id: 12,
        playerId: null,
        submissionId: null,
        speakerType: 'npc',
        speakerId: 'orin-vale',
        speakerName: 'Orin Vale',
        message: 'Orin arrives.',
        sourceEffectId: `${NPC_MOVEMENT_MESSAGE_SOURCE_PREFIX}arrival-1`,
      }),
      chatRow({
        id: 13,
        playerId: null,
        submissionId: null,
        speakerType: 'npc',
        speakerId: 'taren-voss',
        speakerName: 'Taren Voss',
        message: 'Taren leaves.',
        sourceEffectId: `${ROOM_ANNOUNCEMENT_SOURCE_PREFIX}departure-1`,
      }),
      chatRow({
        id: 14,
        playerId: 'player-2',
        submissionId: 'other-submission',
        speakerId: 'character-2',
        speakerName: 'Mira',
        message: 'Hello.',
      }),
    ];
    setTransaction(authorizedChatReads([rows]));

    const result = await listRoomChatMessages({
      worldInstanceId: 'world-1',
      playerId: 'player-1',
      characterId: 'character-1',
      roomId: 'market-square',
      afterId: 10,
    });

    expect(result).toMatchObject({
      messages: [
        { id: 11, submissionId: 'own-submission' },
        { id: 14 },
      ],
      terminalEvents: [{ id: 12 }, { id: 13 }],
      cursor: 14,
    });
    expect(result?.messages[1]).not.toHaveProperty('submissionId');
    expect(result?.terminalEvents[0]).not.toHaveProperty('submissionId');
  });

  it('loads the newest initial page in ascending display order and reports its cursor', async () => {
    const newestFirst = [
      chatRow({ id: 20, message: 'Newest.' }),
      chatRow({ id: 18, message: 'Visible earlier.' }),
    ];
    setTransaction(authorizedChatReads([[{ id: 20 }], newestFirst]));

    const result = await listRoomChatMessages({
      worldInstanceId: 'world-1',
      playerId: 'player-1',
      characterId: 'character-1',
      roomId: 'market-square',
    });

    expect(result).toMatchObject({
      messages: [{ id: 18, text: 'Visible earlier.' }, { id: 20, text: 'Newest.' }],
      terminalEvents: [],
      cursor: 20,
    });
  });
});
