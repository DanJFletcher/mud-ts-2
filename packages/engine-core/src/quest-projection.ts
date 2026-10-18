import {
  QuestJournalSchema,
  type CharacterProjection,
  type QuestDefinition,
  type WorldPackDraft,
} from '@mudd/contracts';

export function questObjectiveIsComplete(
  quest: QuestDefinition,
  objectiveId: string,
  character: CharacterProjection,
): boolean {
  const objective = quest.objectives.find((candidate) => candidate.id === objectiveId);
  if (!objective) return false;
  if (objective.type === 'read-object') {
    return character.readableObservations.some((observation) =>
      observation.objectId === objective.objectId && observation.locationId === objective.locationId,
    );
  }
  return character.visitedLocationIds.includes(objective.locationId);
}

export function questObjectivesAreComplete(quest: QuestDefinition, character: CharacterProjection): boolean {
  return quest.objectives.every((objective) => questObjectiveIsComplete(quest, objective.id, character));
}

export function projectQuestJournal(character: CharacterProjection, world: WorldPackDraft) {
  const progressById = new Map(character.questProgress.map((progress) => [progress.questId, progress]));
  const quests = (world.quests ?? []).flatMap((quest) => {
    const progress = progressById.get(quest.id);
    if (!progress) return [];
    if (progress.definitionVersion !== quest.version) {
      throw new Error(`Quest ${quest.id} version ${progress.definitionVersion} is not available in this world.`);
    }
    return [{
      questId: quest.id,
      title: quest.title,
      summary: quest.summary,
      status: progress.status,
      objectives: quest.objectives.map((objective) => ({
        id: objective.id,
        label: objective.label,
        completed: questObjectiveIsComplete(quest, objective.id, character),
      })),
    }];
  });
  return QuestJournalSchema.parse(quests);
}
