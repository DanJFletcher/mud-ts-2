import { z } from 'zod';
import { ClientCommandBaseSchema, ClientQueryBaseSchema, DomainEventBaseSchema } from './protocol.js';
import { IdSchema, NonNegativeIntSchema } from './ids.js';

export const QuestDialogueActionSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('accept'), questId: IdSchema }).strict(),
  z.object({ type: z.literal('turn-in'), questId: IdSchema }).strict(),
  /** Select an authored branching-quest choice; revalidated by the server on submission. */
  z.object({ type: z.literal('choose'), questId: IdSchema, choiceId: IdSchema }).strict(),
]);

/** A shared fact one quest owns, such as how a town regulates passage. Set once per world instance. */
export const QuestWorldOutcomeSchema = z.object({
  key: IdSchema,
  value: IdSchema,
  label: z.string().trim().min(1).max(160),
}).strict();

/** Only conditions the server can verify from authoritative character or world state. */
export const QuestChoicePrerequisiteSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('visited-location'), locationId: IdSchema }).strict(),
  z.object({ type: z.literal('possess-item'), itemId: IdSchema }).strict(),
  z.object({ type: z.literal('quest-completed'), questId: IdSchema }).strict(),
  z.object({ type: z.literal('world-outcome'), key: IdSchema, value: IdSchema }).strict(),
]);

export const QuestChoiceDefinitionSchema = z.object({
  id: IdSchema,
  label: z.string().trim().min(1).max(120),
  /** The NPC who must be present when the choice is made. */
  npcId: IdSchema,
  toBranchId: IdSchema,
  requires: z.array(QuestChoicePrerequisiteSchema).max(8).default([]),
  worldOutcome: QuestWorldOutcomeSchema.optional(),
}).strict();

export const QuestBranchDefinitionSchema = z.object({
  id: IdSchema,
  label: z.string().trim().min(1).max(120),
  summary: z.string().trim().min(1).max(500).optional(),
  /** Objectives that must be complete before leaving or finishing this branch. */
  objectiveIds: z.array(IdSchema).max(12).default([]),
  choices: z.array(QuestChoiceDefinitionSchema).max(6).default([]),
  /** Present only on terminal branches. */
  outcomeId: IdSchema.optional(),
}).strict();

export const QuestOutcomeDefinitionSchema = z.object({
  id: IdSchema,
  label: z.string().trim().min(1).max(120),
  summary: z.string().trim().min(1).max(500),
}).strict();

export const QuestBranchingDefinitionSchema = z.object({
  startBranchId: IdSchema,
  branches: z.array(QuestBranchDefinitionSchema).min(2).max(16),
  outcomes: z.array(QuestOutcomeDefinitionSchema).min(1).max(8),
}).strict();

/**
 * The stable shape of an earlier definition version that active progress may
 * still reference. Every ID listed here must keep its meaning in the current
 * version; choices must keep the same source and destination branches.
 */
export const QuestPreviousVersionSchema = z.object({
  version: z.string().trim().min(1).max(40),
  objectiveIds: z.array(IdSchema).max(12),
  branchIds: z.array(IdSchema).max(16).default([]),
  choices: z.array(z.object({
    id: IdSchema,
    fromBranchId: IdSchema,
    toBranchId: IdSchema,
  }).strict()).max(96).default([]),
  outcomeIds: z.array(IdSchema).max(8).default([]),
}).strict();

export const QuestObjectiveDefinitionSchema = z.discriminatedUnion('type', [
  z.object({
    id: IdSchema,
    label: z.string().trim().min(1).max(160),
    type: z.literal('read-object'),
    objectId: IdSchema,
    locationId: IdSchema,
  }).strict(),
  z.object({
    id: IdSchema,
    label: z.string().trim().min(1).max(160),
    type: z.literal('visit-location'),
    locationId: IdSchema,
  }).strict(),
  z.object({
    id: IdSchema,
    label: z.string().trim().min(1).max(160),
    type: z.literal('perform-interaction'),
    interactionId: IdSchema,
    locationId: IdSchema,
  }).strict(),
  z.object({
    id: IdSchema,
    label: z.string().trim().min(1).max(160),
    type: z.literal('possess-item'),
    itemId: IdSchema,
  }).strict(),
  z.object({
    id: IdSchema,
    label: z.string().trim().min(1).max(160),
    type: z.literal('defeat-npc'),
    npcId: IdSchema,
    requiredCount: z.number().int().min(1).max(100),
  }).strict(),
]);

export const QuestRewardSchema = z.object({
  currencyId: IdSchema,
  amount: z.number().int().min(1).max(2_147_483_647),
  /** Already-carried unique items that are returned to the character at turn-in. */
  itemIds: z.array(IdSchema).max(12).optional(),
}).strict();

/** @deprecated Use QuestRewardSchema. */
export const QuestCurrencyRewardSchema = QuestRewardSchema;

type QuestGraphInput = {
  version: string;
  scope?: 'character' | 'party' | undefined;
  objectives: ReadonlyArray<{ id: string }>;
  branching?: z.infer<typeof QuestBranchingDefinitionSchema> | undefined;
  previousVersions?: ReadonlyArray<z.infer<typeof QuestPreviousVersionSchema>> | undefined;
};

/**
 * Load-time checks for branch graphs and version manifests. A valid graph starts
 * at one branch, reaches every branch, never revisits a branch, and ends every
 * path at a terminal branch with an outcome.
 */
function questGraphIssues(quest: QuestGraphInput): Array<{ path: Array<string | number>; message: string }> {
  const issues: Array<{ path: Array<string | number>; message: string }> = [];
  const objectiveIds = new Set(quest.objectives.map((objective) => objective.id));
  const branching = quest.branching;
  const branchIds = new Set<string>();
  const choiceSources = new Map<string, { fromBranchId: string; toBranchId: string }>();
  if (branching) {
    if (quest.scope === 'party') {
      issues.push({ path: ['branching'], message: 'Branching quests currently require character quest scope.' });
    }
    const outcomeIds = new Set<string>();
    branching.outcomes.forEach((outcome, index) => {
      if (outcomeIds.has(outcome.id)) {
        issues.push({ path: ['branching', 'outcomes', index, 'id'], message: 'Quest outcome IDs must be unique.' });
      }
      outcomeIds.add(outcome.id);
    });
    branching.branches.forEach((branch, index) => {
      if (branchIds.has(branch.id)) {
        issues.push({ path: ['branching', 'branches', index, 'id'], message: 'Quest branch IDs must be unique.' });
      }
      branchIds.add(branch.id);
    });
    if (!branchIds.has(branching.startBranchId)) {
      issues.push({ path: ['branching', 'startBranchId'], message: 'The start branch must exist.' });
    }
    const objectiveOwners = new Map<string, string>();
    const usedOutcomeIds = new Set<string>();
    branching.branches.forEach((branch, branchIndex) => {
      const path = ['branching', 'branches', branchIndex];
      branch.objectiveIds.forEach((objectiveId, objectiveIndex) => {
        if (!objectiveIds.has(objectiveId)) {
          issues.push({ path: [...path, 'objectiveIds', objectiveIndex], message: `Branch ${branch.id} references missing objective ${objectiveId}.` });
        } else if (objectiveOwners.has(objectiveId)) {
          issues.push({ path: [...path, 'objectiveIds', objectiveIndex], message: `Objective ${objectiveId} belongs to more than one branch.` });
        }
        objectiveOwners.set(objectiveId, branch.id);
      });
      if (branch.outcomeId) {
        usedOutcomeIds.add(branch.outcomeId);
        if (!outcomeIds.has(branch.outcomeId)) {
          issues.push({ path: [...path, 'outcomeId'], message: `Branch ${branch.id} references missing outcome ${branch.outcomeId}.` });
        }
        if (branch.choices.length) {
          issues.push({ path: [...path, 'choices'], message: `Terminal branch ${branch.id} cannot offer choices.` });
        }
      } else if (!branch.choices.length) {
        issues.push({ path, message: `Branch ${branch.id} is a dead end; add a choice or an outcome.` });
      }
      branch.choices.forEach((choice, choiceIndex) => {
        const choicePath = [...path, 'choices', choiceIndex];
        if (choiceSources.has(choice.id)) {
          issues.push({ path: [...choicePath, 'id'], message: 'Quest choice IDs must be unique across the quest.' });
        }
        choiceSources.set(choice.id, { fromBranchId: branch.id, toBranchId: choice.toBranchId });
        if (!branchIds.has(choice.toBranchId)) {
          issues.push({ path: [...choicePath, 'toBranchId'], message: `Choice ${choice.id} leads to missing branch ${choice.toBranchId}.` });
        } else if (choice.toBranchId === branch.id) {
          issues.push({ path: [...choicePath, 'toBranchId'], message: `Choice ${choice.id} cannot return to its own branch.` });
        }
      });
    });
    for (const objectiveId of objectiveIds) {
      if (!objectiveOwners.has(objectiveId)) {
        issues.push({ path: ['objectives'], message: `Objective ${objectiveId} is not assigned to a branch.` });
      }
    }
    for (const outcomeId of outcomeIds) {
      if (!usedOutcomeIds.has(outcomeId)) {
        issues.push({ path: ['branching', 'outcomes'], message: `Outcome ${outcomeId} is not reachable from any branch.` });
      }
    }
    // Depth-first walk from the start: every branch must be reachable and no path may loop.
    const edges = new Map(branching.branches.map((branch) => [branch.id, branch.choices.map((choice) => choice.toBranchId)]));
    const reached = new Set<string>();
    const visiting = new Set<string>();
    let cyclic = false;
    const visit = (branchId: string) => {
      if (visiting.has(branchId)) { cyclic = true; return; }
      if (reached.has(branchId) || !edges.has(branchId)) return;
      visiting.add(branchId);
      for (const next of edges.get(branchId) ?? []) visit(next);
      visiting.delete(branchId);
      reached.add(branchId);
    };
    if (branchIds.has(branching.startBranchId)) visit(branching.startBranchId);
    if (cyclic) issues.push({ path: ['branching'], message: 'Quest branches cannot form a cycle.' });
    for (const branchId of branchIds) {
      if (!reached.has(branchId)) {
        issues.push({ path: ['branching', 'branches'], message: `Branch ${branchId} is unreachable from the start branch.` });
      }
    }
  }
  const previousVersionIds = new Set<string>();
  (quest.previousVersions ?? []).forEach((previous, index) => {
    const path = ['previousVersions', index];
    if (previous.version === quest.version || previousVersionIds.has(previous.version)) {
      issues.push({ path: [...path, 'version'], message: 'Previous quest versions must be distinct from each other and the current version.' });
    }
    previousVersionIds.add(previous.version);
    for (const objectiveId of previous.objectiveIds) {
      if (!objectiveIds.has(objectiveId)) {
        issues.push({ path, message: `Version ${previous.version} objective ${objectiveId} was removed; use a new quest ID or version manifest.` });
      }
    }
    if (Boolean(branching) !== previous.branchIds.length > 0) {
      issues.push({ path, message: `Version ${previous.version} cannot change whether the quest branches.` });
    }
    for (const branchId of previous.branchIds) {
      if (!branchIds.has(branchId)) {
        issues.push({ path, message: `Version ${previous.version} branch ${branchId} was removed.` });
      }
    }
    for (const choice of previous.choices) {
      const current = choiceSources.get(choice.id);
      if (!current || current.fromBranchId !== choice.fromBranchId || current.toBranchId !== choice.toBranchId) {
        issues.push({ path, message: `Version ${previous.version} choice ${choice.id} was removed or now leads somewhere else.` });
      }
    }
    for (const outcomeId of previous.outcomeIds) {
      if (!branching?.outcomes.some((outcome) => outcome.id === outcomeId)) {
        issues.push({ path, message: `Version ${previous.version} outcome ${outcomeId} was removed.` });
      }
    }
  });
  return issues;
}

export const QuestDefinitionSchema = z.object({
  id: IdSchema,
  version: z.string().trim().min(1).max(40),
  title: z.string().trim().min(1).max(120),
  summary: z.string().trim().min(1).max(500),
  scope: z.enum(['character', 'party']).optional(),
  giverNpcId: IdSchema,
  turnInNpcId: IdSchema,
  reward: QuestRewardSchema.optional(),
  objectives: z.array(QuestObjectiveDefinitionSchema).min(1).max(12),
  branching: QuestBranchingDefinitionSchema.optional(),
  previousVersions: z.array(QuestPreviousVersionSchema).max(16).optional(),
}).strict().superRefine((quest, context) => {
  for (const issue of questGraphIssues(quest)) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: issue.path, message: issue.message });
  }
  if (quest.reward && quest.scope === 'party') {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['reward'],
      message: 'Quest rewards currently require character quest scope.',
    });
  }
  if (quest.reward?.itemIds && new Set(quest.reward.itemIds).size !== quest.reward.itemIds.length) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['reward', 'itemIds'],
      message: 'Quest item rewards must reference distinct items.',
    });
  }
  const objectiveIds = new Set<string>();
  quest.objectives.forEach((objective, index) => {
    if (objectiveIds.has(objective.id)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['objectives', index, 'id'],
        message: 'Quest objective IDs must be unique.',
      });
    }
    objectiveIds.add(objective.id);
    if (objective.type === 'defeat-npc' && quest.scope !== 'party') {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['objectives', index],
        message: 'Defeat-NPC objectives require party quest scope.',
      });
    }
    if (objective.type === 'possess-item' && quest.scope === 'party') {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['objectives', index],
        message: 'Item-possession objectives require character quest scope.',
      });
    }
  });
});

export const QuestAcceptedEventSchema = DomainEventBaseSchema.extend({
  type: z.literal('quest.accepted'),
  payload: z.object({
    characterId: IdSchema,
    questId: IdSchema,
    definitionVersion: z.string().min(1).max(40),
    /** Present for branching quests; absent on linear quests and legacy events. */
    branchId: IdSchema.optional(),
  }).strict(),
}).strict();

export const QuestCompletedEventSchema = DomainEventBaseSchema.extend({
  type: z.literal('quest.completed'),
  payload: z.object({
    characterId: IdSchema,
    questId: IdSchema,
    definitionVersion: z.string().min(1).max(40),
    /** The terminal outcome reached by a branching quest. */
    outcomeId: IdSchema.optional(),
  }).strict(),
}).strict();

/** A character's authoritative branch transition. Replay rejects stale or repeated transitions. */
export const QuestChoiceSelectedEventSchema = DomainEventBaseSchema.extend({
  type: z.literal('quest.choice_selected'),
  version: z.literal(1),
  payload: z.object({
    characterId: IdSchema,
    questId: IdSchema,
    /** The definition version recorded when the quest was accepted. */
    definitionVersion: z.string().min(1).max(40),
    choiceId: IdSchema,
    fromBranchId: IdSchema,
    toBranchId: IdSchema,
  }).strict(),
}).strict();

/** The first committed decision for a shared world outcome key. Later decisions cannot replace it. */
export const QuestWorldOutcomeDecidedEventSchema = DomainEventBaseSchema.extend({
  type: z.literal('world.quest_outcome_decided'),
  version: z.literal(1),
  payload: z.object({
    key: IdSchema,
    value: IdSchema,
    questId: IdSchema,
    choiceId: IdSchema,
    definitionVersion: z.string().min(1).max(40),
    decidedByCharacterId: IdSchema,
  }).strict(),
}).strict();

export const QuestChoiceSelectCommandSchema = ClientCommandBaseSchema.extend({
  type: z.literal('quest.choice.select'),
  expectedVersion: NonNegativeIntSchema,
  payload: z.object({
    questId: IdSchema,
    choiceId: IdSchema,
    /** The branch the client saw; a different current branch makes the request stale. */
    fromBranchId: IdSchema,
  }).strict(),
}).strict();

export const QuestJournalQuerySchema = ClientQueryBaseSchema.extend({
  type: z.literal('quest.journal'),
  version: z.literal(1),
  payload: z.object({}).strict(),
}).strict();

export const CharacterQuestRewardedEventSchema = DomainEventBaseSchema.extend({
  type: z.literal('character.quest_rewarded'),
  version: z.literal(1),
  payload: z.object({
    characterId: IdSchema,
    questId: IdSchema,
    definitionVersion: z.string().min(1).max(40),
    currencyId: IdSchema,
    amount: z.number().int().min(1).max(2_147_483_647),
    itemIds: z.array(IdSchema).max(12).refine(
      (itemIds) => new Set(itemIds).size === itemIds.length,
      'Quest reward items must be distinct.',
    ).optional(),
  }).strict(),
}).strict();

export const QuestProgressSchema = z.object({
  questId: IdSchema,
  definitionVersion: z.string().min(1).max(40),
  status: z.enum(['active', 'completed']),
  branchId: IdSchema.optional(),
  choiceIds: z.array(IdSchema).max(16).optional(),
  outcomeId: IdSchema.optional(),
}).strict();

export const QuestJournalObjectiveSchema = z.object({
  id: IdSchema,
  label: z.string().min(1).max(160),
  completed: z.boolean(),
}).strict();

/** Branch details appear only on branching quests, so linear entries keep their original shape. */
export const QuestJournalEntrySchema = z.object({
  questId: IdSchema,
  title: z.string().min(1).max(120),
  summary: z.string().min(1).max(500),
  status: z.enum(['active', 'completed']),
  objectives: z.array(QuestJournalObjectiveSchema),
  branch: z.object({
    id: IdSchema,
    label: z.string().min(1).max(120),
    summary: z.string().min(1).max(500).optional(),
  }).strict().optional(),
  decisions: z.array(z.object({
    choiceId: IdSchema,
    label: z.string().min(1).max(120),
  }).strict()).max(16).optional(),
  /** Choices this character can make now, and who to speak with. */
  availableChoices: z.array(z.object({
    choiceId: IdSchema,
    label: z.string().min(1).max(120),
    npcId: IdSchema,
    npcName: z.string().min(1).max(120).optional(),
  }).strict()).max(6).optional(),
  outcome: z.object({
    id: IdSchema,
    label: z.string().min(1).max(120),
    summary: z.string().min(1).max(500),
  }).strict().optional(),
  /** Shared decisions already settled for this world, whoever made them. */
  worldOutcomes: z.array(z.object({
    key: IdSchema,
    value: IdSchema,
    label: z.string().min(1).max(160),
  }).strict()).max(16).optional(),
}).strict();

export const QuestJournalSchema = z.array(QuestJournalEntrySchema).max(100);

export const PartyQuestStartedEventSchema = z.object({
  type: z.literal('party.quest_started'),
  version: z.literal(1),
  payload: z.object({
    partyId: IdSchema,
    questId: IdSchema,
    definitionVersion: z.string().min(1).max(40),
    startedByPlayerId: IdSchema,
    startedAt: z.string().datetime(),
  }).strict(),
}).strict();

export const PartyQuestProgressedEventSchema = z.object({
  type: z.literal('party.quest_objective_progressed'),
  version: z.literal(1),
  payload: z.object({
    partyId: IdSchema,
    questId: IdSchema,
    objectiveId: IdSchema,
    progress: z.number().int().nonnegative(),
    sourceEffectId: IdSchema,
  }).strict(),
}).strict();

export const PartyQuestCompletedEventSchema = z.object({
  type: z.literal('party.quest_completed'),
  version: z.literal(1),
  payload: z.object({
    partyId: IdSchema,
    questId: IdSchema,
    completedAt: z.string().datetime(),
  }).strict(),
}).strict();

export const PartyQuestAbandonedEventSchema = z.object({
  type: z.literal('party.quest_abandoned'),
  version: z.literal(1),
  payload: z.object({
    partyId: IdSchema,
    questId: IdSchema,
    reason: z.literal('party-closed'),
    abandonedAt: z.string().datetime(),
  }).strict(),
}).strict();

export const PartyQuestStartCommandSchema = z.object({
  type: z.literal('party.quest.start'),
  version: z.literal(1),
  commandId: IdSchema,
  worldInstanceId: IdSchema,
  characterId: IdSchema,
  payload: z.object({ questId: IdSchema }).strict(),
}).strict();

export const PartyQuestJournalQuerySchema = ClientQueryBaseSchema.extend({
  type: z.literal('party.quests'),
  version: z.literal(1),
  payload: z.object({}).strict(),
}).strict();

export const PartyQuestObjectiveSchema = z.object({
  id: IdSchema,
  label: z.string().min(1).max(160),
  progress: z.number().int().nonnegative(),
  required: z.number().int().positive(),
  completed: z.boolean(),
}).strict();

export const PartyQuestEntrySchema = z.object({
  questId: IdSchema,
  title: z.string().min(1).max(120),
  summary: z.string().min(1).max(500),
  status: z.enum(['active', 'completed']),
  objectives: z.array(PartyQuestObjectiveSchema),
}).strict();

export const PartyQuestJournalSchema = z.object({
  partyId: IdSchema.nullable(),
  available: z.array(z.object({
    questId: IdSchema,
    title: z.string().min(1).max(120),
    summary: z.string().min(1).max(500),
  }).strict()),
  quests: z.array(PartyQuestEntrySchema).max(100),
}).strict();

export type QuestDialogueAction = z.infer<typeof QuestDialogueActionSchema>;
export type QuestChoicePrerequisite = z.infer<typeof QuestChoicePrerequisiteSchema>;
export type QuestChoiceDefinition = z.infer<typeof QuestChoiceDefinitionSchema>;
export type QuestBranchDefinition = z.infer<typeof QuestBranchDefinitionSchema>;
export type QuestChoiceSelectedEvent = z.infer<typeof QuestChoiceSelectedEventSchema>;
export type QuestWorldOutcomeDecidedEvent = z.infer<typeof QuestWorldOutcomeDecidedEventSchema>;
export type QuestChoiceSelectCommand = z.infer<typeof QuestChoiceSelectCommandSchema>;
export type QuestObjectiveDefinition = z.infer<typeof QuestObjectiveDefinitionSchema>;
export type QuestDefinition = z.infer<typeof QuestDefinitionSchema>;
export type QuestAcceptedEvent = z.infer<typeof QuestAcceptedEventSchema>;
export type QuestCompletedEvent = z.infer<typeof QuestCompletedEventSchema>;
export type CharacterQuestRewardedEvent = z.infer<typeof CharacterQuestRewardedEventSchema>;
export type QuestProgress = z.infer<typeof QuestProgressSchema>;
export type QuestJournalEntry = z.infer<typeof QuestJournalEntrySchema>;
export type PartyQuestJournal = z.infer<typeof PartyQuestJournalSchema>;
