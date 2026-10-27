import { describe, expect, it, vi } from 'vitest';
import type { StoredGameEvent } from '@mudd/engine-core';
import {
  characterStateCapability,
} from './character.js';
import {
  partyPlugin,
  partyStateCapability,
} from './parties.js';
import { GROUPS_STREAM_ID, groupsStateCapability } from './groups.js';

const worldId = 'parties-test-world';
const leaderId = 'player-leader';
const memberId = 'player-member';
const createdAt = '2026-10-27T10:00:00.000Z';
const leader = { playerId: leaderId, characterId: 'leader-character', displayName: 'Aster' };
const member = { playerId: memberId, characterId: 'member-character', displayName: 'Briar' };
const activeParty = {
  groupId: 'party-one',
  groupType: 'party',
  ownerPlayerId: leaderId,
  maxMembers: 4,
  isPublic: true,
  status: 'active',
  members: [leader],
  createdAt,
};

function storedEvent(type: string, payload: Record<string, unknown>, revision: number): StoredGameEvent {
  return {
    eventId: `party-event-${revision}`,
    worldInstanceId: worldId,
    streamId: GROUPS_STREAM_ID,
    aggregateId: GROUPS_STREAM_ID,
    aggregateVersion: revision,
    type,
    version: 1,
    payload,
    causationCommandId: `party-command-${revision}`,
    actorId: 'system',
    occurredAt: createdAt,
    tick: revision,
  } as unknown as StoredGameEvent;
}

function createHistory() {
  return [storedEvent('group.created', {
    groupId: activeParty.groupId,
    groupType: 'party',
    ownerPlayerId: leaderId,
    maxMembers: 4,
    isPublic: true,
    member: leader,
    createdAt,
  }, 1)];
}

function harness(options: {
  playerId?: string;
  groups?: { revision: number; groups: Array<any> };
  character?: any;
  events?: readonly StoredGameEvent[];
} = {}) {
  const commands = new Map<string, (command: any, context: any) => Promise<unknown>>();
  const queries = new Map<string, (query: any, context: any) => Promise<unknown>>();
  let capability: any;
  const groups = options.groups ?? { revision: 0, groups: [] };
  const character = options.character ?? {
    characterId: 'leader-character',
    name: 'Aster',
    archived: false,
    health: { current: 10, maximum: 10 },
  };
  partyPlugin.register({
    registerCommand: (name: string, _schema: unknown, handler: unknown) => {
      commands.set(name, handler as (command: any, context: any) => Promise<unknown>);
    },
    registerQuery: (name: string, _schema: unknown, handler: unknown) => {
      queries.set(name, handler as (query: any, context: any) => Promise<unknown>);
    },
    provideCapability: (_token: unknown, implementation: unknown) => {
      capability = implementation;
    },
    requireCapability: (token: { id: string }) => {
      if (token.id === groupsStateCapability.id) return { load: vi.fn(async () => groups) };
      if (token.id === characterStateCapability.id) {
        return { load: vi.fn(async (_context: unknown, characterId: string) =>
          character.characterId === characterId ? character : undefined) };
      }
      throw new Error(`Unexpected capability ${token.id}`);
    },
  } as never);
  const events = [...(options.events ?? [])];
  const context = {
    worldInstanceId: worldId,
    session: { playerId: options.playerId ?? leaderId },
    now: () => new Date('2026-10-27T12:00:00.000Z'),
    makeId: () => 'party-created',
    store: { readStream: vi.fn(async () => events) },
  };
  return { commands, queries, capability, context };
}

const partyCommand = { characterId: 'leader-character' };

describe('party membership commands', () => {
  it('creates a party and rejects unavailable, dead, or already-partied characters', async () => {
    const test = harness();
    const result = await test.commands.get('party.create')!(partyCommand, test.context);
    expect(result).toMatchObject({
      streamId: GROUPS_STREAM_ID,
      expectedVersion: 0,
      events: expect.arrayContaining([expect.objectContaining({
        type: 'group.created',
        payload: expect.objectContaining({
          groupId: 'party-created',
          groupType: 'party',
          member: leader,
          maxMembers: 4,
          isPublic: true,
        }),
      })]),
    });

    const archived = harness({ character: { ...test.context, characterId: 'leader-character', archived: true } });
    await expect(archived.commands.get('party.create')!(partyCommand, archived.context))
      .rejects.toThrow('no longer available');
    const dead = harness({
      character: {
        characterId: 'leader-character',
        name: 'Aster',
        archived: false,
        health: { current: 0, maximum: 10 },
      },
    });
    await expect(dead.commands.get('party.create')!(partyCommand, dead.context))
      .rejects.toThrow('cannot manage a party');
    const alreadyJoined = harness({
      groups: { revision: 3, groups: [activeParty] },
    });
    await expect(alreadyJoined.commands.get('party.create')!(partyCommand, alreadyJoined.context))
      .rejects.toThrow('already in a party');
  });

  it('joins a public open party and rejects unavailable, private, full, or already-joined parties', async () => {
    const test = harness({
      playerId: memberId,
      groups: { revision: 5, groups: [activeParty] },
      character: { characterId: 'member-character', name: 'Briar', archived: false, health: { current: 10, maximum: 10 } },
    });
    const command = { characterId: 'member-character', payload: { groupId: activeParty.groupId } };
    expect(await test.commands.get('party.join')!(command, test.context)).toMatchObject({
      streamId: GROUPS_STREAM_ID,
      expectedVersion: 5,
      events: expect.arrayContaining([expect.objectContaining({
        type: 'group.member_joined',
        payload: expect.objectContaining({ groupId: activeParty.groupId, member }),
      })]),
    });

    const alreadyIn = harness({
      playerId: leaderId,
      groups: { revision: 1, groups: [activeParty] },
      character: { characterId: 'member-character', name: 'Briar', archived: false, health: { current: 10, maximum: 10 } },
    });
    await expect(alreadyIn.commands.get('party.join')!(command, alreadyIn.context))
      .rejects.toThrow('already in a party');
    const privateParty = harness({
      playerId: memberId,
      groups: { revision: 1, groups: [{ ...activeParty, isPublic: false }] },
      character: { characterId: 'member-character', name: 'Briar', archived: false, health: { current: 10, maximum: 10 } },
    });
    await expect(privateParty.commands.get('party.join')!(command, privateParty.context))
      .rejects.toThrow('not available to join');
    const fullParty = harness({
      playerId: 'new-player',
      groups: { revision: 1, groups: [{ ...activeParty, members: [leader, member, { ...member, playerId: 'p3' }, { ...member, playerId: 'p4' }] }] },
      character: { characterId: 'new-character', name: 'Cedar', archived: false, health: { current: 10, maximum: 10 } },
    });
    await expect(fullParty.commands.get('party.join')!({
      characterId: 'new-character',
      payload: { groupId: activeParty.groupId },
    }, fullParty.context))
      .rejects.toThrow('party is full');
  });

  it('leaves as a member, closes as a leader, and restricts party closure', async () => {
    const memberParty = { ...activeParty, members: [leader, member] };
    const memberTest = harness({ playerId: memberId, groups: { revision: 6, groups: [memberParty] } });
    expect(await memberTest.commands.get('party.leave')!({}, memberTest.context)).toMatchObject({
      expectedVersion: 6,
      events: expect.arrayContaining([expect.objectContaining({
        type: 'group.member_left',
        payload: expect.objectContaining({ groupId: activeParty.groupId, playerId: memberId }),
      })]),
    });

    const leaderTest = harness({ groups: { revision: 6, groups: [memberParty] } });
    expect(await leaderTest.commands.get('party.leave')!({}, leaderTest.context)).toMatchObject({
      events: expect.arrayContaining([expect.objectContaining({
        type: 'group.closed',
        payload: expect.objectContaining({ groupId: activeParty.groupId, closedByPlayerId: leaderId }),
      })]),
    });
    expect(await leaderTest.commands.get('party.close')!({}, leaderTest.context)).toMatchObject({
      events: [expect.objectContaining({ type: 'group.closed' })],
    });

    const noParty = harness();
    await expect(noParty.commands.get('party.leave')!({}, noParty.context))
      .rejects.toThrow('You are not in a party');
    await expect(noParty.commands.get('party.close')!({}, noParty.context))
      .rejects.toThrow('You are not in a party');

    const nonLeader = harness({
      playerId: memberId,
      groups: { revision: 1, groups: [memberParty] },
    });
    await expect(nonLeader.commands.get('party.close')!({}, nonLeader.context))
      .rejects.toThrow('Only the party leader');
  });
});

describe('party queries and state capability', () => {
  it('lists only public active parties and marks full parties as not joinable', async () => {
    const test = harness({
      groups: {
        revision: 3,
        groups: [
          activeParty,
          { ...activeParty, groupId: 'private-party', isPublic: false },
          { ...activeParty, groupId: 'closed-party', status: 'closed' },
          { ...activeParty, groupId: 'full-party', members: [leader, member, { ...member, playerId: 'p3' }, { ...member, playerId: 'p4' }] },
          { ...activeParty, groupId: 'unknown-leader-party', members: [] },
        ],
      },
    });
    const listing = await test.queries.get('party.list')!({}, test.context) as any;
    expect(listing.parties).toHaveLength(3);
    expect(listing.parties).toEqual(expect.arrayContaining([
      expect.objectContaining({ groupId: activeParty.groupId, leaderName: 'Aster', joinable: true }),
      expect.objectContaining({ groupId: 'full-party', joinable: false }),
      expect.objectContaining({ groupId: 'unknown-leader-party', leaderName: 'Unknown leader' }),
    ]));
  });

  it('returns the active party with activity and exposes capability lookup', async () => {
    const test = harness({
      groups: { revision: 1, groups: [activeParty] },
      events: createHistory(),
    });
    const info = await test.queries.get('party.info')!({
      payload: { afterRevision: 0 },
    }, test.context);
    expect(info).toMatchObject({
      party: { groupId: activeParty.groupId, leaderName: 'Aster' },
      revision: 1,
      activity: [{ type: 'created', playerId: leaderId, displayName: 'Aster' }],
    });
    await expect(test.capability.activePartyForPlayer(test.context, leaderId))
      .resolves.toMatchObject({ groupId: activeParty.groupId });
    await expect(test.capability.activePartyForPlayer(test.context, memberId)).resolves.toBeUndefined();

    const historyOnly = harness({
      events: [
        ...createHistory(),
        storedEvent('group.closed', {
          groupId: activeParty.groupId,
          closedByPlayerId: leaderId,
          closedAt: '2026-10-27T11:00:00.000Z',
        }, 2),
      ],
    });
    const closedInfo = await historyOnly.queries.get('party.info')!({
      payload: { afterRevision: 0 },
    }, historyOnly.context) as any;
    expect(closedInfo).toMatchObject({
      party: null,
      revision: 2,
    });
    expect(closedInfo.activity).toEqual(expect.arrayContaining([
      expect.objectContaining({ groupId: activeParty.groupId, type: 'created' }),
      expect.objectContaining({ groupId: activeParty.groupId, type: 'closed' }),
    ]));
  });

  it('includes joined, left, and closed activity after the requested revision', async () => {
    const history = [
      ...createHistory(),
      storedEvent('group.member_joined', {
        groupId: activeParty.groupId,
        member,
        joinedAt: '2026-10-27T10:05:00.000Z',
      }, 2),
      storedEvent('group.member_left', {
        groupId: activeParty.groupId,
        playerId: memberId,
        leftAt: '2026-10-27T10:10:00.000Z',
      }, 3),
      storedEvent('group.closed', {
        groupId: activeParty.groupId,
        closedByPlayerId: leaderId,
        closedAt: '2026-10-27T10:15:00.000Z',
      }, 4),
    ];
    const test = harness({
      playerId: memberId,
      events: history,
    });

    const info = await test.queries.get('party.info')!({
      payload: { afterRevision: 1 },
    }, test.context) as any;

    expect(info.party).toBeNull();
    expect(info.revision).toBe(4);
    expect(info.activity).toEqual([
      expect.objectContaining({ revision: 2, type: 'joined', playerId: memberId, displayName: 'Briar' }),
      expect.objectContaining({ revision: 3, type: 'left', playerId: memberId }),
      expect.objectContaining({ revision: 4, type: 'closed', playerId: leaderId }),
    ]);
  });
});
