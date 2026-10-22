import {
  CharacterNpcDialogueChoiceMadeEventSchema,
  NpcDialogueChoiceCommandSchema,
  NpcDialogueProjectionSchema,
  CharacterQuestRewardedEventSchema,
  QuestAcceptedEventSchema,
  QuestCompletedEventSchema,
  NpcTalkQuerySchema,
  type CharacterProjection,
  type NpcDefinition,
  type NpcQuestResponseDefinition,
  type NpcQuestStateCondition,
} from '@mudd/contracts';
import type {
  EngineCommandContext,
  EnginePlugin,
  ProposedDomainEvent,
  QueryContext,
} from '@mudd/engine-core';
import { RuleViolationError } from '@mudd/engine-core';
import type { CharacterStateCapability } from './character.js';
import { assertCharacterAlive, characterStateCapability } from './character.js';
import { projectQuestJournal, questObjectivesAreComplete } from '@mudd/engine-core';
import {
  autonomousNpcStateCapability,
  type AutonomousNpcStateCapability,
} from './autonomous-npcs.js';

function currentNpc(
  context: EngineCommandContext | QueryContext,
  character: CharacterProjection,
  npcId: string,
): NpcDefinition {
  if (character.archived) throw new RuleViolationError('That character is no longer available.');
  const location = context.world.locations.find((candidate) => candidate.id === character.locationId);
  if (!location) throw new Error('The character location is not present in this world version.');
  const npc = location.npcs?.find((candidate) => candidate.id === npcId);
  if (!npc) throw new RuleViolationError('That person is not here.');
  return npc;
}

function questConditionMatches(
  condition: NpcQuestStateCondition,
  questJournal: ReturnType<typeof projectQuestJournal>,
): boolean {
  const quest = questJournal.find((entry) => entry.questId === condition.questId);
  if (!quest || (condition.status && quest.status !== condition.status)) return false;
  const completedObjectiveIds = new Set(
    quest.objectives.filter((objective) => objective.completed).map((objective) => objective.id),
  );
  return condition.requiresCompletedObjectiveIds.every((id) => completedObjectiveIds.has(id)) &&
    condition.requiresIncompleteObjectiveIds.every((id) => !completedObjectiveIds.has(id));
}

function matchingQuestResponse(
  responses: NpcQuestResponseDefinition[] | undefined,
  questJournal: ReturnType<typeof projectQuestJournal>,
): NpcQuestResponseDefinition | undefined {
  return (responses ?? [])
    .filter((candidate) => questConditionMatches(candidate, questJournal))
    .sort((left, right) =>
      right.requiresCompletedObjectiveIds.length + right.requiresIncompleteObjectiveIds.length -
      left.requiresCompletedObjectiveIds.length - left.requiresIncompleteObjectiveIds.length,
    )[0];
}

function dialogueProjection(
  npc: NpcDefinition,
  character: CharacterProjection,
  world: QueryContext['world'],
  topic?: string,
) {
  if (topic) {
    const normalizedTopic = topic.toLocaleLowerCase();
    const matchingTopic = npc.topics.find((entry) =>
      entry.keywords.some((keyword) => normalizedTopic.includes(keyword.toLocaleLowerCase())),
    );
    const questJournal = projectQuestJournal(character, world);
    const questResponse = matchingQuestResponse(matchingTopic?.questResponses, questJournal);
    return NpcDialogueProjectionSchema.parse({
      npcId: npc.id,
      npcName: npc.name,
      text: questResponse?.response ?? matchingTopic?.response ?? npc.unknownTopicResponse,
      choices: [],
    });
  }

  const dialogue = npc.dialogue;
  if (!dialogue) {
    return NpcDialogueProjectionSchema.parse({
      npcId: npc.id,
      npcName: npc.name,
      text: npc.greeting,
      choices: [],
    });
  }

  const progress = character.npcProgress.find((entry) => entry.npcId === npc.id);
  const lastChoice = dialogue.choices.find((choice) => choice.id === progress?.lastChoiceId);
  const questJournal = projectQuestJournal(character, world);
  const questResponse = matchingQuestResponse(dialogue.questResponses, questJournal);
  const choices = dialogue.choices
    .filter((choice) => {
      if (progress?.progressFlagIds.includes(choice.progressFlagId)) return false;
      if (choice.questCondition && !questConditionMatches(choice.questCondition, questJournal)) return false;
      if (!choice.questAction) return true;
      const quest = world.quests.find((candidate) => candidate.id === choice.questAction?.questId);
      if (!quest || quest.scope === 'party') return false;
      const questProgress = character.questProgress.find((candidate) => candidate.questId === quest.id);
      if (choice.questAction.type === 'accept') {
        return quest.giverNpcId === npc.id && !questProgress;
      }
      return quest.turnInNpcId === npc.id &&
        questProgress?.status === 'active' &&
        questJournal.some((entry) => entry.questId === quest.id && entry.status === 'active') &&
        questObjectivesAreComplete(quest, character);
    })
    .map(({ id, label }) => ({ id, label }));

  return NpcDialogueProjectionSchema.parse({
    npcId: npc.id,
    npcName: npc.name,
    text: questResponse?.response ?? lastChoice?.response ?? dialogue.prompt,
    choices,
  });
}

export const npcDialoguePlugin: EnginePlugin = {
  manifest: {
    id: 'mudd.npc-dialogue',
    version: '1.0.0',
    apiVersion: '1.0',
    category: 'core',
    requiredPlugins: { 'mudd.character': '^1.0.0' },
    requires: ['mudd.character.state.v1'],
    eventSchemaVersions: {
      'character.npc_dialogue_choice_made': 1,
      'quest.accepted': 1,
      'quest.completed': 1,
      'character.quest_rewarded': 1,
    },
  },
  register({ registerQuery, registerCommand, requireCapability, optionalCapability }) {
    const characterState = requireCapability<CharacterStateCapability>(characterStateCapability);
    const autonomousNpcs = optionalCapability<AutonomousNpcStateCapability>(autonomousNpcStateCapability);

    registerQuery('npc.talk', NpcTalkQuerySchema, async (query, context) => {
      const character = await characterState.load(context, query.characterId);
      if (!character) throw new RuleViolationError('That character is no longer available.');
      const npc = autonomousNpcs
        ? (await autonomousNpcs.atLocation(context, character.locationId))
          .find((candidate) => candidate.id === query.payload.npcId)
        : currentNpc(context, character, query.payload.npcId);
      if (!npc) throw new RuleViolationError('That person is not here.');
      return dialogueProjection(npc, character, context.world, query.payload.topic);
    });

    registerCommand('npc.dialogue.choose', NpcDialogueChoiceCommandSchema, async (command, context) => {
      const character = await characterState.load(context, command.characterId);
      if (!character) throw new RuleViolationError('That character is no longer available.');
      assertCharacterAlive(character);
      const npc = autonomousNpcs
        ? (await autonomousNpcs.atLocation(context, character.locationId))
          .find((candidate) => candidate.id === command.payload.npcId)
        : currentNpc(context, character, command.payload.npcId);
      if (!npc) throw new RuleViolationError('That person is not here.');
      const choice = npc.dialogue?.choices.find((candidate) => candidate.id === command.payload.choiceId);
      if (!choice) throw new RuleViolationError('That choice is not available here.');

      if (
        choice.questCondition &&
        !questConditionMatches(choice.questCondition, projectQuestJournal(character, context.world))
      ) {
        throw new RuleViolationError('That choice is not available here.');
      }

      const progress = character.npcProgress.find((entry) => entry.npcId === npc.id);
      if (progress?.progressFlagIds.includes(choice.progressFlagId)) {
        throw new RuleViolationError('You have already asked about that.');
      }

      const payload = {
        characterId: character.characterId,
        npcId: npc.id,
        choiceId: choice.id,
        progressFlagId: choice.progressFlagId,
      };
      CharacterNpcDialogueChoiceMadeEventSchema.shape.payload.parse(payload);
      const events: ProposedDomainEvent[] = [{
        type: 'character.npc_dialogue_choice_made',
        version: 1,
        payload,
      }];
      if (choice.questAction) {
        const quest = context.world.quests.find((candidate) => candidate.id === choice.questAction?.questId);
        if (!quest) throw new RuleViolationError('That quest is not available in this world.');
        if (quest.scope === 'party') {
          throw new RuleViolationError('Party quests are accepted through the party commands.');
        }
        const questProgress = character.questProgress.find((candidate) => candidate.questId === quest.id);
        if (choice.questAction.type === 'accept') {
          if (quest.giverNpcId !== npc.id || questProgress) throw new RuleViolationError('That quest is no longer available.');
          const questPayload = {
            characterId: character.characterId,
            questId: quest.id,
            definitionVersion: quest.version,
          };
          QuestAcceptedEventSchema.shape.payload.parse(questPayload);
          events.push({ type: 'quest.accepted', version: 1, payload: questPayload });
        } else {
          if (
            quest.turnInNpcId !== npc.id ||
            questProgress?.status !== 'active' ||
            !questObjectivesAreComplete(quest, character)
          ) {
            throw new RuleViolationError('You have more to do before reporting back.');
          }
          const questPayload = {
            characterId: character.characterId,
            questId: quest.id,
            definitionVersion: quest.version,
          };
          QuestCompletedEventSchema.shape.payload.parse(questPayload);
          events.push({ type: 'quest.completed', version: 1, payload: questPayload });
          if (quest.reward) {
            const currency = context.world.currency;
            if (!currency || currency.id !== quest.reward.currencyId) {
              throw new RuleViolationError('That quest reward is not configured for this world.');
            }
            if (!character.wallet || character.wallet.currencyId !== currency.id) {
              throw new RuleViolationError('This character’s wallet is not ready yet. Refresh the world and try again.');
            }
            if (character.wallet.balance > 2_147_483_647 - quest.reward.amount) {
              throw new RuleViolationError('Your wallet cannot hold that quest reward.');
            }
            const missingRewardItemId = (quest.reward.itemIds ?? []).find((itemId) =>
              !character.inventory.some((item) => item.id === itemId),
            );
            if (missingRewardItemId) {
              const item = context.world.locations
                .flatMap((location) => location.takeables ?? [])
                .find((candidate) => candidate.id === missingRewardItemId);
              throw new RuleViolationError(
                `You must carry ${item?.label ?? 'the required item'} before claiming this quest reward.`,
              );
            }
            const rewardPayload = {
              characterId: character.characterId,
              questId: quest.id,
              definitionVersion: quest.version,
              currencyId: currency.id,
              amount: quest.reward.amount,
              ...((quest.reward.itemIds?.length ?? 0) > 0 ? { itemIds: quest.reward.itemIds } : {}),
            };
            CharacterQuestRewardedEventSchema.shape.payload.parse(rewardPayload);
            events.push({ type: 'character.quest_rewarded', version: 1, payload: rewardPayload });
          }
        }
      }
      return {
        streamId: character.characterId,
        expectedVersion: command.expectedVersion,
        events,
      };
    });
  },
};
