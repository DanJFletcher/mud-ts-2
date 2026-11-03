import { describe, expect, it, vi } from 'vitest';
import { useServerHarness, state, announcementState, instanceId } from './server-harness.js';

describe('rooms through the server', () => {
  const harness = useServerHarness();
  const { enterWorld, move, readRoom, sendRoomMessage } = harness;
  it('rejects unauthenticated, unavailable-world, and malformed chat requests', async () => {
    const unauthenticated = await fetch(`${harness.baseUrl}/api/chat?roomId=npc-room`);
    expect(unauthenticated.status).toBe(401);

    const unauthenticatedCommand = await fetch(`${harness.baseUrl}/api/commands`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });
    const unauthenticatedQuery = await fetch(`${harness.baseUrl}/api/queries`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(unauthenticatedCommand.status).toBe(401);
    expect(unauthenticatedQuery.status).toBe(401);

    const unavailableWorld = await fetch(`${harness.baseUrl}/api/chat?roomId=npc-room`, {
      headers: {
        'x-test-user': 'alice',
        'x-mudd-world-instance': 'missing-world',
      },
    });
    expect(unavailableWorld.status).toBe(404);

    const missingRoom = await fetch(`${harness.baseUrl}/api/chat`);
    const malformedRoom = await fetch(`${harness.baseUrl}/api/chat?roomId=npc-room&afterId=not-a-number`, {
      headers: { 'x-test-user': 'alice' },
    });
    expect(missingRoom.status).toBe(401);
    expect(malformedRoom.status).toBe(400);
    expect(await malformedRoom.json()).toEqual({ message: 'Invalid room chat request.' });

    const malformedMessage = await fetch(`${harness.baseUrl}/api/chat`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-test-user': 'alice',
      },
      body: JSON.stringify({ roomId: 'npc-room', clientMessageId: 'invalid-chat', text: '   ' }),
    });
    expect(malformedMessage.status).toBe(400);
    expect(await malformedMessage.json()).toEqual({
      message: 'Enter a message up to 500 characters.',
    });
    expect(state.messages).toEqual([]);
  });

  it('rejects room chat reads and writes for a defeated character', async () => {
    await enterWorld('alice', 'character-alice');
    const character = state.characters['character-alice'];
    const originalHealth = character.health;
    try {
      Object.assign(character, { health: { current: 0 } });

      const read = await fetch(`${harness.baseUrl}/api/chat?roomId=npc-room`, {
        headers: { 'x-test-user': 'alice' },
      });
      const write = await sendRoomMessage(
        'alice',
        'npc-room',
        'Can anyone hear me?',
        'defeated-chat',
      );

      expect(read.status).toBe(409);
      expect(await read.json()).toEqual({
        message: 'Your character has died. Start a new character to begin again.',
      });
      expect(write.status).toBe(409);
      expect(await write.json()).toEqual({
        message: 'Your character has died. Start a new character to begin again.',
      });
    } finally {
      character.health = originalHealth;
    }
  });

  it('maps chat persistence races to room-changed and message-ID-conflict responses', async () => {
    await enterWorld('alice', 'character-alice');

    state.chatSubmitOutcome = 'unavailable';
    const moved = await sendRoomMessage('alice', 'npc-room', 'Still here?', 'moved-during-submit');
    expect(moved.status).toBe(409);
    expect(await moved.json()).toEqual({
      message: 'You have moved to a different room or left the world.',
    });

    state.chatSubmitOutcome = 'conflict';
    const duplicateId = await sendRoomMessage('alice', 'npc-room', 'Different text', 'reused-message-id');
    expect(duplicateId.status).toBe(409);
    expect(await duplicateId.json()).toEqual({
      message: 'This message ID was already used for a different message.',
    });
  });

  it('routes thrown room-chat submissions through the request error handler', async () => {
    await enterWorld('alice', 'character-alice');
    state.chatSubmitError = new Error('Chat persistence failed.');
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      const response = await sendRoomMessage(
        'alice',
        'npc-room',
        'Hello there.',
        'chat-persistence-error',
      );
      expect(response.status).toBe(500);
      expect(await response.json()).toMatchObject({
        message: 'The game server could not complete that request.',
        requestId: response.headers.get('x-request-id'),
      });
      expect(errorLog).toHaveBeenCalledOnce();
    } finally {
      state.chatSubmitError = null;
      errorLog.mockRestore();
    }
  });

  it('requires an active world character and rejects chat requests for another room', async () => {
    const missingReadSession = await fetch(`${harness.baseUrl}/api/chat?roomId=npc-room`, {
      headers: { 'x-test-user': 'alice' },
    });
    const missingWriteSession = await sendRoomMessage('alice', 'npc-room', 'Hello.', 'no-world-session');
    const missingInteractionSession = await fetch(`${harness.baseUrl}/api/interactions`, {
      headers: { 'x-test-user': 'alice' },
    });
    expect(missingReadSession.status).toBe(409);
    expect(missingWriteSession.status).toBe(409);
    expect(missingInteractionSession.status).toBe(409);

    await enterWorld('alice', 'character-alice');
    const messagesBeforeWrongRoomRequests = state.messages.length;
    const wrongRoomRead = await readRoom('alice', 'other-room');
    const wrongRoomWrite = await sendRoomMessage('alice', 'other-room', 'Hello.', 'wrong-room-chat');
    expect(wrongRoomRead.response.status).toBe(409);
    expect(wrongRoomWrite.status).toBe(409);
    expect(state.messages).toHaveLength(messagesBeforeWrongRoomRequests);
  });

  it('routes NPC movement announcements to terminal updates instead of room chat', async () => {
    await enterWorld('alice', 'character-alice');
    const initial = await readRoom('alice', 'npc-room');
    expect(initial.response.status).toBe(200);
    expect(initial.body.messages?.some((message) => message.text.includes('heads south'))).toBe(false);

    const { publishNpcRoomMessage } = await import('../../rooms/room-chat-service.js');
    const movementNotice = await publishNpcRoomMessage({
      worldInstanceId: instanceId,
      roomId: 'npc-room',
      npcId: 'mossgate-wandering-villager',
      npcName: 'Wandering Villager',
      text: 'A villager heads south, hands clasped behind their back.',
      sourceEffectId: 'world-npc-movement:test-effect:departure',
    });
    const arrivalNotice = await publishNpcRoomMessage({
      worldInstanceId: instanceId,
      roomId: 'npc-room',
      npcId: 'mossgate-patrolling-guard',
      npcName: 'Patrolling Guard',
      text: 'A town guard enters from the north, eyes alert.',
      sourceEffectId: 'world-npc-movement:test-effect:arrival',
    });
    const update = await readRoom('alice', 'npc-room', initial.body.cursor);
    expect(update.response.status).toBe(200);
    expect(update.body.messages).toEqual([]);
    expect(update.body.terminalEvents).toEqual([
      expect.objectContaining({
        id: movementNotice.id,
        speakerName: 'Wandering Villager',
        text: 'A villager heads south, hands clasped behind their back.',
      }),
      expect.objectContaining({
        id: arrivalNotice.id,
        speakerName: 'Patrolling Guard',
        text: 'A town guard enters from the north, eyes alert.',
      }),
    ]);
  });

  it('lets an NPC answer a matching public room message and shares the reply with room occupants', async () => {
    await enterWorld('alice', 'character-alice');
    await enterWorld('bob', 'character-bob');

    const unmatched = await sendRoomMessage('alice', 'npc-room', 'Good morning.');
    expect(unmatched.status).toBe(201);
    expect((await unmatched.json() as { npcMessage?: unknown; }).npcMessage).toBeUndefined();

    const matching = await sendRoomMessage('alice', 'npc-room', 'Where is the marker?', 'matching-marker-question');
    expect(matching.status).toBe(201);
    const matchingBody = await matching.json() as {
      message?: { speakerType: string; text: string; };
      npcMessage?: { speakerType: string; speakerName: string; text: string; roomId: string; };
    };
    expect(matchingBody.message).toMatchObject({ speakerType: 'player', text: 'Where is the marker?' });
    expect(matchingBody.npcMessage).toMatchObject({
      speakerType: 'npc',
      speakerName: 'Mara',
      text: 'The marker still points east.',
      roomId: 'npc-room',
    });
    const matchingRetry = await sendRoomMessage(
      'alice',
      'npc-room',
      'Where is the marker?',
      'matching-marker-question',
    );
    expect(matchingRetry.status).toBe(200);
    expect((await matchingRetry.json() as { npcMessage?: unknown; }).npcMessage).toBeUndefined();
    expect(state.messages.filter((message) => message.speakerType === 'player')).toHaveLength(2);
    expect(state.messages.filter((message) =>
      message.speakerType === 'npc' && message.message === 'The marker still points east.',
    )).toHaveLength(1);
    const reusedSubmissionId = await sendRoomMessage(
      'alice',
      'npc-room',
      'A different message',
      'matching-marker-question',
    );
    expect(reusedSubmissionId.status).toBe(409);

    const bobChat = await readRoom('bob', 'npc-room');
    expect(bobChat.body.messages).toContainEqual(expect.objectContaining({
      speakerType: 'npc',
      speakerName: 'Mara',
      text: 'The marker still points east.',
    }));

    const repeated = await sendRoomMessage('bob', 'npc-room', 'The marker?');
    expect(repeated.status).toBe(201);
    expect((await repeated.json() as { npcMessage?: unknown; }).npcMessage).toBeUndefined();
    expect(bobChat.body.messages?.filter((message) =>
      message.speakerType === 'npc' &&
      message.speakerName === 'Mara' &&
      message.text === 'The marker still points east.',
    )).toHaveLength(1);
  });

  it('rejects cross-origin state-changing requests before they mutate room chat', async () => {
    await enterWorld('alice', 'character-alice');
    const messageCountBeforeRequest = state.messages.length;
    const response = await fetch(`${harness.baseUrl}/api/chat`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: 'https://attacker.example',
        'x-test-user': 'alice',
      },
      body: JSON.stringify({ roomId: 'npc-room', text: 'forged message' }),
    });

    expect(response.status).toBe(403);
    expect(state.messages).toHaveLength(messageCountBeforeRequest);
  });

  it('announces on successful movement into an NPC room and applies the arrival cooldown', async () => {
    await enterWorld('mover', 'character-mover');
    expect(state.messages).toEqual([]);

    const arrival = await move('mover', 'character-mover', 'to-arrival-room');
    expect(arrival.status).toBe(200);
    const arrivalChat = await readRoom('mover', 'arrival-room');
    expect(arrivalChat.body.messages).toEqual([expect.objectContaining({
      speakerType: 'npc',
      speakerName: 'Mara',
      text: 'The north bridge is open.',
      roomId: 'arrival-room',
    })]);

    expect((await move('mover', 'character-mover', 'back-to-entry')).status).toBe(200);
    expect((await move('mover', 'character-mover', 'to-arrival-room')).status).toBe(200);
    expect(state.messages).toHaveLength(1);
  });

  it('does not announce when movement enters a room without an announcing NPC', async () => {
    await enterWorld('mover', 'character-mover');

    const arrival = await move('mover', 'character-mover', 'to-quiet-room');
    expect(arrival.status).toBe(200);
    const quietChat = await readRoom('mover', 'quiet-room');

    expect(quietChat.response.status).toBe(200);
    expect(quietChat.body.messages).toEqual([]);
    expect(state.messages).toEqual([]);
  });

  it('does not re-run NPC entry effects for a successful idempotent movement retry', async () => {
    await enterWorld('mover', 'character-mover');
    const commandId = 'same-move-retried';

    expect((await move('mover', 'character-mover', 'to-arrival-room', commandId)).status).toBe(200);
    expect(announcementState.attempts).toBe(1);

    expect((await move('mover', 'character-mover', 'to-arrival-room', commandId)).status).toBe(200);

    expect(announcementState.attempts).toBe(1);
  });

  it('deduplicates NPC announcements for a shared party arrival', async () => {
    const handler = state.effectHandlers.get('world.location.entered');
    expect(handler).toBeDefined();
    const arrivalId = 'team-road:shared-ambush';
    for (const [characterId, effectId] of [
      ['character-alice', 'party-arrival-alice'],
      ['character-bob', 'party-arrival-bob'],
    ]) {
      await handler?.(
        {
          characterId,
          fromLocationId: 'entry-room',
          toLocationId: 'arrival-room',
          arrivalId,
        },
        {
          effectId,
          worldInstanceId: instanceId,
          sourceStreamId: characterId,
          causationCommandId: effectId,
          world: state.world,
        },
      );
    }

    expect(announcementState.attempts).toBe(1);
    expect(state.messages.filter((message) =>
      message.roomId === 'arrival-room' && message.speakerType === 'npc',
    )).toHaveLength(1);
  });
});
