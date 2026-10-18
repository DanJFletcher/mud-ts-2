/** PROPOSED v0.1: portable definitions vs runtime, read-only player projections. */
import { z } from 'zod';
import { ClientCommandBaseSchema, ClientQueryBaseSchema } from './protocol.js';
import { ContractVersionSchema, IdSchema, NonNegativeIntSchema } from './ids.js';
import { QuestDefinitionSchema, QuestDialogueActionSchema } from './quests.js';

export const ExitDefinitionSchema = z.object({
  id: IdSchema,
  fromLocationId: IdSchema,
  toLocationId: IdSchema,
  label: z.string().min(1).max(120),
  direction: z.string().max(40).optional(),
}).strict();

export const MapPositionSchema = z.object({
  x: z.number().int().min(-10000).max(10000),
  y: z.number().int().min(-10000).max(10000),
}).strict();

export const ReadableObjectDefinitionSchema = z.object({
  id: IdSchema,
  label: z.string().min(1).max(120),
  description: z.string().min(1).max(1000),
  text: z.string().min(1).max(4000),
}).strict();

export const TakeableObjectDefinitionSchema = z.object({
  id: IdSchema,
  label: z.string().min(1).max(120),
  description: z.string().min(1).max(1000),
  roomDescription: z.string().min(1).max(1000).optional(),
}).strict();

export const NpcDialogueTopicDefinitionSchema = z.object({
  id: IdSchema,
  keywords: z.array(z.string().trim().min(1).max(80)).min(1).max(12),
  response: z.string().min(1).max(2000),
}).strict();

export const NpcQuestResponseDefinitionSchema = z.object({
  questId: IdSchema,
  status: z.enum(['active', 'completed']),
  requiresCompletedObjectiveIds: z.array(IdSchema).max(12).default([]),
  requiresIncompleteObjectiveIds: z.array(IdSchema).max(12).default([]),
  response: z.string().min(1).max(2000),
}).strict().superRefine((questResponse, context) => {
  const completedIds = new Set(questResponse.requiresCompletedObjectiveIds);
  for (const objectiveId of questResponse.requiresIncompleteObjectiveIds) {
    if (completedIds.has(objectiveId)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['requiresIncompleteObjectiveIds'],
        message: 'An objective cannot be required as both completed and incomplete.',
      });
      break;
    }
  }
});

export const NpcQuestStateConditionSchema = z.object({
  questId: IdSchema,
  status: z.enum(['active', 'completed']).optional(),
  requiresCompletedObjectiveIds: z.array(IdSchema).max(12).default([]),
  requiresIncompleteObjectiveIds: z.array(IdSchema).max(12).default([]),
}).strict().superRefine((condition, context) => {
  const completedIds = new Set(condition.requiresCompletedObjectiveIds);
  for (const objectiveId of condition.requiresIncompleteObjectiveIds) {
    if (completedIds.has(objectiveId)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['requiresIncompleteObjectiveIds'],
        message: 'An objective cannot be required as both completed and incomplete.',
      });
      break;
    }
  }
});

export const NpcDialogueChoiceDefinitionSchema = z.object({
  id: IdSchema,
  label: z.string().min(1).max(120),
  response: z.string().min(1).max(2000),
  progressFlagId: IdSchema,
  questCondition: NpcQuestStateConditionSchema.optional(),
  questAction: QuestDialogueActionSchema.optional(),
}).strict();

export const NpcDialogueDefinitionSchema = z.object({
  prompt: z.string().min(1).max(2000),
  choices: z.array(NpcDialogueChoiceDefinitionSchema).min(1).max(8),
  questResponses: z.array(NpcQuestResponseDefinitionSchema).max(24).optional(),
}).strict().superRefine((dialogue, context) => {
  const choiceIds = new Set<string>();
  const progressFlagIds = new Set<string>();
  dialogue.choices.forEach((choice, index) => {
    if (choiceIds.has(choice.id)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['choices', index, 'id'],
        message: 'Dialogue choice IDs must be unique.',
      });
    }
    if (progressFlagIds.has(choice.progressFlagId)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['choices', index, 'progressFlagId'],
        message: 'Dialogue progress flags must be unique.',
      });
    }
    choiceIds.add(choice.id);
    progressFlagIds.add(choice.progressFlagId);
  });
});

export const NpcDefinitionSchema = z.object({
  id: IdSchema,
  name: z.string().min(1).max(120),
  description: z.string().min(1).max(1000),
  greeting: z.string().min(1).max(2000),
  topics: z.array(NpcDialogueTopicDefinitionSchema).max(24),
  dialogue: NpcDialogueDefinitionSchema.optional(),
  unknownTopicResponse: z.string().min(1).max(2000),
  announcements: z.array(z.string().min(1).max(500)).max(24).optional(),
}).strict();

export const NpcPresenceProjectionSchema = z.object({
  id: IdSchema,
  name: z.string().min(1).max(120),
  description: z.string().min(1).max(1000),
}).strict();

export const LocationDefinitionSchema = z.object({
  id: IdSchema,
  name: z.string().min(1).max(160),
  description: z.string().min(1),
  regionId: IdSchema.optional(),
  mapPosition: MapPositionSchema.optional(),
  exits: z.array(ExitDefinitionSchema),
  readables: z.array(ReadableObjectDefinitionSchema).optional(),
  takeables: z.array(TakeableObjectDefinitionSchema).optional(),
  npcs: z.array(NpcDefinitionSchema).optional(),
}).strict();

export const WorldPackDraftSchema = z.object({
  formatVersion: ContractVersionSchema,
  packId: IdSchema,
  packVersion: z.string().min(1),
  displayName: z.string().min(1),
  locations: z.array(LocationDefinitionSchema),
  quests: z.array(QuestDefinitionSchema).default([]),
}).strict();

export const LocationDescribeQuerySchema = ClientQueryBaseSchema.extend({
  type: z.literal('location.describe'),
  payload: z.object({ locationId: IdSchema.optional() }).strict(),
}).strict();

export const ObjectReadQuerySchema = ClientQueryBaseSchema.extend({
  type: z.literal('object.read'),
  payload: z.object({ objectId: IdSchema }).strict(),
}).strict();

export const ObjectInspectQuerySchema = ClientQueryBaseSchema.extend({
  type: z.literal('object.inspect'),
  payload: z.object({ objectId: IdSchema }).strict(),
}).strict();

export const NpcTalkQuerySchema = ClientQueryBaseSchema.extend({
  type: z.literal('npc.talk'),
  payload: z.object({
    npcId: IdSchema,
    topic: z.string().trim().min(1).max(80).optional(),
  }).strict(),
}).strict();

export const NpcDialogueChoiceCommandSchema = ClientCommandBaseSchema.extend({
  type: z.literal('npc.dialogue.choose'),
  expectedVersion: NonNegativeIntSchema,
  payload: z.object({
    npcId: IdSchema,
    choiceId: IdSchema,
  }).strict(),
}).strict();

export const ReadableObjectProjectionSchema = z.object({
  id: IdSchema,
  label: z.string(),
  text: z.string().min(1).max(4000),
}).strict();

export const ObjectInspectionProjectionSchema = z.object({
  id: IdSchema,
  label: z.string(),
  description: z.string().min(1).max(1000),
}).strict();

export const NpcDialogueProjectionSchema = z.object({
  npcId: IdSchema,
  npcName: z.string().min(1).max(120),
  text: z.string().min(1).max(2000),
  choices: z.array(z.object({
    id: IdSchema,
    label: z.string().min(1).max(120),
  }).strict()).max(8),
}).strict();

export const ExitProjectionSchema = z.object({
  id: IdSchema,
  label: z.string(),
  direction: z.string().optional(),
  available: z.boolean(),
}).strict();

/** Projection is already filtered for the authenticated viewer. */
export const LocationProjectionSchema = z.object({
  worldInstanceId: IdSchema,
  locationId: IdSchema,
  revision: NonNegativeIntSchema,
  cursor: z.string().optional(),
  title: z.string(),
  description: z.string(),
  exits: z.array(ExitProjectionSchema),
  objects: z.array(z.object({
    id: IdSchema,
    label: z.string().min(1).max(120),
    description: z.string().min(1).max(1000),
    readable: z.boolean(),
    takeable: z.boolean(),
  }).strict()),
  occupants: z.array(z.object({ id: IdSchema, displayName: z.string() }).strict()),
  npcs: z.array(NpcPresenceProjectionSchema).optional(),
}).strict();

export const WorldMapProjectionSchema = z.object({
  worldInstanceId: IdSchema,
  currentLocationId: IdSchema,
  locations: z.array(z.object({
    id: IdSchema,
    name: z.string().min(1).max(160),
    x: z.number().int().min(-10000).max(10000),
    y: z.number().int().min(-10000).max(10000),
  }).strict()).min(1).max(500),
  connections: z.array(z.object({
    fromLocationId: IdSchema,
    toLocationId: IdSchema,
  }).strict()).max(2000),
}).strict();

export type ExitDefinition = z.infer<typeof ExitDefinitionSchema>;
export type MapPosition = z.infer<typeof MapPositionSchema>;
export type LocationDefinition = z.infer<typeof LocationDefinitionSchema>;
export type WorldPackDraft = z.infer<typeof WorldPackDraftSchema>;
export type LocationDescribeQuery = z.infer<typeof LocationDescribeQuerySchema>;
export type ObjectReadQuery = z.infer<typeof ObjectReadQuerySchema>;
export type ObjectInspectQuery = z.infer<typeof ObjectInspectQuerySchema>;
export type ReadableObjectDefinition = z.infer<typeof ReadableObjectDefinitionSchema>;
export type TakeableObjectDefinition = z.infer<typeof TakeableObjectDefinitionSchema>;
export type NpcDefinition = z.infer<typeof NpcDefinitionSchema>;
export type NpcDialogueDefinition = z.infer<typeof NpcDialogueDefinitionSchema>;
export type NpcDialogueChoiceDefinition = z.infer<typeof NpcDialogueChoiceDefinitionSchema>;
export type NpcQuestStateCondition = z.infer<typeof NpcQuestStateConditionSchema>;
export type NpcPresenceProjection = z.infer<typeof NpcPresenceProjectionSchema>;
export type NpcTalkQuery = z.infer<typeof NpcTalkQuerySchema>;
export type NpcDialogueChoiceCommand = z.infer<typeof NpcDialogueChoiceCommandSchema>;
export type NpcDialogueProjection = z.infer<typeof NpcDialogueProjectionSchema>;
export type ReadableObjectProjection = z.infer<typeof ReadableObjectProjectionSchema>;
export type ObjectInspectionProjection = z.infer<typeof ObjectInspectionProjectionSchema>;
export type LocationProjection = z.infer<typeof LocationProjectionSchema>;
export type WorldMapProjection = z.infer<typeof WorldMapProjectionSchema>;

export function validateDraftWorldGraph(pack: WorldPackDraft): string[] {
  const errors: string[] = [];
  const ids = new Set(pack.locations.map((room) => room.id));
  if (ids.size !== pack.locations.length) errors.push('Duplicate location ID');
  const exits = new Set<string>();
  for (const room of pack.locations) {
    for (const exit of room.exits) {
      if (exit.fromLocationId !== room.id) errors.push(`Exit ${exit.id} does not originate from its containing location`);
      if (!ids.has(exit.toLocationId)) errors.push(`Exit ${exit.id} points to missing location ${exit.toLocationId}`);
      if (exits.has(exit.id)) errors.push(`Duplicate exit ID ${exit.id}`);
      exits.add(exit.id);
    }
  }

  const quests = pack.quests ?? [];
  const questIds = new Set<string>();
  const npcs = pack.locations.flatMap((location) =>
    (location.npcs ?? []).map((npc) => ({ npc, locationId: location.id })),
  );
  for (const quest of quests) {
    if (questIds.has(quest.id)) errors.push(`Duplicate quest ID ${quest.id}`);
    questIds.add(quest.id);
    if (!npcs.some(({ npc }) => npc.id === quest.giverNpcId)) {
      errors.push(`Quest ${quest.id} has a missing giver NPC ${quest.giverNpcId}`);
    }
    if (!npcs.some(({ npc }) => npc.id === quest.turnInNpcId)) {
      errors.push(`Quest ${quest.id} has a missing turn-in NPC ${quest.turnInNpcId}`);
    }
    for (const objective of quest.objectives) {
      if (!ids.has(objective.locationId)) {
        errors.push(`Quest ${quest.id} objective ${objective.id} points to missing location ${objective.locationId}`);
      } else if (objective.type === 'read-object') {
        const location = pack.locations.find((candidate) => candidate.id === objective.locationId);
        if (!location?.readables?.some((readable) => readable.id === objective.objectId)) {
          errors.push(`Quest ${quest.id} objective ${objective.id} points to missing readable ${objective.objectId}`);
        }
      }
    }
  }
  for (const { npc } of npcs) {
    for (const questResponse of npc.dialogue?.questResponses ?? []) {
      const quest = quests.find((candidate) => candidate.id === questResponse.questId);
      if (!quest) {
        errors.push(`NPC ${npc.id} dialogue response references missing quest ${questResponse.questId}`);
        continue;
      }
      for (const objectiveId of [
        ...questResponse.requiresCompletedObjectiveIds,
        ...questResponse.requiresIncompleteObjectiveIds,
      ]) {
        if (!quest.objectives.some((objective) => objective.id === objectiveId)) {
          errors.push(
            `NPC ${npc.id} dialogue response references missing objective ${objectiveId} in quest ${quest.id}`,
          );
        }
      }
    }
    for (const choice of npc.dialogue?.choices ?? []) {
      if (choice.questCondition) {
        const quest = quests.find((candidate) => candidate.id === choice.questCondition?.questId);
        if (!quest) {
          errors.push(`Dialogue choice ${choice.id} references missing quest ${choice.questCondition.questId}`);
        } else {
          for (const objectiveId of [
            ...choice.questCondition.requiresCompletedObjectiveIds,
            ...choice.questCondition.requiresIncompleteObjectiveIds,
          ]) {
            if (!quest.objectives.some((objective) => objective.id === objectiveId)) {
              errors.push(
                `Dialogue choice ${choice.id} references missing objective ${objectiveId} in quest ${quest.id}`,
              );
            }
          }
        }
      }
      if (!choice.questAction) continue;
      const quest = quests.find((candidate) => candidate.id === choice.questAction?.questId);
      if (!quest) {
        errors.push(`Dialogue choice ${choice.id} references missing quest ${choice.questAction.questId}`);
      } else if (
        (choice.questAction.type === 'accept' && quest.giverNpcId !== npc.id) ||
        (choice.questAction.type === 'turn-in' && quest.turnInNpcId !== npc.id)
      ) {
        errors.push(`Dialogue choice ${choice.id} is attached to the wrong quest NPC`);
      }
    }
  }
  return errors;
}
