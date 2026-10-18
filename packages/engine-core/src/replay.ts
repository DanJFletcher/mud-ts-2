import type { StoredGameEvent } from './types.js';
import {
  CharacterItemTakenEventSchema,
  CharacterItemDroppedEventSchema,
  CharacterItemUsedEventSchema,
  CharacterObjectReadEventSchema,
  CharacterNpcDialogueChoiceMadeEventSchema,
  QuestAcceptedEventSchema,
  QuestCompletedEventSchema,
  CharacterProjectionSchema,
  CharacterCreatedEventSchema,
  CharacterMovedEventSchema,
  CharacterRenamedEventSchema,
  CharacterArchivedEventSchema,
  CharacterRestoredEventSchema,
} from '@mudd/contracts';

export function replayCharacter(events: readonly StoredGameEvent[]) {
  let state: ReturnType<typeof CharacterProjectionSchema.parse> | undefined;

  for (const event of events) {
    const { streamId: _streamId, ...publicEvent } = event;
    if (event.aggregateVersion !== (state?.revision ?? 0) + 1) {
      throw new Error(`Non-contiguous aggregate revision at ${event.aggregateVersion}.`);
    }
    if (event.type === 'character.created') {
      const created = CharacterCreatedEventSchema.parse(publicEvent);
      state = CharacterProjectionSchema.parse({
        worldInstanceId: event.worldInstanceId,
        characterId: created.payload.characterId,
        name: created.payload.name,
        locationId: created.payload.startingLocationId,
        visitedLocationIds: [created.payload.startingLocationId],
        revision: event.aggregateVersion,
      });
    } else if (event.type === 'character.moved') {
      if (!state) throw new Error('Movement event encountered before character creation.');
      const moved = CharacterMovedEventSchema.parse(publicEvent);
      if (moved.payload.characterId !== state.characterId || moved.payload.fromLocationId !== state.locationId) {
        throw new Error(`Invalid movement event at revision ${event.aggregateVersion}.`);
      }
      state = CharacterProjectionSchema.parse({
        ...state,
        locationId: moved.payload.toLocationId,
        visitedLocationIds: state.visitedLocationIds.includes(moved.payload.toLocationId)
          ? state.visitedLocationIds
          : [...state.visitedLocationIds, moved.payload.toLocationId],
        revision: event.aggregateVersion,
      });
    } else if (event.type === 'character.item_taken') {
      if (!state) throw new Error('Item taken event encountered before character creation.');
      const taken = CharacterItemTakenEventSchema.parse(publicEvent);
      if (taken.payload.characterId !== state.characterId || taken.payload.locationId !== state.locationId) {
        throw new Error(`Invalid item taken event at revision ${event.aggregateVersion}.`);
      }
      if (state.inventory.some((item) => item.id === taken.payload.item.id)) {
        throw new Error(`Duplicate inventory item at revision ${event.aggregateVersion}.`);
      }
      const itemLocation = state.itemLocations.find((entry) => entry.item.id === taken.payload.item.id);
      if (itemLocation && (
        itemLocation.locationId !== taken.payload.locationId ||
        itemLocation.item.label !== taken.payload.item.label ||
        itemLocation.item.description !== taken.payload.item.description
      )) {
        throw new Error(`Invalid item location at revision ${event.aggregateVersion}.`);
      }
      state = CharacterProjectionSchema.parse({
        ...state,
        inventory: [...state.inventory, taken.payload.item],
        itemLocations: itemLocation
          ? state.itemLocations.map((entry) => entry.item.id === taken.payload.item.id
            ? { ...entry, locationId: null }
            : entry)
          : [...state.itemLocations, { item: taken.payload.item, locationId: null }],
        revision: event.aggregateVersion,
      });
    } else if (event.type === 'character.item_dropped') {
      if (!state) throw new Error('Item dropped event encountered before character creation.');
      const dropped = CharacterItemDroppedEventSchema.parse(publicEvent);
      const carriedItem = state.inventory.find((item) => item.id === dropped.payload.item.id);
      const itemLocation = state.itemLocations.find((entry) => entry.item.id === dropped.payload.item.id);
      if (
        dropped.payload.characterId !== state.characterId ||
        dropped.payload.locationId !== state.locationId ||
        !carriedItem ||
        itemLocation?.locationId !== null ||
        carriedItem.label !== dropped.payload.item.label ||
        carriedItem.description !== dropped.payload.item.description
      ) {
        throw new Error(`Invalid item dropped event at revision ${event.aggregateVersion}.`);
      }
      state = CharacterProjectionSchema.parse({
        ...state,
        inventory: state.inventory.filter((item) => item.id !== dropped.payload.item.id),
        itemLocations: state.itemLocations.map((entry) => entry.item.id === dropped.payload.item.id
          ? { ...entry, locationId: dropped.payload.locationId }
          : entry),
        revision: event.aggregateVersion,
      });
    } else if (event.type === 'character.item_used') {
      if (!state) throw new Error('Item use event encountered before character creation.');
      const used = CharacterItemUsedEventSchema.parse(publicEvent);
      if (
        used.payload.characterId !== state.characterId ||
        used.payload.locationId !== state.locationId ||
        !state.inventory.some((item) => item.id === used.payload.itemId)
      ) {
        throw new Error(`Invalid item use event at revision ${event.aggregateVersion}.`);
      }
      const alreadyUsed = state.itemUseObservations.some((observation) =>
        observation.interactionId === used.payload.interactionId &&
        observation.locationId === used.payload.locationId,
      );
      state = CharacterProjectionSchema.parse({
        ...state,
        itemUseObservations: alreadyUsed
          ? state.itemUseObservations
          : [...state.itemUseObservations, {
            interactionId: used.payload.interactionId,
            itemId: used.payload.itemId,
            targetId: used.payload.targetId,
            locationId: used.payload.locationId,
          }],
        revision: event.aggregateVersion,
      });
    } else if (event.type === 'character.object_read') {
      if (!state) throw new Error('Object read event encountered before character creation.');
      const read = CharacterObjectReadEventSchema.parse(publicEvent);
      if (read.payload.characterId !== state.characterId || read.payload.locationId !== state.locationId) {
        throw new Error(`Invalid object read event at revision ${event.aggregateVersion}.`);
      }
      const alreadyRead = state.readableObservations.some((observation) =>
        observation.objectId === read.payload.objectId && observation.locationId === read.payload.locationId,
      );
      state = CharacterProjectionSchema.parse({
        ...state,
        readableObservations: alreadyRead
          ? state.readableObservations
          : [...state.readableObservations, {
            objectId: read.payload.objectId,
            locationId: read.payload.locationId,
          }],
        revision: event.aggregateVersion,
      });
    } else if (event.type === 'character.npc_dialogue_choice_made') {
      if (!state) throw new Error('NPC dialogue event encountered before character creation.');
      const choice = CharacterNpcDialogueChoiceMadeEventSchema.parse(publicEvent);
      if (choice.payload.characterId !== state.characterId) {
        throw new Error(`Invalid NPC dialogue event at revision ${event.aggregateVersion}.`);
      }
      const existingProgress = state.npcProgress.find((entry) => entry.npcId === choice.payload.npcId);
      if (existingProgress?.progressFlagIds.includes(choice.payload.progressFlagId)) {
        throw new Error(`Duplicate NPC dialogue progress at revision ${event.aggregateVersion}.`);
      }
      state = CharacterProjectionSchema.parse({
        ...state,
        npcProgress: existingProgress
          ? state.npcProgress.map((entry) => entry.npcId === choice.payload.npcId
            ? {
              ...entry,
              progressFlagIds: [...entry.progressFlagIds, choice.payload.progressFlagId],
              lastChoiceId: choice.payload.choiceId,
            }
            : entry)
          : [...state.npcProgress, {
            npcId: choice.payload.npcId,
            progressFlagIds: [choice.payload.progressFlagId],
            lastChoiceId: choice.payload.choiceId,
          }],
        revision: event.aggregateVersion,
      });
    } else if (event.type === 'quest.accepted') {
      if (!state) throw new Error('Quest acceptance event encountered before character creation.');
      const accepted = QuestAcceptedEventSchema.parse(publicEvent);
      if (accepted.payload.characterId !== state.characterId ||
        state.questProgress.some((progress) => progress.questId === accepted.payload.questId)) {
        throw new Error(`Invalid quest acceptance event at revision ${event.aggregateVersion}.`);
      }
      state = CharacterProjectionSchema.parse({
        ...state,
        questProgress: [...state.questProgress, {
          questId: accepted.payload.questId,
          definitionVersion: accepted.payload.definitionVersion,
          status: 'active',
        }],
        revision: event.aggregateVersion,
      });
    } else if (event.type === 'quest.completed') {
      if (!state) throw new Error('Quest completion event encountered before character creation.');
      const completed = QuestCompletedEventSchema.parse(publicEvent);
      const progress = state.questProgress.find((entry) => entry.questId === completed.payload.questId);
      if (
        completed.payload.characterId !== state.characterId ||
        !progress ||
        progress.status !== 'active' ||
        progress.definitionVersion !== completed.payload.definitionVersion
      ) {
        throw new Error(`Invalid quest completion event at revision ${event.aggregateVersion}.`);
      }
      state = CharacterProjectionSchema.parse({
        ...state,
        questProgress: state.questProgress.map((entry) => entry.questId === completed.payload.questId
          ? { ...entry, status: 'completed' }
          : entry),
        revision: event.aggregateVersion,
      });
    } else if (event.type === 'character.renamed') {
      if (!state) throw new Error('Rename event encountered before character creation.');
      const renamed = CharacterRenamedEventSchema.parse(publicEvent);
      if (renamed.payload.characterId !== state.characterId || state.archived) {
        throw new Error(`Invalid rename event at revision ${event.aggregateVersion}.`);
      }
      state = CharacterProjectionSchema.parse({
        ...state,
        name: renamed.payload.name,
        revision: event.aggregateVersion,
      });
    } else if (event.type === 'character.archived') {
      if (!state) throw new Error('Archive event encountered before character creation.');
      const archived = CharacterArchivedEventSchema.parse(publicEvent);
      if (archived.payload.characterId !== state.characterId || state.archived) {
        throw new Error(`Invalid archive event at revision ${event.aggregateVersion}.`);
      }
      state = CharacterProjectionSchema.parse({
        ...state,
        archived: true,
        revision: event.aggregateVersion,
      });
    } else if (event.type === 'character.restored') {
      if (!state) throw new Error('Restore event encountered before character creation.');
      const restored = CharacterRestoredEventSchema.parse(publicEvent);
      if (restored.payload.characterId !== state.characterId || !state.archived) {
        throw new Error(`Invalid restore event at revision ${event.aggregateVersion}.`);
      }
      state = CharacterProjectionSchema.parse({
        ...state,
        archived: false,
        revision: event.aggregateVersion,
      });
    } else {
      throw new Error(`Unsupported event type "${event.type}" at revision ${event.aggregateVersion}.`);
    }
  }
  return state;
}
