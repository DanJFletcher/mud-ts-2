import {
  QuestJournalSchema,
  type CharacterProjection,
  type QuestBranchDefinition,
  type QuestChoiceDefinition,
  type QuestDefinition,
  type WorldPackDraft,
} from '@mudd/contracts';

type QuestProgressRecord = CharacterProjection['questProgress'][number];

/** Shared world outcome decisions by key; undefined when the caller did not load them. */
export type QuestWorldOutcomeValues = ReadonlyMap<string, string>;

/**
 * The definition that interprets a progress record. Progress recorded under an
 * earlier version is interpreted by the current definition only when that
 * definition lists the earlier version as compatible; anything else fails closed.
 */
export function resolveQuestDefinition(
  world: Pick<WorldPackDraft, 'quests'>,
  progress: Pick<QuestProgressRecord, 'questId' | 'definitionVersion'>,
): QuestDefinition {
  const quest = (world.quests ?? []).find((candidate) => candidate.id === progress.questId);
  if (
    !quest ||
    (quest.version !== progress.definitionVersion &&
      !quest.previousVersions?.some((previous) => previous.version === progress.definitionVersion))
  ) {
    throw new Error(`Quest ${progress.questId} version ${progress.definitionVersion} is not available in this world.`);
  }
  return quest;
}

function branchById(quest: QuestDefinition, branchId: string | undefined): QuestBranchDefinition | undefined {
  return quest.branching?.branches.find((branch) => branch.id === branchId);
}

/** Branches this character has entered, in order, ending with the current branch. */
export function questPathBranches(quest: QuestDefinition, progress: QuestProgressRecord): QuestBranchDefinition[] {
  if (!quest.branching) return [];
  const path = [branchById(quest, quest.branching.startBranchId)];
  const choices = quest.branching.branches.flatMap((branch) => branch.choices);
  for (const choiceId of progress.choiceIds ?? []) {
    const choice = choices.find((candidate) => candidate.id === choiceId);
    path.push(branchById(quest, choice?.toBranchId));
  }
  if (path.some((branch) => !branch) || path.at(-1)?.id !== progress.branchId) {
    throw new Error(`Quest ${quest.id} progress does not match its branch definition.`);
  }
  return path as QuestBranchDefinition[];
}

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
  if (objective.type === 'perform-interaction') {
    return character.itemUseObservations.some((observation) =>
      observation.interactionId === objective.interactionId && observation.locationId === objective.locationId,
    );
  }
  if (objective.type === 'defeat-npc') return false;
  if (objective.type === 'possess-item') {
    return character.inventory.some((item) => item.id === objective.itemId);
  }
  return character.visitedLocationIds.includes(objective.locationId);
}

/**
 * Linear quests need every objective. Branching quests need the objectives on
 * the branches the character entered, and must be on a terminal branch.
 */
export function questObjectivesAreComplete(quest: QuestDefinition, character: CharacterProjection): boolean {
  if (!quest.branching) {
    return quest.objectives.every((objective) => questObjectiveIsComplete(quest, objective.id, character));
  }
  const progress = character.questProgress.find((entry) => entry.questId === quest.id);
  if (!progress) return false;
  const path = questPathBranches(quest, progress);
  return Boolean(path.at(-1)?.outcomeId) && path.every((branch) =>
    branch.objectiveIds.every((objectiveId) => questObjectiveIsComplete(quest, objectiveId, character)));
}

export type QuestChoiceCheck =
  | { readonly ok: true; readonly choice: QuestChoiceDefinition; readonly branch: QuestBranchDefinition }
  | { readonly ok: false; readonly reason: string };

/**
 * Every server-side rule for a branch transition except NPC presence. Journal,
 * dialogue projection and command handling all call this, so a client-visible
 * choice never grants more than the command would.
 */
export function checkQuestChoice(
  quest: QuestDefinition,
  character: CharacterProjection,
  choiceId: string,
  worldOutcomes: QuestWorldOutcomeValues | undefined,
  fromBranchId?: string,
): QuestChoiceCheck {
  if (!quest.branching || quest.scope === 'party') return { ok: false, reason: 'That quest has no choices to make.' };
  const progress = character.questProgress.find((entry) => entry.questId === quest.id);
  if (progress?.status !== 'active') return { ok: false, reason: 'That quest is not in progress.' };
  const branch = branchById(quest, progress.branchId);
  if (!branch || (fromBranchId !== undefined && fromBranchId !== branch.id)) {
    return { ok: false, reason: 'That choice has already been made. Refresh your journal.' };
  }
  const choice = branch.choices.find((candidate) => candidate.id === choiceId);
  if (!choice) return { ok: false, reason: 'That choice is not available now.' };
  if (!branch.objectiveIds.every((objectiveId) => questObjectiveIsComplete(quest, objectiveId, character))) {
    return { ok: false, reason: 'Finish what this part of the quest asks before deciding.' };
  }
  const needsWorld = Boolean(choice.worldOutcome) || choice.requires.some((requirement) => requirement.type === 'world-outcome');
  // Fail closed: a caller that did not load shared outcomes cannot offer choices that depend on them.
  if (needsWorld && !worldOutcomes) return { ok: false, reason: 'That choice is not available now.' };
  const decided = choice.worldOutcome ? worldOutcomes?.get(choice.worldOutcome.key) : undefined;
  if (choice.worldOutcome && decided !== undefined && decided !== choice.worldOutcome.value) {
    return { ok: false, reason: 'That matter has already been settled another way.' };
  }
  const unmet = choice.requires.some((requirement) => {
    if (requirement.type === 'visited-location') return !character.visitedLocationIds.includes(requirement.locationId);
    if (requirement.type === 'possess-item') return !character.inventory.some((item) => item.id === requirement.itemId);
    if (requirement.type === 'quest-completed') {
      return !character.questProgress.some((entry) => entry.questId === requirement.questId && entry.status === 'completed');
    }
    return worldOutcomes?.get(requirement.key) !== requirement.value;
  });
  if (unmet) return { ok: false, reason: 'You cannot make that choice yet.' };
  return { ok: true, choice, branch };
}

/** World outcome keys any quest in this world can set. */
export function questWorldOutcomeKeys(world: Pick<WorldPackDraft, 'quests'>): Set<string> {
  return new Set((world.quests ?? []).flatMap((quest) =>
    quest.branching?.branches.flatMap((branch) => branch.choices.flatMap((choice) =>
      choice.worldOutcome ? [choice.worldOutcome.key] : [])) ?? []));
}

function npcName(world: WorldPackDraft, npcId: string): string | undefined {
  for (const location of world.locations) {
    const npc = location.npcs?.find((candidate) => candidate.id === npcId);
    if (npc) return npc.name;
  }
  return undefined;
}

export function projectQuestJournal(
  character: CharacterProjection,
  world: WorldPackDraft,
  worldOutcomes?: QuestWorldOutcomeValues,
) {
  const progressById = new Map(character.questProgress.map((progress) => [progress.questId, progress]));
  const quests = (world.quests ?? []).flatMap((candidate) => {
    if (candidate.scope === 'party') return [];
    const progress = progressById.get(candidate.id);
    if (!progress) return [];
    const quest = resolveQuestDefinition(world, progress);
    const objective = (objectiveId: string) => quest.objectives.find((entry) => entry.id === objectiveId)!;
    const entry = (objectives: QuestDefinition['objectives']) => objectives.map(({ id, label }) => ({
      id,
      label,
      completed: questObjectiveIsComplete(quest, id, character),
    }));
    if (!quest.branching) {
      return [{
        questId: quest.id,
        title: quest.title,
        summary: quest.summary,
        status: progress.status,
        objectives: entry(quest.objectives),
      }];
    }
    const path = questPathBranches(quest, progress);
    const current = path.at(-1)!;
    const allChoices = quest.branching.branches.flatMap((branch) => branch.choices);
    const outcome = quest.branching.outcomes.find((candidate) =>
      candidate.id === (progress.outcomeId ?? (progress.status === 'completed' ? current.outcomeId : undefined)));
    const declared = allChoices.flatMap((choice) => choice.worldOutcome ? [choice.worldOutcome] : []);
    const settled = [...new Set(declared.map(({ key }) => key))].flatMap((key) => {
      const value = worldOutcomes?.get(key);
      if (value === undefined) return [];
      const label = declared.find((outcome) => outcome.key === key && outcome.value === value)?.label ?? value;
      return [{ key, value, label }];
    });
    return [{
      questId: quest.id,
      title: quest.title,
      summary: quest.summary,
      status: progress.status,
      objectives: entry(path.flatMap((branch) => branch.objectiveIds.map(objective))),
      branch: { id: current.id, label: current.label, ...(current.summary ? { summary: current.summary } : {}) },
      decisions: (progress.choiceIds ?? []).map((choiceId) => ({
        choiceId,
        label: allChoices.find((choice) => choice.id === choiceId)!.label,
      })),
      availableChoices: current.choices
        .filter((choice) => checkQuestChoice(quest, character, choice.id, worldOutcomes).ok)
        .map((choice) => {
          const name = npcName(world, choice.npcId);
          return { choiceId: choice.id, label: choice.label, npcId: choice.npcId, ...(name ? { npcName: name } : {}) };
        }),
      ...(outcome ? { outcome } : {}),
      ...(settled.length ? { worldOutcomes: settled } : {}),
    }];
  });
  return QuestJournalSchema.parse(quests);
}
