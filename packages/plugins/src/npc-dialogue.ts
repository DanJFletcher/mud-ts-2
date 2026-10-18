import {
  CharacterNpcDialogueChoiceMadeEventSchema,
  NpcDialogueChoiceCommandSchema,
  NpcDialogueProjectionSchema,
  NpcTalkQuerySchema,
  type CharacterProjection,
  type NpcDefinition,
} from '@mudd/contracts';
import type {
  EngineCommandContext,
  EnginePlugin,
  QueryContext,
} from '@mudd/engine-core';
import type { CharacterStateCapability } from './character.js';

function currentNpc(
  context: EngineCommandContext | QueryContext,
  character: CharacterProjection,
  npcId: string,
): NpcDefinition {
  if (character.archived) throw new Error('That character is no longer available.');
  const location = context.world.locations.find((candidate) => candidate.id === character.locationId);
  if (!location) throw new Error('The character location is not present in this world version.');
  const npc = location.npcs?.find((candidate) => candidate.id === npcId);
  if (!npc) throw new Error('That person is not here.');
  return npc;
}

function dialogueProjection(
  npc: NpcDefinition,
  character: CharacterProjection,
  topic?: string,
) {
  if (topic) {
    const normalizedTopic = topic.toLocaleLowerCase();
    const topicResponse = npc.topics.find((entry) =>
      entry.keywords.some((keyword) => normalizedTopic.includes(keyword.toLocaleLowerCase())),
    )?.response;
    return NpcDialogueProjectionSchema.parse({
      npcId: npc.id,
      npcName: npc.name,
      text: topicResponse ?? npc.unknownTopicResponse,
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
  const choices = dialogue.choices
    .filter((choice) => !progress?.progressFlagIds.includes(choice.progressFlagId))
    .map(({ id, label }) => ({ id, label }));

  return NpcDialogueProjectionSchema.parse({
    npcId: npc.id,
    npcName: npc.name,
    text: lastChoice?.response ?? dialogue.prompt,
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
  },
  register({ registerQuery, registerCommand, requireCapability }) {
    const characterState = requireCapability<CharacterStateCapability>('mudd.character.state.v1');

    registerQuery('npc.talk', NpcTalkQuerySchema, async (query, context) => {
      const character = await characterState.load(context, query.characterId);
      if (!character) throw new Error('That character is no longer available.');
      const npc = currentNpc(context, character, query.payload.npcId);
      return dialogueProjection(npc, character, query.payload.topic);
    });

    registerCommand('npc.dialogue.choose', NpcDialogueChoiceCommandSchema, async (command, context) => {
      const character = await characterState.load(context, command.characterId);
      if (!character) throw new Error('That character is no longer available.');
      const npc = currentNpc(context, character, command.payload.npcId);
      const choice = npc.dialogue?.choices.find((candidate) => candidate.id === command.payload.choiceId);
      if (!choice) throw new Error('That choice is not available here.');

      const progress = character.npcProgress.find((entry) => entry.npcId === npc.id);
      if (progress?.progressFlagIds.includes(choice.progressFlagId)) {
        throw new Error('You have already asked about that.');
      }

      const payload = {
        characterId: character.characterId,
        npcId: npc.id,
        choiceId: choice.id,
        progressFlagId: choice.progressFlagId,
      };
      CharacterNpcDialogueChoiceMadeEventSchema.shape.payload.parse(payload);
      return {
        streamId: character.characterId,
        expectedVersion: command.expectedVersion,
        events: [{
          type: 'character.npc_dialogue_choice_made',
          version: 1,
          payload,
        }],
      };
    });
  },
};
