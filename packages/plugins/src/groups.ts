import {
  GroupAggregateProjectionSchema,
  GroupClosedEventSchema,
  GroupCreatedEventSchema,
  GroupMemberJoinedEventSchema,
  GroupMemberLeftEventSchema,
  type CapabilityToken,
} from '@mudd/contracts';
import type { EnginePlugin, QueryContext, EngineCommandContext, StoredGameEvent } from '@mudd/engine-core';
import { createIncrementalProjection } from '@mudd/engine-core';

export const GROUPS_STREAM_ID = 'world-groups';

export type GroupReadContext = Pick<EngineCommandContext | QueryContext, 'worldInstanceId' | 'store'>;

export interface GroupsStateCapability {
  load(context: GroupReadContext): Promise<ReturnType<typeof GroupAggregateProjectionSchema.parse>>;
}

export const groupsStateCapability = Object.freeze({
  id: 'mudd.groups.state.v1',
  version: '1',
}) satisfies CapabilityToken<GroupsStateCapability>;

type GroupState = {
    groupId: string;
    groupType: string;
    ownerPlayerId: string;
    maxMembers: number;
    isPublic: boolean;
    status: 'active' | 'closed';
    members: Array<{ playerId: string; characterId: string; displayName: string }>;
    createdAt: string;
    closedAt?: string;
  };

type ProjectedGroupEvent = StoredGameEvent & {
  type: 'group.created' | 'group.member_joined' | 'group.member_left' | 'group.closed';
};

const projectGroupState = createIncrementalProjection(
  () => ({
    groups: new Map<string, GroupState>(), revision: 0,
    names: new Map<string, string>(),
    activity: new Map<string, { revision: number; groupId: string; type: 'created' | 'joined' | 'left' | 'closed'; playerId?: string; displayName?: string }[]>(),
    activityByGroup: new Map<string, { revision: number; groupId: string; type: 'created' | 'joined' | 'left' | 'closed'; playerId?: string; displayName?: string }[]>(),
    latestActivity: new Map<string, { groupId: string; revision: number }>(),
    activeGroupByPlayer: new Map<string, string>(),
  }),
  (state, event: StoredGameEvent) => {
    const { groups } = state;
    let closedMembers: GroupState['members'] | undefined;
    const domainEvent = { type: event.type, version: event.version, payload: event.payload };
    if (event.type === 'group.created' && event.version === 1) {
      const { payload } = GroupCreatedEventSchema.parse(domainEvent);
      groups.set(payload.groupId, {
        groupId: payload.groupId,
        groupType: payload.groupType,
        ownerPlayerId: payload.ownerPlayerId,
        maxMembers: payload.maxMembers,
        isPublic: payload.isPublic,
        status: 'active',
        members: [payload.member],
        createdAt: payload.createdAt,
      });
      state.names.set(payload.member.playerId, payload.member.displayName);
      if (payload.groupType === 'party') state.activeGroupByPlayer.set(payload.member.playerId, payload.groupId);
    } else if (event.type === 'group.member_joined' && event.version === 1) {
      const { payload } = GroupMemberJoinedEventSchema.parse(domainEvent);
      const group = groups.get(payload.groupId);
      if (!group || group.status !== 'active') throw new Error('Group membership history is inconsistent.');
      if (!group.members.some((member) => member.playerId === payload.member.playerId)) {
        group.members.push(payload.member);
      }
      state.names.set(payload.member.playerId, payload.member.displayName);
      if (group.groupType === 'party') state.activeGroupByPlayer.set(payload.member.playerId, group.groupId);
    } else if (event.type === 'group.member_left' && event.version === 1) {
      const { payload } = GroupMemberLeftEventSchema.parse(domainEvent);
      const group = groups.get(payload.groupId);
      if (!group || group.status !== 'active') throw new Error('Group membership history is inconsistent.');
      group.members = group.members.filter((member) => member.playerId !== payload.playerId);
      if (group.groupType === 'party') state.activeGroupByPlayer.delete(payload.playerId);
    } else if (event.type === 'group.closed' && event.version === 1) {
      const { payload } = GroupClosedEventSchema.parse(domainEvent);
      const group = groups.get(payload.groupId);
      if (!group || group.status !== 'active') throw new Error('Group closure history is inconsistent.');
      closedMembers = [...group.members];
      group.status = 'closed';
      group.closedAt = payload.closedAt;
      if (group.groupType === 'party') for (const member of group.members) {
        state.activeGroupByPlayer.delete(member.playerId);
      }
    } else if (event.type.startsWith('group.')) {
      throw new Error(`Unsupported group event version: ${event.type}@${event.version}.`);
    }
    if (event.type.startsWith('group.')) {
      const payload = event.payload as Record<string, unknown>;
      const groupId = typeof payload.groupId === 'string' ? payload.groupId : undefined;
      // projectGroupState rejects unsupported group events before activity projection.
      const groupEvent = event as ProjectedGroupEvent;
      const player = eventPlayer(groupEvent);
      const type = activityType(groupEvent);
      const recipients = type === 'closed' && closedMembers
        ? closedMembers.map((member) => member.playerId)
        : player.playerId ? [player.playerId] : [];
      if (groupId && recipients.length) {
        const entry = {
          revision: event.aggregateVersion, groupId, type,
          playerId: type === 'closed' ? player.playerId : player.playerId!,
          ...(player.playerId && (player.displayName ?? state.names.get(player.playerId))
            ? { displayName: player.displayName ?? state.names.get(player.playerId)! } : {}),
        };
        for (const recipientId of recipients) {
          const activity = state.activity.get(recipientId) ?? [];
          activity.push(entry);
          state.activity.set(recipientId, activity);
          state.latestActivity.set(recipientId, { groupId, revision: event.aggregateVersion });
        }
        const groupActivity = state.activityByGroup.get(groupId) ?? [];
        groupActivity.push(entry);
        state.activityByGroup.set(groupId, groupActivity);
      }
    }
    state.revision = event.aggregateVersion;
  },
);

function activityType(event: ProjectedGroupEvent): 'created' | 'joined' | 'left' | 'closed' {
  switch (event.type) {
    case 'group.created': return 'created';
    case 'group.member_joined': return 'joined';
    case 'group.member_left': return 'left';
    case 'group.closed': return 'closed';
  }
}
function eventPlayer(event: ProjectedGroupEvent): { playerId?: string; displayName?: string } {
  const payload = event.payload as Record<string, unknown>;
  const member = payload.member as Record<string, unknown> | undefined;
  switch (event.type) {
    case 'group.created':
    case 'group.member_joined':
      return {
        playerId: typeof member?.playerId === 'string' ? member.playerId : undefined,
        displayName: typeof member?.displayName === 'string' ? member.displayName : undefined,
      };
    case 'group.member_left':
      return { playerId: typeof payload.playerId === 'string' ? payload.playerId : undefined };
    case 'group.closed':
      return { playerId: typeof payload.closedByPlayerId === 'string' ? payload.closedByPlayerId : undefined };
  }
}

export function projectGroups(events: readonly StoredGameEvent[]) {
  const state = projectGroupState(events);
  return GroupAggregateProjectionSchema.parse({
    revision: state.revision,
    groups: [...state.groups.values()],
  });
}

export function projectGroupActivity(
  events: readonly StoredGameEvent[],
  playerId: string,
  afterRevision: number,
  groupId?: string,
) {
  return projectGroupState.select(events, (state) => {
    const relevantGroupId = groupId ?? state.latestActivity.get(playerId)?.groupId;
    return {
      revision: state.revision,
      party: (() => {
        const id = state.activeGroupByPlayer.get(playerId);
        return id ? state.groups.get(id) : undefined;
      })(),
      relevantGroupId,
      activity: relevantGroupId
        ? (state.activityByGroup.get(relevantGroupId) ?? []).filter((event) =>
          event.revision > afterRevision)
        : [],
    };
  });
}

export const groupsPlugin: EnginePlugin = {
  manifest: {
    id: 'mudd.groups',
    version: '1.0.0',
    apiVersion: '1.0',
    category: 'core',
    provides: [groupsStateCapability.id],
    eventSchemaVersions: {
      'group.created': 1,
      'group.member_joined': 1,
      'group.member_left': 1,
      'group.closed': 1,
    },
  },
  register({ provideCapability }) {
    provideCapability<GroupsStateCapability>(groupsStateCapability, {
      async load(context) {
        const events = await context.store.readStream(context.worldInstanceId, GROUPS_STREAM_ID);
        return projectGroups(events);
      },
    });
  },
};
