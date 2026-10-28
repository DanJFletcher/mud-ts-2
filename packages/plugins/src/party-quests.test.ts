import { describe, expect, it, vi } from 'vitest';
import type { StoredGameEvent } from '@mudd/engine-core';
import { partyQuestPlugin, partyQuestStreamId } from './party-quests.js';

const worldId = 'party-quest-test-world';
const partyId = 'party-one';
const playerId = 'player-one';
const questId = 'road-watch';
const now = new Date('2026-10-27T12:00:00.000Z');
const quest = {
  id: questId,
  version: '1',
  title: 'Road Watch',
  summary: 'Help keep the road safe.',
  scope: 'party',
  giverNpcId: 'captain',
  turnInNpcId: 'captain',
  objectives: [
    { id: 'visit', label: 'Reach the track.', type: 'visit-location', locationId: 'track' },
    { id: 'read', label: 'Read the marker.', type: 'read-object', objectId: 'marker', locationId: 'track' },
    { id: 'interact', label: 'Open the gate.', type: 'perform-interaction', interactionId: 'gate', locationId: 'track' },
    { id: 'defeat', label: 'Defeat two bandits.', type: 'defeat-npc', npcId: 'bandit', requiredCount: 2 },
  ],
};

function storedEvent(
  streamId: string,
  type: string,
  payload: Record<string, unknown>,
  revision: number,
): StoredGameEvent {
  return {
    eventId: `${streamId}:${revision}`,
    worldInstanceId: worldId,
    aggregateId: streamId,
    streamId,
    aggregateVersion: revision,
    type,
    version: 1,
    payload,
    causationCommandId: `command-${revision}`,
    actorId: 'system',
    occurredAt: now.toISOString(),
    tick: revision,
  } as unknown as StoredGameEvent;
}

function startingEvent() {
  return storedEvent(partyQuestStreamId(partyId), 'party.quest_started', {
    partyId,
    questId,
    definitionVersion: '1',
    startedByPlayerId: playerId,
    startedAt: now.toISOString(),
  }, 1);
}

function harness(options: {
  party?: { groupId: string };
  history?: readonly StoredGameEvent[];
  groups?: Array<Record<string, unknown>>;
  quests?: Array<typeof quest>;
  receiptOk?: boolean;
} = {}) {
  const commands = new Map<string, (command: any, context: any) => Promise<unknown>>();
  const queries = new Map<string, (_query: any, context: any) => Promise<unknown>>();
  const handlers = new Map<string, (payload: any, context: any) => Promise<void>>();
  const history = [...(options.history ?? [])];
  const append = vi.fn(async (request: any) => {
    const existing = history.length;
    request.events.forEach((event: any, index: number) => {
      history.push(storedEvent(
        request.streamId,
        event.type,
        event.payload,
        existing + index + 1,
      ));
    });
    return { receipt: { ok: options.receiptOk ?? true } };
  });
  partyQuestPlugin.register({
    registerCommand: (name: string, _schema: unknown, handler: unknown) => {
      commands.set(name, handler as (command: any, context: any) => Promise<unknown>);
    },
    registerQuery: (name: string, _schema: unknown, handler: unknown) => {
      queries.set(name, handler as (_query: any, context: any) => Promise<unknown>);
    },
    registerEventHandler: (type: string, version: number, _schema: unknown, handler: unknown) => {
      handlers.set(`${type}@${version}`, handler as (payload: any, context: any) => Promise<void>);
    },
    requireCapability: (token: { id: string }) => {
      if (token.id === 'mudd.party.state.v1') {
        return { activePartyForPlayer: vi.fn(async () => options.party) };
      }
      if (token.id === 'mudd.groups.state.v1') {
        return { load: vi.fn(async () => ({ groups: options.groups ?? [] })) };
      }
      throw new Error(`Unexpected capability ${token.id}`);
    },
  } as never);
  const context = {
    worldInstanceId: worldId,
    world: {
      quests: options.quests ?? [quest],
      locations: [{
        id: 'road',
        npcs: [{ id: 'bandit', combatProfile: { health: 4 } }],
      }],
    },
    session: { playerId },
    now: () => now,
    effectId: 'effect-1',
    actorId: playerId,
    store: {
      readStream: vi.fn(async () => history),
      lookupCommand: vi.fn(async () => undefined),
      append,
    },
  };
  return { commands, queries, handlers, history, append, context };
}

const activePartyGroup = {
  groupId: partyId,
  groupType: 'party',
  status: 'active',
  members: [{ playerId, characterId: 'character-one', displayName: 'Traveler' }],
};

describe('party quest commands and journal', () => {
  it('starts a party quest and rejects unavailable or duplicate requests', async () => {
    const noParty = harness();
    await expect(noParty.commands.get('party.quest.start')!({
      payload: { questId },
    }, noParty.context)).rejects.toThrow('Join or create a party');

    const withParty = harness({ party: { groupId: partyId } });
    const command = { payload: { questId } };
    const result = await withParty.commands.get('party.quest.start')!(command, withParty.context);
    expect(result).toMatchObject({
      streamId: partyQuestStreamId(partyId),
      expectedVersion: 0,
      events: [expect.objectContaining({
        type: 'party.quest_started',
        payload: expect.objectContaining({ questId, partyId, startedByPlayerId: playerId }),
      })],
    });
    await expect(withParty.commands.get('party.quest.start')!({
      payload: { questId: 'unknown-quest' },
    }, withParty.context)).rejects.toThrow('not an available party quest');

    const missingOpponent = harness({
      party: { groupId: partyId },
      quests: [{
        ...quest,
        objectives: [{
          id: 'defeat-ghost',
          label: 'Defeat the ghost.',
          type: 'defeat-npc',
          npcId: 'missing-opponent',
          requiredCount: 1,
        }],
      }],
    });
    await expect(missingOpponent.commands.get('party.quest.start')!(command, missingOpponent.context))
      .rejects.toThrow('unavailable opponent');

    const duplicate = harness({ party: { groupId: partyId }, history: [startingEvent()] });
    await expect(duplicate.commands.get('party.quest.start')!(command, duplicate.context))
      .rejects.toThrow('already started or completed');
  });

  it('returns available quests without a party and progress from the active party', async () => {
    const noParty = harness();
    await expect(noParty.queries.get('party.quests')!({}, noParty.context)).resolves.toEqual({
      partyId: null,
      available: [],
      quests: [],
    });

    const withParty = harness({
      party: { groupId: partyId },
      history: [
        startingEvent(),
        storedEvent(partyQuestStreamId(partyId), 'party.quest_objective_progressed', {
          partyId,
          questId,
          objectiveId: 'visit',
          progress: 1,
          sourceEffectId: 'move-1',
        }, 2),
      ],
    });
    const journal = await withParty.queries.get('party.quests')!({}, withParty.context) as any;
    expect(journal).toMatchObject({ partyId, available: [], quests: [{ questId, status: 'active' }] });
    expect(journal.quests[0].objectives).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'visit', progress: 1, required: 1, completed: true }),
      expect.objectContaining({ id: 'defeat', progress: 0, required: 2, completed: false }),
    ]));

    const available = harness({ party: { groupId: partyId } });
    await expect(available.queries.get('party.quests')!({}, available.context)).resolves.toMatchObject({
      available: [{ questId, title: 'Road Watch' }],
      quests: [],
    });

    const changedDefinition = harness({
      party: { groupId: partyId },
      history: [startingEvent()],
      quests: [{ ...quest, version: '2' }],
    });
    await expect(changedDefinition.queries.get('party.quests')!({}, changedDefinition.context))
      .rejects.toThrow('Party quest definition road-watch@1 is unavailable.');
  });

  it('rejects foreign-party, unstarted, and unsupported quest history events', async () => {
    const startedPayload = {
      partyId: 'another-party',
      questId,
      definitionVersion: '1',
      startedByPlayerId: playerId,
      startedAt: now.toISOString(),
    };
    const invalidHistories = [
      {
        events: [storedEvent(partyQuestStreamId(partyId), 'party.quest_started', startedPayload, 1)],
        message: 'for another party',
      },
      {
        events: [storedEvent(partyQuestStreamId(partyId), 'party.quest_started', {
          ...startedPayload,
          partyId,
          questId: 'missing-quest',
        }, 1)],
        message: 'definition missing-quest@1 is unavailable',
      },
      {
        events: [storedEvent(partyQuestStreamId(partyId), 'party.quest_objective_progressed', {
          partyId: 'another-party',
          questId,
          objectiveId: 'visit',
          progress: 1,
          sourceEffectId: 'move-1',
        }, 1)],
        message: 'for another party',
      },
      {
        events: [storedEvent(partyQuestStreamId(partyId), 'party.quest_objective_progressed', {
          partyId,
          questId,
          objectiveId: 'visit',
          progress: 1,
          sourceEffectId: 'move-1',
        }, 1)],
        message: 'progress has no matching start event',
      },
      {
        events: [storedEvent(partyQuestStreamId(partyId), 'party.quest_completed', {
          partyId: 'another-party',
          questId,
          completedAt: now.toISOString(),
        }, 1)],
        message: 'for another party',
      },
      {
        events: [storedEvent(partyQuestStreamId(partyId), 'party.quest_completed', {
          partyId,
          questId,
          completedAt: now.toISOString(),
        }, 1)],
        message: 'completion has no matching start event',
      },
      {
        events: [storedEvent(partyQuestStreamId(partyId), 'party.quest_abandoned', {
          partyId: 'another-party',
          questId,
          reason: 'party-closed',
          abandonedAt: now.toISOString(),
        }, 1)],
        message: 'for another party',
      },
      {
        events: [storedEvent(partyQuestStreamId(partyId), 'party.quest_abandoned', {
          partyId,
          questId,
          reason: 'party-closed',
          abandonedAt: now.toISOString(),
        }, 1)],
        message: 'abandonment has no matching start event',
      },
      {
        events: [{
          ...storedEvent(partyQuestStreamId(partyId), 'party.quest_future', {}, 1),
          version: 2,
        }],
        message: 'Unsupported party quest event version',
      },
    ];

    for (const { events, message } of invalidHistories) {
      const test = harness({ party: { groupId: partyId }, history: events });
      await expect(test.queries.get('party.quests')!({}, test.context)).rejects.toThrow(message);
    }
  });
});

describe('party quest progress and closure handlers', () => {
  it('progresses matching objectives and completes only after all requirements are met', async () => {
    const test = harness({
      party: { groupId: partyId },
      groups: [activePartyGroup],
      history: [startingEvent()],
    });
    const payloads: Array<[string, Record<string, unknown>]> = [
      ['character.moved@1', { characterId: 'character-one', toLocationId: 'track' }],
      ['character.object_read@1', { characterId: 'character-one', objectId: 'marker', locationId: 'track' }],
      ['character.item_used@1', { characterId: 'character-one', interactionId: 'gate', locationId: 'track' }],
      ['character.combat_action_resolved@3', {
        characterId: 'character-one',
        encounter: { status: 'victory', opponentNpcId: 'bandit' },
      }],
    ];
    for (const [key, payload] of payloads) {
      await test.handlers.get(key)!(payload, {
        ...test.context,
        effectId: `source-${key}`,
      });
    }
    await test.handlers.get('team.combat_ended@1')!({
      sourceGroupId: partyId,
      contributingPlayerIds: [playerId],
      result: 'victory',
      npcId: 'bandit',
    }, { ...test.context, effectId: 'team-victory' });

    const journal = await test.queries.get('party.quests')!({}, test.context) as any;
    expect(journal.quests[0]).toMatchObject({
      status: 'completed',
      objectives: [
        { id: 'visit', progress: 1, completed: true },
        { id: 'read', progress: 1, completed: true },
        { id: 'interact', progress: 1, completed: true },
        { id: 'defeat', progress: 2, required: 2, completed: true },
      ],
    });
    expect(test.append).toHaveBeenCalledTimes(5);
  });

  it('deduplicates event effects, ignores non-contributing team victories, and abandons active quests on party close', async () => {
    const history = [startingEvent(), storedEvent(partyQuestStreamId(partyId), 'party.quest_objective_progressed', {
      partyId,
      questId,
      objectiveId: 'visit',
      progress: 1,
      sourceEffectId: 'already-seen',
    }, 2)];
    const test = harness({
      party: { groupId: partyId },
      groups: [activePartyGroup],
      history,
    });
    await test.handlers.get('character.moved@1')!({
      characterId: 'character-one',
      toLocationId: 'track',
    }, { ...test.context, effectId: 'already-seen' });
    expect(test.append).not.toHaveBeenCalled();

    await test.handlers.get('team.combat_ended@1')!({
      sourceGroupId: partyId,
      contributingPlayerIds: ['someone-else'],
      result: 'victory',
      npcId: 'bandit',
    }, test.context);
    expect(test.append).not.toHaveBeenCalled();

    await test.handlers.get('group.closed@1')!({ groupId: partyId }, {
      ...test.context,
      effectId: 'party-close-effect',
    });
    const request = test.append.mock.calls[0]?.[0] as any;
    expect(request.commandId).toBe('party-quest-abandon:party-close-effect');
    expect(request.events[0]).toMatchObject({
      type: 'party.quest_abandoned',
      payload: { partyId, questId, reason: 'party-closed' },
    });
    expect(await test.queries.get('party.quests')!({}, test.context)).toMatchObject({ quests: [] });
  });

  it('ignores missing groups, honors prior progress receipts, and reports failed writes', async () => {
    const movement = {
      characterId: 'character-one',
      toLocationId: 'track',
    };
    const noGroup = harness({
      party: { groupId: partyId },
      history: [startingEvent()],
    });
    await noGroup.handlers.get('character.moved@1')!(movement, {
      ...noGroup.context,
      effectId: 'missing-party-group',
    });
    expect(noGroup.append).not.toHaveBeenCalled();

    const duplicate = harness({
      party: { groupId: partyId },
      groups: [activePartyGroup],
      history: [startingEvent()],
    });
    duplicate.context.store.lookupCommand.mockResolvedValue({} as never);
    await duplicate.handlers.get('character.moved@1')!(movement, {
      ...duplicate.context,
      effectId: 'already-recorded',
    });
    expect(duplicate.append).not.toHaveBeenCalled();

    const failed = harness({
      party: { groupId: partyId },
      groups: [activePartyGroup],
      history: [startingEvent()],
      receiptOk: false,
    });
    await expect(failed.handlers.get('character.moved@1')!(movement, {
      ...failed.context,
      effectId: 'failed-progress-write',
    })).rejects.toThrow('The party quest event could not be appended.');
  });

  it('ignores combat events without a party and party closure without quest history', async () => {
    const test = harness({
      party: { groupId: partyId },
      groups: [activePartyGroup],
      history: [startingEvent()],
    });
    await test.handlers.get('team.combat_ended@1')!({
      contributingPlayerIds: [playerId],
      result: 'victory',
      npcId: 'bandit',
    }, test.context);
    expect(test.append).not.toHaveBeenCalled();

    const empty = harness();
    await empty.handlers.get('group.closed@1')!({ groupId: partyId }, empty.context);
    expect(empty.append).not.toHaveBeenCalled();
  });
});
