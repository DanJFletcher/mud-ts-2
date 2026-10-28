import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getRoomChatMessageById, getRoomChatMessageBySourceEffectId, publishNpcRoomMessage } = vi.hoisted(() => ({
  getRoomChatMessageById: vi.fn(),
  getRoomChatMessageBySourceEffectId: vi.fn(),
  publishNpcRoomMessage: vi.fn(),
}));

vi.mock('./room-chat-service.js', () => ({
  getRoomChatMessageById,
  getRoomChatMessageBySourceEffectId,
  publishNpcRoomMessage,
  NPC_MOVEMENT_MESSAGE_SOURCE_PREFIX: 'world-npc-movement:',
}));

import {
  ROOM_ANNOUNCEMENT_EFFECT,
  ROOM_ANNOUNCEMENT_SOURCE_PREFIX,
} from '@mudd/core-plugins';
import {
  LOCATION_ENTERED_EFFECT,
  PLAYER_ROOM_MESSAGE_EFFECT,
} from './durable-effect-contracts.js';
import { worldEventEffectsPlugin } from './demo-event-effects-plugin.js';

type Handler = (effect: Record<string, unknown>, context: Record<string, unknown>) => Promise<void>;

function registeredHandlers() {
  const effects = new Map<string, Handler>();
  const events = new Map<string, Handler>();
  worldEventEffectsPlugin.register?.({
    registerEffect: (type: string, _version: number, _schema: unknown, handler: Handler) => effects.set(type, handler),
    registerEventHandler: (type: string, _version: number, _schema: unknown, handler: Handler) => events.set(type, handler),
  } as never);
  return { effects, events };
}

describe('world event effects plugin', () => {
  beforeEach(() => {
    getRoomChatMessageById.mockReset();
    getRoomChatMessageBySourceEffectId.mockReset();
    publishNpcRoomMessage.mockReset();
    publishNpcRoomMessage.mockResolvedValue({ id: 1 });
  });

  it('publishes authored room announcements with an event-scoped deduplication key', async () => {
    const handler = registeredHandlers().effects.get(ROOM_ANNOUNCEMENT_EFFECT);
    if (!handler) throw new Error('Room-announcement effect was not registered.');

    await handler(
      { locationId: 'market-square', message: 'The bell rings.' },
      { worldInstanceId: 'world-one', effectId: 'effect-one' },
    );

    expect(publishNpcRoomMessage).toHaveBeenCalledWith({
      worldInstanceId: 'world-one',
      roomId: 'market-square',
      npcId: 'room:market-square',
      npcName: 'The room',
      text: 'The bell rings.',
      sourceEffectId: `${ROOM_ANNOUNCEMENT_SOURCE_PREFIX}effect-one`,
    });
  });

  it('skips missing NPC movement events and derives the reverse direction when needed', async () => {
    const handler = registeredHandlers().events.get('world.npc.moved');
    if (!handler) throw new Error('NPC movement handler was not registered.');
    const context = {
      worldInstanceId: 'world-one',
      effectId: 'movement-one',
      world: {
        locations: [
          { id: 'from-room', npcs: [{ id: 'walker', name: 'A Walker' }], exits: [] },
          { id: 'to-room', npcs: [], exits: [] },
        ],
      },
    };

    await handler(
      { npcId: 'missing', fromLocationId: 'from-room', toLocationId: 'to-room', direction: 'north' },
      context,
    );
    expect(publishNpcRoomMessage).not.toHaveBeenCalled();

    await handler(
      { npcId: 'walker', fromLocationId: 'from-room', toLocationId: 'to-room', direction: 'north' },
      context,
    );
    expect(publishNpcRoomMessage).toHaveBeenNthCalledWith(1, expect.objectContaining({
      roomId: 'from-room',
      text: 'leaves toward the north.',
    }));
    expect(publishNpcRoomMessage).toHaveBeenNthCalledWith(2, expect.objectContaining({
      roomId: 'to-room',
      text: 'enters from the south.',
    }));
  });

  it('announces stationary NPCs once when a character arrives in their room', async () => {
    getRoomChatMessageBySourceEffectId
      .mockResolvedValueOnce({ id: 1 })
      .mockResolvedValueOnce(undefined);
    const handler = registeredHandlers().effects.get(LOCATION_ENTERED_EFFECT);
    if (!handler) throw new Error('Location-entered effect was not registered.');

    await handler(
      { toLocationId: 'market-square', arrivalId: 'arrival-one' },
      {
        worldInstanceId: 'world-one',
        effectId: 'effect-one',
        world: {
          locations: [{
            id: 'market-square',
            npcs: [
              { id: 'walker', name: 'Walker', movement: {}, announcements: ['Moving.'] },
              { id: 'silent', name: 'Silent' },
              { id: 'already-announced', name: 'Already Announced', announcements: ['Already here.'] },
              { id: 'seller', name: 'Seller', announcements: ['Fresh bread is ready.'] },
            ],
          }],
        },
      },
    );

    expect(getRoomChatMessageBySourceEffectId).toHaveBeenCalledTimes(2);
    expect(publishNpcRoomMessage).toHaveBeenCalledOnce();
    expect(publishNpcRoomMessage).toHaveBeenCalledWith(expect.objectContaining({
      npcId: 'seller',
      text: 'Fresh bread is ready.',
      sourceEffectId: 'world-one:arrival-one:seller',
    }));
  });

  it('ignores missing, NPC-authored, and duplicate chat effects before reacting', async () => {
    const handler = registeredHandlers().effects.get(PLAYER_ROOM_MESSAGE_EFFECT);
    if (!handler) throw new Error('Player-chat effect was not registered.');
    const context = {
      worldInstanceId: 'world-one',
      effectId: 'chat-effect-one',
      world: { locations: [{ id: 'market-square', npcs: [] }] },
    };
    getRoomChatMessageById.mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce({ id: 2, speakerType: 'npc' })
      .mockResolvedValueOnce({
        id: 3,
        speakerType: 'player',
        roomId: 'market-square',
        text: 'The bell tower?',
      });
    getRoomChatMessageBySourceEffectId.mockResolvedValueOnce({ id: 4 });

    await handler({ roomChatMessageId: 1 }, context);
    await handler({ roomChatMessageId: 2 }, context);
    await handler({ roomChatMessageId: 3 }, context);

    expect(getRoomChatMessageById).toHaveBeenCalledTimes(3);
    expect(getRoomChatMessageBySourceEffectId).toHaveBeenCalledOnce();
    expect(publishNpcRoomMessage).not.toHaveBeenCalled();
  });

  it('skips NPCs without reactions and publishes the first matching response', async () => {
    getRoomChatMessageById.mockResolvedValue({
      id: 3,
      speakerType: 'player',
      roomId: 'market-square',
      text: 'Does the marker point east?',
    });
    getRoomChatMessageBySourceEffectId.mockResolvedValue(undefined);
    const handler = registeredHandlers().effects.get(PLAYER_ROOM_MESSAGE_EFFECT);
    if (!handler) throw new Error('Player-chat effect was not registered.');

    await handler(
      { roomChatMessageId: 3 },
      {
        worldInstanceId: 'world-one',
        effectId: 'chat-effect-two',
        world: {
          locations: [{
            id: 'market-square',
            npcs: [
              { id: 'silent', name: 'Silent' },
              {
                id: 'mara',
                name: 'Mara',
                roomChatReactions: [{ keywords: ['marker'], response: 'The marker points east.' }],
              },
              { id: 'later', name: 'Later', roomChatReactions: [{ keywords: ['marker'], response: 'Second reply.' }] },
            ],
          }],
        },
      },
    );

    expect(publishNpcRoomMessage).toHaveBeenCalledOnce();
    expect(publishNpcRoomMessage).toHaveBeenCalledWith(expect.objectContaining({
      npcId: 'mara',
      text: 'The marker points east.',
      sourceEffectId: 'chat-effect-two',
    }));
  });
});
