/** PROPOSED v0.1: portable definitions vs runtime, read-only player projections. */
import { z } from 'zod';
import { ClientCommandBaseSchema, ClientQueryBaseSchema } from './protocol.js';
import { ContractVersionSchema, IdSchema, NonNegativeIntSchema } from './ids.js';

export const ExitDefinitionSchema = z.object({
  id: IdSchema,
  fromLocationId: IdSchema,
  toLocationId: IdSchema,
  label: z.string().min(1).max(120),
  direction: z.string().max(40).optional(),
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

export const NpcDialogueChoiceDefinitionSchema = z.object({
  id: IdSchema,
  label: z.string().min(1).max(120),
  response: z.string().min(1).max(2000),
  progressFlagId: IdSchema,
}).strict();

export const NpcDialogueDefinitionSchema = z.object({
  prompt: z.string().min(1).max(2000),
  choices: z.array(NpcDialogueChoiceDefinitionSchema).min(1).max(8),
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

export type ExitDefinition = z.infer<typeof ExitDefinitionSchema>;
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
export type NpcPresenceProjection = z.infer<typeof NpcPresenceProjectionSchema>;
export type NpcTalkQuery = z.infer<typeof NpcTalkQuerySchema>;
export type NpcDialogueChoiceCommand = z.infer<typeof NpcDialogueChoiceCommandSchema>;
export type NpcDialogueProjection = z.infer<typeof NpcDialogueProjectionSchema>;
export type ReadableObjectProjection = z.infer<typeof ReadableObjectProjectionSchema>;
export type ObjectInspectionProjection = z.infer<typeof ObjectInspectionProjectionSchema>;
export type LocationProjection = z.infer<typeof LocationProjectionSchema>;

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
  return errors;
}
