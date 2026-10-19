import {
  GroupClosedEventSchema,
  GroupCreatedEventSchema,
  GroupMemberJoinedEventSchema,
  GroupMemberLeftEventSchema,
  PartyCloseCommandSchema,
  PartyCreateCommandSchema,
  PartyInfoProjectionSchema,
  PartyInfoQuerySchema,
  PartyJoinCommandSchema,
  PartyLeaveCommandSchema,
  PartyListProjectionSchema,
  PartyListQuerySchema,
  type CapabilityToken,
  type GroupMember,
} from '@mudd/contracts';
import type {
  EngineCommandContext,
  EnginePlugin,
  QueryContext,
  StoredGameEvent,
} from '@mudd/engine-core';
import { RuleViolationError } from '@mudd/engine-core';
import {
  characterStateCapability,
  type CharacterStateCapability,
} from './character.js';
import {
  GROUPS_STREAM_ID,
  groupsStateCapability,
  type GroupReadContext,
  type GroupsStateCapability,
} from './groups.js';

const PARTY_TYPE = 'party';
const PARTY_CAPACITY = 4;

function activePartyForPlayer(
  groups: Awaited<ReturnType<GroupsStateCapability['load']>>,
  playerId: string,
) {
  return groups.groups.find((group) =>
    group.groupType === PARTY_TYPE &&
    group.status === 'active' &&
    group.members.some((member) => member.playerId === playerId),
  );
}

function eventGroupId(event: StoredGameEvent): string | undefined {
  const payload = event.payload as Record<string, unknown>;
  return typeof payload.groupId === 'string' ? payload.groupId : undefined;
}

function eventPlayer(event: StoredGameEvent): { playerId?: string; displayName?: string } {
  const payload = event.payload as Record<string, unknown>;
  if (event.type === 'group.created' || event.type === 'group.member_joined') {
    const member = payload.member as Record<string, unknown> | undefined;
    return {
      playerId: typeof member?.playerId === 'string' ? member.playerId : undefined,
      displayName: typeof member?.displayName === 'string' ? member.displayName : undefined,
    };
  }
  if (event.type === 'group.member_left') {
    return { playerId: typeof payload.playerId === 'string' ? payload.playerId : undefined };
  }
  if (event.type === 'group.closed') {
    return { playerId: typeof payload.closedByPlayerId === 'string' ? payload.closedByPlayerId : undefined };
  }
  return {};
}

function activityType(event: StoredGameEvent): 'created' | 'joined' | 'left' | 'closed' | undefined {
  if (event.type === 'group.created') return 'created';
  if (event.type === 'group.member_joined') return 'joined';
  if (event.type === 'group.member_left') return 'left';
  if (event.type === 'group.closed') return 'closed';
  return undefined;
}

async function requireAvailableCharacter(
  characterState: CharacterStateCapability,
  context: EngineCommandContext,
  characterId: string,
): Promise<GroupMember> {
  const character = await characterState.load(context, characterId);
  if (!character || character.archived) throw new RuleViolationError('That character is no longer available.');
  if (character.health?.current === 0 || character.combat?.status === 'defeat') {
    throw new RuleViolationError('A character who has died cannot manage a party.');
  }
  return {
    playerId: context.session.playerId,
    characterId,
    displayName: character.name,
  };
}

async function readGroupEvents(context: EngineCommandContext | QueryContext) {
  return context.store.readStream(context.worldInstanceId, GROUPS_STREAM_ID);
}

export interface PartyStateCapability {
  activePartyForPlayer(
    context: GroupReadContext,
    playerId: string,
  ): Promise<Awaited<ReturnType<GroupsStateCapability['load']>>['groups'][number] | undefined>;
}

export const partyStateCapability = Object.freeze({
  id: 'mudd.party.state.v1',
  version: '1',
}) satisfies CapabilityToken<PartyStateCapability>;

export const partyPlugin: EnginePlugin = {
  manifest: {
    id: 'mudd.party',
    version: '1.0.0',
    apiVersion: '1.0',
    category: 'first-party',
    provides: [partyStateCapability.id],
    requires: [groupsStateCapability.id, characterStateCapability.id],
    requiredPlugins: {
      'mudd.groups': '^1.0.0',
      'mudd.character': '^1.0.0',
    },
    eventSchemaVersions: {
      'group.created': 1,
      'group.member_joined': 1,
      'group.member_left': 1,
      'group.closed': 1,
    },
  },
  register({
    registerCommand,
    registerQuery,
    provideCapability,
    requireCapability,
  }) {
    const groupsState = requireCapability<GroupsStateCapability>(groupsStateCapability);
    const characterState = requireCapability<CharacterStateCapability>(characterStateCapability);

    provideCapability<PartyStateCapability>(partyStateCapability, {
      async activePartyForPlayer(context, playerId) {
        return activePartyForPlayer(await groupsState.load(context), playerId);
      },
    });

    registerCommand('party.create', PartyCreateCommandSchema, async (command, context) => {
      const member = await requireAvailableCharacter(characterState, context, command.characterId);
      const groups = await groupsState.load(context);
      if (activePartyForPlayer(groups, context.session.playerId)) {
        throw new RuleViolationError('You are already in a party. Leave it before creating another.');
      }
      const event = GroupCreatedEventSchema.parse({
        type: 'group.created',
        version: 1,
        payload: {
          groupId: context.makeId(),
          groupType: PARTY_TYPE,
          ownerPlayerId: context.session.playerId,
          maxMembers: PARTY_CAPACITY,
          isPublic: true,
          member,
          createdAt: context.now().toISOString(),
        },
      });
      return {
        streamId: GROUPS_STREAM_ID,
        expectedVersion: groups.revision,
        events: [event],
      };
    });

    registerCommand('party.join', PartyJoinCommandSchema, async (command, context) => {
      const member = await requireAvailableCharacter(characterState, context, command.characterId);
      const groups = await groupsState.load(context);
      if (activePartyForPlayer(groups, context.session.playerId)) {
        throw new RuleViolationError('You are already in a party. Leave it before joining another.');
      }
      const party = groups.groups.find((group) => group.groupId === command.payload.groupId);
      if (!party || party.groupType !== PARTY_TYPE || party.status !== 'active' || !party.isPublic) {
        throw new RuleViolationError('That party is not available to join.');
      }
      if (party.members.length >= party.maxMembers) throw new RuleViolationError('That party is full.');
      const event = GroupMemberJoinedEventSchema.parse({
        type: 'group.member_joined',
        version: 1,
        payload: { groupId: party.groupId, member, joinedAt: context.now().toISOString() },
      });
      return {
        streamId: GROUPS_STREAM_ID,
        expectedVersion: groups.revision,
        events: [event],
      };
    });

    registerCommand('party.leave', PartyLeaveCommandSchema, async (_command, context) => {
      const groups = await groupsState.load(context);
      const party = activePartyForPlayer(groups, context.session.playerId);
      if (!party) throw new RuleViolationError('You are not in a party.');
      const now = context.now().toISOString();
      const event = party.ownerPlayerId === context.session.playerId
        ? GroupClosedEventSchema.parse({
            type: 'group.closed',
            version: 1,
            payload: { groupId: party.groupId, closedByPlayerId: context.session.playerId, closedAt: now },
          })
        : GroupMemberLeftEventSchema.parse({
            type: 'group.member_left',
            version: 1,
            payload: { groupId: party.groupId, playerId: context.session.playerId, leftAt: now },
          });
      return { streamId: GROUPS_STREAM_ID, expectedVersion: groups.revision, events: [event] };
    });

    registerCommand('party.close', PartyCloseCommandSchema, async (_command, context) => {
      const groups = await groupsState.load(context);
      const party = activePartyForPlayer(groups, context.session.playerId);
      if (!party) throw new RuleViolationError('You are not in a party.');
      if (party.ownerPlayerId !== context.session.playerId) {
        throw new RuleViolationError('Only the party leader can close the party.');
      }
      const event = GroupClosedEventSchema.parse({
        type: 'group.closed',
        version: 1,
        payload: {
          groupId: party.groupId,
          closedByPlayerId: context.session.playerId,
          closedAt: context.now().toISOString(),
        },
      });
      return { streamId: GROUPS_STREAM_ID, expectedVersion: groups.revision, events: [event] };
    });

    registerQuery('party.list', PartyListQuerySchema, async (_query, context) => {
      const groups = await groupsState.load(context);
      const parties = groups.groups
        .filter((group) => group.groupType === PARTY_TYPE && group.status === 'active' && group.isPublic)
        .map((group) => ({
          groupId: group.groupId,
          leaderName: group.members.find((member) => member.playerId === group.ownerPlayerId)?.displayName
            ?? group.members[0]?.displayName
            ?? 'Unknown leader',
          members: group.members,
          memberCount: group.members.length,
          maxMembers: group.maxMembers,
          joinable: group.members.length < group.maxMembers,
        }));
      return PartyListProjectionSchema.parse({ parties });
    });

    registerQuery('party.info', PartyInfoQuerySchema, async (query, context) => {
      const groups = await groupsState.load(context);
      const events = await readGroupEvents(context);
      const party = activePartyForPlayer(groups, context.session.playerId);
      const latestRelevantEvent = [...events].reverse().find((event) =>
        eventPlayer(event).playerId === context.session.playerId);
      const relevantGroupId = party?.groupId
        ?? (latestRelevantEvent ? eventGroupId(latestRelevantEvent) : undefined);
      const relevantGroup = relevantGroupId
        ? groups.groups.find((group) => group.groupId === relevantGroupId)
        : undefined;
      const names = new Map<string, string>();
      for (const event of events) {
        if (event.type === 'group.created' || event.type === 'group.member_joined') {
          const payload = event.payload.member as Record<string, unknown> | undefined;
          if (typeof payload?.playerId === 'string' && typeof payload.displayName === 'string') {
            names.set(payload.playerId, payload.displayName);
          }
        }
      }
      const cursor = query.payload.afterRevision ?? groups.revision;
      const activity = relevantGroupId
        ? events.flatMap((event) => {
            const type = activityType(event);
            if (!type || eventGroupId(event) !== relevantGroupId ||
              event.aggregateVersion <= cursor) return [];
            const actor = eventPlayer(event);
            const displayName = actor.displayName ?? (actor.playerId ? names.get(actor.playerId) : undefined);
            return [{
              revision: event.aggregateVersion,
              groupId: relevantGroupId,
              type,
              ...(actor.playerId ? { playerId: actor.playerId } : {}),
              ...(displayName ? { displayName } : {}),
            }];
          })
        : [];
      return PartyInfoProjectionSchema.parse({
        party: party && relevantGroup
          ? {
              ...party,
              leaderName: party.members.find((member) => member.playerId === party.ownerPlayerId)?.displayName
                ?? 'Unknown leader',
            }
          : null,
        revision: groups.revision,
        activity,
      });
    });
  },
};
