import {
  NpcDialogueProjectionSchema,
  NpcTalkQuerySchema,
} from '@mudd/contracts';
import type { EnginePlugin } from '@mudd/engine-core';
import { replayCharacter } from '@mudd/engine-core';

export const npcDialoguePlugin: EnginePlugin = {
  manifest: {
    id: 'mudd.npc-dialogue',
    version: '1.0.0',
    apiVersion: '1.0',
    category: 'core',
  },
  register({ registerQuery }) {
    registerQuery('npc.talk', NpcTalkQuerySchema, async (query, context) => {
      const character = replayCharacter(
        await context.store.readStream(query.worldInstanceId, query.characterId),
      );
      if (!character || character.archived) throw new Error('That character is no longer available.');

      const location = context.world.locations.find((candidate) => candidate.id === character.locationId);
      if (!location) throw new Error('The character location is not present in this world version.');

      const npc = location.npcs?.find((candidate) => candidate.id === query.payload.npcId);
      if (!npc) throw new Error('That person is not here.');

      const requestedTopic = query.payload.topic?.toLocaleLowerCase();
      const topicResponse = requestedTopic
        ? npc.topics.find((topic) =>
          topic.keywords.some((keyword) => requestedTopic.includes(keyword.toLocaleLowerCase())),
        )?.response
        : undefined;

      return NpcDialogueProjectionSchema.parse({
        npcId: npc.id,
        npcName: npc.name,
        text: requestedTopic ? topicResponse ?? npc.unknownTopicResponse : npc.greeting,
      });
    });
  },
};
