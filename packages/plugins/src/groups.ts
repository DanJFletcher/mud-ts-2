import {
  GroupAggregateProjectionSchema,
  GroupClosedEventSchema,
  GroupCreatedEventSchema,
  GroupMemberJoinedEventSchema,
  GroupMemberLeftEventSchema,
  type CapabilityToken,
} from '@mudd/contracts';
import type { EnginePlugin, QueryContext, EngineCommandContext, StoredGameEvent } from '@mudd/engine-core';

export const GROUPS_STREAM_ID = 'world-groups';

export type GroupReadContext = Pick<EngineCommandContext | QueryContext, 'worldInstanceId' | 'store'>;

export interface GroupsStateCapability {
  load(context: GroupReadContext): Promise<ReturnType<typeof GroupAggregateProjectionSchema.parse>>;
}

export const groupsStateCapability = Object.freeze({
  id: 'mudd.groups.state.v1',
  version: '1',
}) satisfies CapabilityToken<GroupsStateCapability>;

export function projectGroups(events: readonly StoredGameEvent[]) {
  const groups = new Map<string, {
    groupId: string;
    groupType: string;
    ownerPlayerId: string;
    maxMembers: number;
    isPublic: boolean;
    status: 'active' | 'closed';
    members: Array<{ playerId: string; characterId: string; displayName: string }>;
    createdAt: string;
    closedAt?: string;
  }>();

  for (const event of events) {
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
    } else if (event.type === 'group.member_joined' && event.version === 1) {
      const { payload } = GroupMemberJoinedEventSchema.parse(domainEvent);
      const group = groups.get(payload.groupId);
      if (!group || group.status !== 'active') throw new Error('Group membership history is inconsistent.');
      if (!group.members.some((member) => member.playerId === payload.member.playerId)) {
        group.members.push(payload.member);
      }
    } else if (event.type === 'group.member_left' && event.version === 1) {
      const { payload } = GroupMemberLeftEventSchema.parse(domainEvent);
      const group = groups.get(payload.groupId);
      if (!group || group.status !== 'active') throw new Error('Group membership history is inconsistent.');
      group.members = group.members.filter((member) => member.playerId !== payload.playerId);
    } else if (event.type === 'group.closed' && event.version === 1) {
      const { payload } = GroupClosedEventSchema.parse(domainEvent);
      const group = groups.get(payload.groupId);
      if (!group || group.status !== 'active') throw new Error('Group closure history is inconsistent.');
      group.status = 'closed';
      group.closedAt = payload.closedAt;
    } else if (event.type.startsWith('group.')) {
      throw new Error(`Unsupported group event version: ${event.type}@${event.version}.`);
    }
  }

  return GroupAggregateProjectionSchema.parse({
    revision: events.at(-1)?.aggregateVersion ?? 0,
    groups: [...groups.values()],
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
