import {
  QuestChoiceSelectCommandSchema,
  QuestChoiceSelectedEventSchema,
  QuestJournalQuerySchema,
  QuestWorldOutcomeDecidedEventSchema,
  type CapabilityToken,
  type CharacterProjection,
  type NpcDefinition,
  type QuestDefinition,
} from '@mudd/contracts';
import type {
  CommandPlan,
  EngineCommandContext,
  EnginePlugin,
  ProposedDomainEvent,
  QueryContext,
  StoredGameEvent,
} from '@mudd/engine-core';
import {
  checkQuestChoice,
  projectQuestJournal,
  questWorldOutcomeKeys,
  resolveQuestDefinition,
  RuleViolationError,
} from '@mudd/engine-core';
import {
  assertCharacterAlive,
  characterStateCapability,
  type CharacterStateCapability,
} from './character.js';
import {
  autonomousNpcStateCapability,
  type AutonomousNpcStateCapability,
} from './autonomous-npcs.js';

/** One shared stream per world instance; only this plugin writes it. */
export const QUEST_WORLD_OUTCOMES_STREAM_ID = 'quest-world-outcomes';

export interface QuestWorldOutcomesState {
  readonly revision: number;
  readonly values: ReadonlyMap<string, string>;
}

export interface QuestWorldOutcomesCapability {
  load(context: EngineCommandContext | QueryContext): Promise<QuestWorldOutcomesState>;
}

export const questWorldOutcomesCapability = Object.freeze({
  id: 'mudd.quest-world-outcomes.v1',
  version: '1',
}) satisfies CapabilityToken<QuestWorldOutcomesCapability>;

export function projectQuestWorldOutcomes(events: readonly StoredGameEvent[]): QuestWorldOutcomesState {
  const values = new Map<string, string>();
  for (const event of events) {
    if (event.type !== 'world.quest_outcome_decided' || event.version !== 1) {
      throw new Error(`Unsupported quest world outcome event: ${event.type}@${event.version}.`);
    }
    const parsed = QuestWorldOutcomeDecidedEventSchema.shape.payload.safeParse(event.payload);
    if (!parsed.success) throw new Error(`Invalid quest world outcome at revision ${event.aggregateVersion}.`);
    const payload = parsed.data;
    // Set-once: the stream guard makes a second decision for a key impossible to commit.
    if (values.has(payload.key)) {
      throw new Error(`Quest world outcome ${payload.key} was decided twice at revision ${event.aggregateVersion}.`);
    }
    values.set(payload.key, payload.value);
  }
  return { revision: events.at(-1)?.aggregateVersion ?? 0, values };
}

async function npcIsPresent(
  context: EngineCommandContext,
  character: CharacterProjection,
  npcId: string,
  autonomousNpcs: AutonomousNpcStateCapability | undefined,
): Promise<boolean> {
  const npcs: readonly NpcDefinition[] = autonomousNpcs
    ? await autonomousNpcs.atLocation(context, character.locationId)
    : context.world.locations.find((location) => location.id === character.locationId)?.npcs ?? [];
  return npcs.some((npc) => npc.id === npcId);
}

/**
 * Build the authoritative writes for one branch transition. The caller has
 * already confirmed the offering NPC is present. A choice that settles a shared
 * world outcome commits with a guarded companion write, so concurrent conflicting
 * decisions cannot both succeed; a later matching decision adds no world event.
 */
export function planQuestChoice(
  character: CharacterProjection,
  quest: QuestDefinition,
  choiceId: string,
  worldOutcomes: QuestWorldOutcomesState | undefined,
  fromBranchId?: string,
): { events: ProposedDomainEvent[]; companions?: NonNullable<CommandPlan['companions']> } {
  const progress = character.questProgress.find((entry) => entry.questId === quest.id);
  if (progress) resolveQuestDefinition({ quests: [quest] }, progress);
  const check = checkQuestChoice(quest, character, choiceId, worldOutcomes?.values, fromBranchId);
  if (!check.ok) throw new RuleViolationError(check.reason);
  const payload = QuestChoiceSelectedEventSchema.shape.payload.parse({
    characterId: character.characterId,
    questId: quest.id,
    definitionVersion: progress!.definitionVersion,
    choiceId: check.choice.id,
    fromBranchId: check.branch.id,
    toBranchId: check.choice.toBranchId,
  });
  const events: ProposedDomainEvent[] = [{ type: 'quest.choice_selected', version: 1, payload }];
  const outcome = check.choice.worldOutcome;
  if (!outcome || worldOutcomes?.values.get(outcome.key) === outcome.value) return { events };
  const decided = QuestWorldOutcomeDecidedEventSchema.shape.payload.parse({
    key: outcome.key,
    value: outcome.value,
    questId: quest.id,
    choiceId: check.choice.id,
    definitionVersion: progress!.definitionVersion,
    decidedByCharacterId: character.characterId,
  });
  return {
    events,
    companions: [{
      streamId: QUEST_WORLD_OUTCOMES_STREAM_ID,
      expectedVersion: worldOutcomes!.revision,
      events: [{ type: 'world.quest_outcome_decided', version: 1, payload: decided }],
    }],
  };
}

export const questBranchesPlugin: EnginePlugin = {
  manifest: {
    id: 'mudd.quest-branches',
    version: '1.0.0',
    apiVersion: '1.0',
    category: 'core',
    requiredPlugins: { 'mudd.character': '^1.0.0' },
    requires: ['mudd.character.state.v1'],
    provides: [questWorldOutcomesCapability.id],
    eventSchemaVersions: {
      'quest.choice_selected': 1,
      'world.quest_outcome_decided': 1,
    },
  },
  register({ registerCommand, registerQuery, provideCapability, requireCapability, optionalCapability }) {
    const characterState = requireCapability<CharacterStateCapability>(characterStateCapability);
    const autonomousNpcs = optionalCapability<AutonomousNpcStateCapability>(autonomousNpcStateCapability);
    const worldOutcomes: QuestWorldOutcomesCapability = {
      async load(context) {
        return projectQuestWorldOutcomes(
          await context.store.readStream(context.worldInstanceId, QUEST_WORLD_OUTCOMES_STREAM_ID),
        );
      },
    };
    provideCapability(questWorldOutcomesCapability, worldOutcomes);

    registerCommand('quest.choice.select', QuestChoiceSelectCommandSchema, async (command, context) => {
      const character = await characterState.load(context, command.characterId);
      if (!character || character.archived) throw new RuleViolationError('That character is no longer available.');
      assertCharacterAlive(character);
      const quest = context.world.quests.find((candidate) => candidate.id === command.payload.questId);
      if (!quest?.branching) throw new RuleViolationError('That quest has no choices to make.');
      const choice = quest.branching.branches.flatMap((branch) => branch.choices)
        .find((candidate) => candidate.id === command.payload.choiceId);
      if (!choice) throw new RuleViolationError('That choice is not available now.');
      if (!(await npcIsPresent(context, character, choice.npcId, autonomousNpcs))) {
        throw new RuleViolationError('Find the person who can hear that decision first.');
      }
      const shared = questWorldOutcomeKeys(context.world).size > 0 ? await worldOutcomes.load(context) : undefined;
      const plan = planQuestChoice(character, quest, choice.id, shared, command.payload.fromBranchId);
      return {
        streamId: character.characterId,
        expectedVersion: command.expectedVersion,
        events: plan.events,
        ...(plan.companions ? { companions: plan.companions } : {}),
      };
    });

    registerQuery('quest.journal', QuestJournalQuerySchema, async (query, context) => {
      const character = await characterState.load(context, query.characterId);
      if (!character || character.archived) throw new RuleViolationError('That character is no longer available.');
      const shared = questWorldOutcomeKeys(context.world).size > 0 ? await worldOutcomes.load(context) : undefined;
      return projectQuestJournal(character, context.world, shared?.values);
    });
  },
};
