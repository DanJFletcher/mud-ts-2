import { z } from 'zod';
import { DomainEventBaseSchema } from './protocol.js';
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
]);

export const QuestDefinitionSchema = z.object({
  id: IdSchema,
  version: z.string().trim().min(1).max(40),
  title: z.string().trim().min(1).max(120),
  summary: z.string().trim().min(1).max(500),
  giverNpcId: IdSchema,
  turnInNpcId: IdSchema,
  objectives: z.array(QuestObjectiveDefinitionSchema).min(1).max(12),
}).strict().superRefine((quest, context) => {
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

export type QuestDialogueAction = z.infer<typeof QuestDialogueActionSchema>;
export type QuestObjectiveDefinition = z.infer<typeof QuestObjectiveDefinitionSchema>;
export type QuestDefinition = z.infer<typeof QuestDefinitionSchema>;
export type QuestAcceptedEvent = z.infer<typeof QuestAcceptedEventSchema>;
export type QuestCompletedEvent = z.infer<typeof QuestCompletedEventSchema>;
export type QuestProgress = z.infer<typeof QuestProgressSchema>;
export type QuestJournalEntry = z.infer<typeof QuestJournalEntrySchema>;
