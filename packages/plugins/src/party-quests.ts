import {
  CharacterItemUsedEventSchema,
  CharacterMovedEventSchema,
  CharacterObjectReadEventSchema,
  CombatActionResolvedEventV3Schema,
  GroupClosedEventSchema,
  PartyQuestAbandonedEventSchema,
  PartyQuestCompletedEventSchema,
  PartyQuestJournalQuerySchema,
  PartyQuestJournalSchema,
  PartyQuestProgressedEventSchema,
  PartyQuestStartedEventSchema,
  PartyQuestStartCommandSchema,
  TeamCombatEndedEventSchema,
} from '@mudd/contracts';
import type {
  EngineCommandContext,
  EnginePlugin,
  EventEffectContext,
  ProposedDomainEvent,
  QueryContext,
  StoredGameEvent,
} from '@mudd/engine-core';
import { RuleViolationError } from '@mudd/engine-core';
import {
  partyStateCapability,
  type PartyStateCapability,
} from './parties.js';
import { groupsStateCapability, type GroupsStateCapability } from './groups.js';

export function partyQuestStreamId(partyId: string) {
  return `party-quests:${partyId}`;
}

type QuestState = {
  questId: string;
  definitionVersion: string;
  status: 'active' | 'completed' | 'abandoned';
  progress: Map<string, number>;
  handledEffects: Set<string>;
};

function projectPartyQuests(
  events: readonly StoredGameEvent[],
  partyId: string,
  world: QueryContext['world'] | EngineCommandContext['world'],
) {
  const definitions = new Map((world.quests ?? []).map((quest) => [quest.id, quest]));
  const states = new Map<string, QuestState>();
  for (const event of events) {
    const domainEvent = { type: event.type, version: event.version, payload: event.payload };
    if (event.type === 'party.quest_started' && event.version === 1) {
      const { payload } = PartyQuestStartedEventSchema.parse(domainEvent);
      if (payload.partyId !== partyId) throw new Error('Party quest stream contains an event for another party.');
      const definition = definitions.get(payload.questId);
      if (!definition || definition.version !== payload.definitionVersion || definition.scope !== 'party') {
        throw new Error(`Party quest definition ${payload.questId}@${payload.definitionVersion} is unavailable.`);
      }
      states.set(payload.questId, {
        questId: payload.questId,
        definitionVersion: payload.definitionVersion,
        status: 'active',
        progress: new Map(),
        handledEffects: new Set(),
      });
    } else if (event.type === 'party.quest_objective_progressed' && event.version === 1) {
      const { payload } = PartyQuestProgressedEventSchema.parse(domainEvent);
      if (payload.partyId !== partyId) throw new Error('Party quest stream contains an event for another party.');
      const state = states.get(payload.questId);
      if (!state) throw new Error('Party quest progress has no matching start event.');
      if (state.status === 'active') state.progress.set(payload.objectiveId, payload.progress);
      state.handledEffects.add(payload.sourceEffectId);
    } else if (event.type === 'party.quest_completed' && event.version === 1) {
      const { payload } = PartyQuestCompletedEventSchema.parse(domainEvent);
      if (payload.partyId !== partyId) throw new Error('Party quest stream contains an event for another party.');
      const state = states.get(payload.questId);
      if (!state) throw new Error('Party quest completion has no matching start event.');
      state.status = 'completed';
    } else if (event.type === 'party.quest_abandoned' && event.version === 1) {
      const { payload } = PartyQuestAbandonedEventSchema.parse(domainEvent);
      if (payload.partyId !== partyId) throw new Error('Party quest stream contains an event for another party.');
      const state = states.get(payload.questId);
      if (!state) throw new Error('Party quest abandonment has no matching start event.');
      if (state.status === 'active') state.status = 'abandoned';
    } else if (event.type.startsWith('party.quest_')) {
      throw new Error(`Unsupported party quest event version: ${event.type}@${event.version}.`);
    }
  }
  return states;
}

function projectJournal(
  events: readonly StoredGameEvent[],
  partyId: string | undefined,
  world: QueryContext['world'],
) {
  if (!partyId) return PartyQuestJournalSchema.parse({ partyId: null, available: [], quests: [] });
  const states = projectPartyQuests(events, partyId, world);
  const definitions = new Map((world.quests ?? []).filter((quest) => quest.scope === 'party').map((quest) => [quest.id, quest]));
  const available = [...definitions.values()]
    .filter((quest) => !states.has(quest.id))
    .map((quest) => ({ questId: quest.id, title: quest.title, summary: quest.summary }));
  const quests = [...states.values()].flatMap((state) => {
    if (state.status === 'abandoned') return [];
    const definition = definitions.get(state.questId);
    if (!definition || definition.version !== state.definitionVersion) {
      throw new Error(`Party quest definition ${state.questId}@${state.definitionVersion} is unavailable.`);
    }
    return [{
      questId: state.questId,
      title: definition.title,
      summary: definition.summary,
      status: state.status,
      objectives: definition.objectives.flatMap((objective) => {
        const required = objective.type === 'defeat-npc' ? objective.requiredCount : 1;
        const progress = Math.min(required, state.progress.get(objective.id) ?? 0);
        return [{
          id: objective.id,
          label: objective.label,
          progress,
          required,
          completed: progress >= required,
        }];
      }),
    }];
  });
  return PartyQuestJournalSchema.parse({ partyId, available, quests });
}

function matchesObjective(
  eventType: string,
  payload: Record<string, unknown>,
  objective: NonNullable<QueryContext['world']['quests']>[number]['objectives'][number],
) {
  if (objective.type === 'visit-location' && eventType === 'character.moved') {
    return payload.toLocationId === objective.locationId;
  }
  if (objective.type === 'read-object' && eventType === 'character.object_read') {
    return payload.objectId === objective.objectId && payload.locationId === objective.locationId;
  }
  if (objective.type === 'perform-interaction' && eventType === 'character.item_used') {
    return payload.interactionId === objective.interactionId && payload.locationId === objective.locationId;
  }
  if (objective.type === 'defeat-npc' && eventType === 'character.combat_action_resolved') {
    const encounter = payload.encounter as Record<string, unknown> | undefined;
    return encounter?.status === 'victory' && encounter.opponentNpcId === objective.npcId;
  }
  if (objective.type === 'defeat-npc' && eventType === 'team.combat_ended') {
    return payload.result === 'victory' && payload.npcId === objective.npcId;
  }
  return false;
}

async function appendSystemEvents(
  context: EventEffectContext,
  streamId: string,
  events: readonly ProposedDomainEvent[],
  commandId: string,
) {
  if (!events.length) return;
  const prior = await context.store.lookupCommand(
    context.worldInstanceId,
    'system:party-quests',
    commandId,
    commandId,
  );
  if (prior) return;
  const history = await context.store.readStream(context.worldInstanceId, streamId);
  const result = await context.store.append({
    worldInstanceId: context.worldInstanceId,
    streamId,
    actorId: 'system:party-quests',
    commandId,
    payloadHash: commandId,
    expectedVersion: history.at(-1)?.aggregateVersion ?? 0,
    events,
  });
  if (!result.receipt.ok) throw new Error('The party quest event could not be appended.');
}

export const partyQuestPlugin: EnginePlugin = {
  manifest: {
    id: 'mudd.party-quests',
    version: '1.0.0',
    apiVersion: '1.0',
    category: 'first-party',
    requiredPlugins: { 'mudd.party': '^1.0.0' },
    eventSchemaVersions: {
      'party.quest_started': 1,
      'party.quest_objective_progressed': 1,
      'party.quest_completed': 1,
      'party.quest_abandoned': 1,
      'team.combat_ended': 1,
    },
  },
  register({ registerCommand, registerQuery, registerEventHandler, requireCapability }) {
    const parties = requireCapability<PartyStateCapability>(partyStateCapability);
    const groups = requireCapability<GroupsStateCapability>(groupsStateCapability);

    registerCommand('party.quest.start', PartyQuestStartCommandSchema, async (command, context) => {
      const party = await parties.activePartyForPlayer(context, context.session.playerId);
      if (!party) throw new RuleViolationError('Join or create a party before starting a shared quest.');
      const quest = context.world.quests?.find((candidate) => candidate.id === command.payload.questId);
      if (!quest || quest.scope !== 'party') throw new RuleViolationError('That is not an available party quest.');
      if (quest.objectives.some((objective) => objective.type === 'defeat-npc' &&
        !context.world.locations.some((location) => location.npcs?.some((npc) => npc.id === objective.npcId && npc.combatProfile)))) {
        throw new RuleViolationError('A party quest references an unavailable opponent.');
      }
      const streamId = partyQuestStreamId(party.groupId);
      const history = await context.store.readStream(context.worldInstanceId, streamId);
      const states = projectPartyQuests(history, party.groupId, context.world);
      if (states.has(quest.id)) throw new RuleViolationError('Your party has already started or completed that quest.');
      const event = PartyQuestStartedEventSchema.parse({
        type: 'party.quest_started',
        version: 1,
        payload: {
          partyId: party.groupId,
          questId: quest.id,
          definitionVersion: quest.version,
          startedByPlayerId: context.session.playerId,
          startedAt: context.now().toISOString(),
        },
      });
      return { streamId, expectedVersion: history.at(-1)?.aggregateVersion ?? 0, events: [event] };
    });

    registerQuery('party.quests', PartyQuestJournalQuerySchema, async (_query, context) => {
      const party = await parties.activePartyForPlayer(context, context.session.playerId);
      const history = party
        ? await context.store.readStream(context.worldInstanceId, partyQuestStreamId(party.groupId))
        : [];
      return projectJournal(history, party?.groupId, context.world);
    });

    const progressForParty = async (
      partyId: string,
      eventType: string,
      payload: Record<string, unknown>,
      context: EventEffectContext,
    ) => {
      const group = (await groups.load(context)).groups.find((candidate) =>
        candidate.groupId === partyId &&
        candidate.groupType === 'party' &&
        candidate.status === 'active',
      );
      if (!group) return;
      const streamId = partyQuestStreamId(group.groupId);
      const history = await context.store.readStream(context.worldInstanceId, streamId);
      const states = projectPartyQuests(history, group.groupId, context.world);
      const definitions = new Map((context.world.quests ?? []).map((quest) => [quest.id, quest]));
      const output: ProposedDomainEvent[] = [];
      for (const state of states.values()) {
        if (state.status !== 'active' || state.handledEffects.has(context.effectId)) continue;
        const definition = definitions.get(state.questId);
        if (!definition || definition.scope !== 'party' || definition.version !== state.definitionVersion) {
          throw new Error(`Party quest definition ${state.questId}@${state.definitionVersion} is unavailable.`);
        }
        let changed = false;
        for (const objective of definition.objectives) {
          const required = objective.type === 'defeat-npc' ? objective.requiredCount : 1;
          const previous = state.progress.get(objective.id) ?? 0;
          if (previous >= required || !matchesObjective(eventType, payload, objective)) continue;
          const progress = previous + 1;
          state.progress.set(objective.id, progress);
          output.push(PartyQuestProgressedEventSchema.parse({
            type: 'party.quest_objective_progressed',
            version: 1,
            payload: {
              partyId: group.groupId,
              questId: state.questId,
              objectiveId: objective.id,
              progress,
              sourceEffectId: context.effectId,
            },
          }));
          changed = true;
        }
        if (changed && definition.objectives.every((objective) => {
          const required = objective.type === 'defeat-npc' ? objective.requiredCount : 1;
          return (state.progress.get(objective.id) ?? 0) >= required;
        })) {
          output.push(PartyQuestCompletedEventSchema.parse({
            type: 'party.quest_completed',
            version: 1,
            payload: {
              partyId: group.groupId,
              questId: state.questId,
              completedAt: context.now().toISOString(),
            },
          }));
        }
      }
      await appendSystemEvents(context, streamId, output, `party-quest-progress:${context.effectId}`);
    };

    const progressFromEvent = async (
      eventType: string,
      payload: Record<string, unknown>,
      context: EventEffectContext & { readonly actorId: string },
    ) => {
      const party = await parties.activePartyForPlayer(context, context.actorId);
      if (party) await progressForParty(party.groupId, eventType, payload, context);
    };

    registerEventHandler(
      'character.moved',
      1,
      CharacterMovedEventSchema.shape.payload,
      (payload, context) => progressFromEvent('character.moved', payload, context),
    );
    registerEventHandler(
      'character.object_read',
      1,
      CharacterObjectReadEventSchema.shape.payload,
      (payload, context) => progressFromEvent('character.object_read', payload, context),
    );
    registerEventHandler(
      'character.item_used',
      1,
      CharacterItemUsedEventSchema.shape.payload,
      (payload, context) => progressFromEvent('character.item_used', payload, context),
    );
    registerEventHandler(
      'character.combat_action_resolved',
      3,
      CombatActionResolvedEventV3Schema.shape.payload,
      (payload, context) => progressFromEvent('character.combat_action_resolved', payload, context),
    );
    registerEventHandler(
      'team.combat_ended',
      1,
      TeamCombatEndedEventSchema.shape.payload,
      async (payload, context) => {
        if (!payload.sourceGroupId) return;
        const currentGroup = (await groups.load(context)).groups.find((candidate) =>
          candidate.groupId === payload.sourceGroupId &&
          candidate.groupType === 'party' &&
          candidate.status === 'active',
        );
        if (!currentGroup || !payload.contributingPlayerIds.some((playerId) =>
          currentGroup.members.some((member) => member.playerId === playerId))) return;
        await progressForParty(payload.sourceGroupId, 'team.combat_ended', payload, context);
      },
    );

    registerEventHandler(
      'group.closed',
      1,
      GroupClosedEventSchema.shape.payload,
      async (payload, context) => {
        const streamId = partyQuestStreamId(payload.groupId);
        const history = await context.store.readStream(context.worldInstanceId, streamId);
        if (!history.length) return;
        const states = projectPartyQuests(history, payload.groupId, context.world);
        const abandonEvents = [...states.values()]
          .filter((state) => state.status === 'active')
          .map((state) => PartyQuestAbandonedEventSchema.parse({
            type: 'party.quest_abandoned',
            version: 1,
            payload: {
              partyId: payload.groupId,
              questId: state.questId,
              reason: 'party-closed',
              abandonedAt: context.now().toISOString(),
            },
          }));
        await appendSystemEvents(
          context,
          streamId,
          abandonEvents,
          `party-quest-abandon:${context.effectId}`,
        );
      },
    );
  },
};
