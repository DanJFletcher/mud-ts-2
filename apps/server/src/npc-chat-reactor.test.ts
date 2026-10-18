import { describe, expect, it, vi } from 'vitest';
import { createNpcRoomChatReactor } from './npc-chat-reactor.js';

const reaction = {
  worldInstanceId: 'world-one',
  roomId: 'mossgate-clearing',
  npcId: 'mara',
  npcName: 'Mara',
  reactions: [
    { keywords: ['marker', 'weathered marker'], response: 'The marker still points east.' },
    { keywords: ['bell tower'], response: 'The bell tower stands east of here.' },
  ],
};

describe('NPC room-chat reactions', () => {
  it('publishes the first authored response whose keyword matches the public message', async () => {
    const publish = vi.fn(async (input: {
      worldInstanceId: string;
      roomId: string;
      npcId: string;
      npcName: string;
      text: string;
    }) => ({
      id: 1,
      roomId: input.roomId,
      speakerType: 'npc' as const,
      speakerName: input.npcName,
      text: input.text,
      createdAt: '2026-10-18T00:00:00.000Z',
    }));
    const react = createNpcRoomChatReactor(publish);

    const published = await react({ ...reaction, playerMessage: 'Does the WEATHERED marker point east?' });

    expect(published).toMatchObject({
      roomId: 'mossgate-clearing',
      speakerType: 'npc',
      speakerName: 'Mara',
      text: 'The marker still points east.',
    });
    expect(publish).toHaveBeenCalledTimes(1);
  });

  it('matches whole words, not substrings, and cools down each NPC within its room', async () => {
    let currentTime = 1_000;
    const publish = vi.fn(async (input: {
      worldInstanceId: string;
      roomId: string;
      npcId: string;
      npcName: string;
      text: string;
    }) => ({
      id: publish.mock.calls.length,
      roomId: input.roomId,
      speakerType: 'npc' as const,
      speakerName: input.npcName,
      text: input.text,
      createdAt: '2026-10-18T00:00:00.000Z',
    }));
    const react = createNpcRoomChatReactor(publish, 30_000, () => currentTime);

    await expect(react({ ...reaction, playerMessage: 'The market is open.' })).resolves.toBeUndefined();
    expect(publish).not.toHaveBeenCalled();

    await react({ ...reaction, playerMessage: 'Tell me about the marker.' });
    currentTime = 30_999;
    await expect(react({ ...reaction, playerMessage: 'The bell tower?' })).resolves.toBeUndefined();
    currentTime = 31_000;
    const nextReaction = await react({ ...reaction, playerMessage: 'The bell tower?' });

    expect(nextReaction?.text).toBe('The bell tower stands east of here.');
    expect(publish).toHaveBeenCalledTimes(2);
  });
});
