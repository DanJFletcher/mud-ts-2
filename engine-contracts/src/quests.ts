import { z } from 'zod';
import { ClientQueryBaseSchema, DomainEventBaseSchema } from './protocol.js';
import { IdSchema } from './ids.js';

export const QuestDialogueActionSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('accept'), questId: IdSchema }).strict(),
  z.object({ type: z.literal('turn-in'), questId: IdSchema }).strict(),
]);

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
    type: z.literal('defeat-npc'),
    npcId: IdSchema,
    requiredCount: z.number().int().min(1).max(100),
  }).strict(),
]);

export const QuestCurrencyRewardSchema = z.object({
  currencyId: IdSchema,
  amount: z.number().int().min(1).max(2_147_483_647),
}).strict();

export const QuestDefinitionSchema = z.object({
  id: IdSchema,
  version: z.string().trim().min(1).max(40),
  title: z.string().trim().min(1).max(120),
  summary: z.string().trim().min(1).max(500),
  scope: z.enum(['character', 'party']).optional(),
  giverNpcId: IdSchema,
  turnInNpcId: IdSchema,
  reward: QuestCurrencyRewardSchema.optional(),
  objectives: z.array(QuestObjectiveDefinitionSchema).min(1).max(12),
}).strict().superRefine((quest, context) => {
  if (quest.reward && quest.scope === 'party') {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['reward'],
      message: 'Currency rewards currently require character quest scope.',
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
  });
});

export const QuestAcceptedEventSchema = DomainEventBaseSchema.extend({
  type: z.literal('quest.accepted'),
  payload: z.object({
    characterId: IdSchema,
    questId: IdSchema,
    definitionVersion: z.string().min(1).max(40),
  }).strict(),
}).strict();

export const QuestCompletedEventSchema = DomainEventBaseSchema.extend({
  type: z.literal('quest.completed'),
  payload: z.object({
    characterId: IdSchema,
    questId: IdSchema,
    definitionVersion: z.string().min(1).max(40),
  }).strict(),
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
  }).strict(),
}).strict();

export const QuestProgressSchema = z.object({
  questId: IdSchema,
  definitionVersion: z.string().min(1).max(40),
  status: z.enum(['active', 'completed']),
}).strict();

export const QuestJournalObjectiveSchema = z.object({
  id: IdSchema,
  label: z.string().min(1).max(160),
  completed: z.boolean(),
}).strict();

export const QuestJournalEntrySchema = z.object({
  questId: IdSchema,
  title: z.string().min(1).max(120),
  summary: z.string().min(1).max(500),
  status: z.enum(['active', 'completed']),
  objectives: z.array(QuestJournalObjectiveSchema),
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
export type QuestObjectiveDefinition = z.infer<typeof QuestObjectiveDefinitionSchema>;
export type QuestDefinition = z.infer<typeof QuestDefinitionSchema>;
export type QuestAcceptedEvent = z.infer<typeof QuestAcceptedEventSchema>;
export type QuestCompletedEvent = z.infer<typeof QuestCompletedEventSchema>;
export type CharacterQuestRewardedEvent = z.infer<typeof CharacterQuestRewardedEventSchema>;
export type QuestProgress = z.infer<typeof QuestProgressSchema>;
export type QuestJournalEntry = z.infer<typeof QuestJournalEntrySchema>;
export type PartyQuestJournal = z.infer<typeof PartyQuestJournalSchema>;
