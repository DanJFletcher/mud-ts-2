import { describe, expect, it, vi } from 'vitest';
import type { StoredGameEvent } from '@mudd/engine-core';
import {
  GROUPS_STREAM_ID,
  groupsPlugin,
  groupsStateCapability,
  projectGroupActivity,
  projectGroups,
} from './groups.js';

const worldId = 'groups-unit-world';
const createdAt = '2026-10-27T10:00:00.000Z';
const groupId = 'party-one';
const firstMember = { playerId: 'player-one', characterId: 'character-one', displayName: 'Aster' };
const secondMember = { playerId: 'player-two', characterId: 'character-two', displayName: 'Briar' };

function storedEvent(type: string, payload: Record<string, unknown>, revision: number): StoredGameEvent {
  return {
    eventId: `group-event-${revision}`,
    worldInstanceId: worldId,
    streamId: GROUPS_STREAM_ID,
    aggregateId: GROUPS_STREAM_ID,
    aggregateVersion: revision,
    type,
    version: 1,
    payload,
    causationCommandId: `group-command-${revision}`,
    actorId: 'system',
    occurredAt: createdAt,
    tick: revision,
  } as unknown as StoredGameEvent;
}

function createdEvent(options: { groupType?: string; id?: string } = {}) {
  return storedEvent('group.created', {
    groupId: options.id ?? groupId,
    groupType: options.groupType ?? 'party',
    ownerPlayerId: firstMember.playerId,
    maxMembers: 4,
    isPublic: true,
    member: firstMember,
    createdAt,
  }, 1);
}

function history() {
  return [
    createdEvent(),
    storedEvent('group.member_joined', {
      groupId,
      member: secondMember,
      joinedAt: '2026-10-27T10:01:00.000Z',
    }, 2),
    storedEvent('group.member_joined', {
      groupId,
      member: secondMember,
      joinedAt: '2026-10-27T10:02:00.000Z',
    }, 3),
    storedEvent('group.member_left', {
      groupId,
      playerId: secondMember.playerId,
      leftAt: '2026-10-27T10:03:00.000Z',
    }, 4),
  ];
}

describe('group event projections', () => {
  it('projects party membership, de-duplicates joins, and reports activity after a revision', () => {
    const events = history();
    expect(projectGroups(events)).toMatchObject({
      revision: 4,
      groups: [{
        groupId,
        groupType: 'party',
        status: 'active',
        members: [firstMember],
      }],
    });
    expect(projectGroupActivity(events, firstMember.playerId, 1)).toMatchObject({
      revision: 4,
      party: { groupId, members: [firstMember] },
      relevantGroupId: groupId,
      activity: [
        { revision: 2, type: 'joined', playerId: secondMember.playerId, displayName: secondMember.displayName },
        { revision: 3, type: 'joined', playerId: secondMember.playerId, displayName: secondMember.displayName },
        { revision: 4, type: 'left', playerId: secondMember.playerId },
      ],
    });
    expect(projectGroupActivity(events, 'outsider', 0)).toMatchObject({
      party: undefined,
      relevantGroupId: undefined,
      activity: [],
    });
    expect(projectGroupActivity(events, firstMember.playerId, 1, 'unknown-group').activity).toEqual([]);
  });

  it('clears active-party membership on closure and notifies every former member', () => {
    const events = [
      ...history(),
      storedEvent('group.closed', {
        groupId,
        closedByPlayerId: firstMember.playerId,
        closedAt: '2026-10-27T10:05:00.000Z',
      }, 5),
    ];
    expect(projectGroups(events)).toMatchObject({
      groups: [{ groupId, status: 'closed', closedAt: '2026-10-27T10:05:00.000Z' }],
    });
    expect(projectGroupActivity(events, firstMember.playerId, 4).party).toBeUndefined();
    expect(projectGroupActivity(events, firstMember.playerId, 4).activity).toMatchObject([
      { revision: 5, type: 'closed', playerId: firstMember.playerId },
    ]);
    expect(projectGroupActivity(events, secondMember.playerId, 4).activity).toMatchObject([
      { revision: 5, type: 'closed', playerId: firstMember.playerId },
    ]);
  });

  it('tracks non-party group activity without treating it as an active party', () => {
    const event = createdEvent({ groupType: 'guild', id: 'guild-one' });
    expect(projectGroups([event]).groups[0]).toMatchObject({
      groupId: 'guild-one',
      groupType: 'guild',
      status: 'active',
    });
    expect(projectGroupActivity([event], firstMember.playerId, 0)).toMatchObject({
      party: undefined,
      relevantGroupId: 'guild-one',
      activity: [{ type: 'created', playerId: firstMember.playerId, displayName: firstMember.displayName }],
    });
  });

  it('rejects inconsistent transitions and unsupported event versions', () => {
    expect(() => projectGroups([
      storedEvent('group.member_joined', {
        groupId,
        member: secondMember,
        joinedAt: createdAt,
      }, 1),
    ])).toThrow('Group membership history is inconsistent.');
    expect(() => projectGroups([
      storedEvent('group.member_left', {
        groupId,
        playerId: secondMember.playerId,
        leftAt: createdAt,
      }, 1),
    ])).toThrow('Group membership history is inconsistent.');
    expect(() => projectGroups([
      createdEvent(),
      storedEvent('group.closed', {
        groupId,
        closedByPlayerId: firstMember.playerId,
        closedAt: createdAt,
      }, 2),
      storedEvent('group.closed', {
        groupId,
        closedByPlayerId: firstMember.playerId,
        closedAt: createdAt,
      }, 3),
    ])).toThrow('Group closure history is inconsistent.');
    expect(() => projectGroups([
      storedEvent('group.created', {}, 1),
    ])).toThrow();
    expect(() => projectGroups([
      { ...createdEvent(), type: 'group.unknown', version: 9 },
    ])).toThrow('Unsupported group event version: group.unknown@9.');
  });
});

describe('groups state capability', () => {
  it('loads the canonical groups stream through the plugin capability', async () => {
    let capability: any;
    groupsPlugin.register({
      provideCapability: (_token: unknown, implementation: unknown) => {
        capability = implementation;
      },
    } as never);
    expect(groupsStateCapability.id).toBe('mudd.groups.state.v1');
    const readStream = vi.fn(async () => [createdEvent()]);
    await expect(capability.load({
      worldInstanceId: worldId,
      store: { readStream },
    })).resolves.toMatchObject({ revision: 1, groups: [{ groupId, status: 'active' }] });
    expect(readStream).toHaveBeenCalledWith(worldId, GROUPS_STREAM_ID);
  });
});
