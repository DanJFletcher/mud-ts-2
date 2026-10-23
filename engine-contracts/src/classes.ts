/** Optional ruleset contracts; IDs and catalog contents are world-owned. */
import { z } from 'zod';
import { IdSchema, NonNegativeIntSchema } from './ids.js';
import { ClientCommandBaseSchema, DomainEventBaseSchema } from './protocol.js';

export const ClassAttributesSchema = z.object({
  strength: z.number().int().min(5).max(20),
  intelligence: z.number().int().min(5).max(20),
  constitution: z.number().int().min(10).max(20),
  dexterity: z.number().int().min(5).max(20),
}).strict();
export const ClassResourceCostSchema = z.object({
  resource: z.enum(['stamina', 'mana']),
  amount: z.number().int().min(1).max(100),
}).strict();
export const ClassAbilityDefinitionSchema = z.object({
  id: IdSchema,
  revision: z.number().int().positive(),
  label: z.string().min(1).max(80),
  description: z.string().min(1).max(1000),
  cost: ClassResourceCostSchema,
  baseDamage: z.number().int().min(1).max(10),
  scalingAttribute: z.enum(['strength', 'dexterity', 'intelligence']),
  weaponBonus: z.boolean(),
}).strict();
const classShape = {
  id: IdSchema,
  revision: z.number().int().positive(),
  label: z.string().min(1).max(80),
  description: z.string().min(1).max(1000),
  primaryAttribute: z.enum(['strength', 'dexterity', 'intelligence']),
  attributes: ClassAttributesSchema,
  coreAction: ClassAbilityDefinitionSchema,
};
export const CharacterClassDefinitionSchema = z.object(classShape).strict();
export const CharacterClassSnapshotSchema = z.object({
  ...classShape,
  catalogId: IdSchema,
  catalogRevision: z.number().int().positive(),
}).strict();
export const CharacterClassCatalogSchema = z.object({
  id: IdSchema,
  revision: z.number().int().positive(),
  classes: z.array(CharacterClassDefinitionSchema).min(1).max(12),
}).strict().superRefine((catalog, context) => {
  for (const [index, definition] of catalog.classes.entries()) {
    if (definition.primaryAttribute !== definition.coreAction.scalingAttribute) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ['classes', index, 'coreAction', 'scalingAttribute'],
        message: 'A starter core action must scale from its class primary attribute.' });
    }
    if (Object.values(definition.attributes).reduce((sum, value) => sum + value, 0) > 60) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ['classes', index, 'attributes'],
        message: 'Starter attributes may total at most 60.' });
    }
  }
  for (const field of ['id', 'coreAction'] as const) {
    const ids = catalog.classes.map((entry) => field === 'id' ? entry.id : entry.coreAction.id);
    if (new Set(ids).size !== ids.length) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: 'Class and action IDs must be unique.' });
    }
  }
});
export const AvailableClassActionSchema = ClassAbilityDefinitionSchema.extend({
  available: z.boolean(),
  unavailableReason: z.string().min(1).max(500).optional(),
});
export const ChooseCharacterClassCommandSchema = ClientCommandBaseSchema.extend({
  type: z.literal('character.class.choose'),
  expectedVersion: NonNegativeIntSchema,
  payload: z.object({ classId: IdSchema }).strict(),
}).strict();
export const CharacterClassSelectedEventSchema = DomainEventBaseSchema.extend({
  type: z.literal('character.class_selected'),
  version: z.literal(1),
  payload: z.object({
    characterId: IdSchema,
    characterClass: CharacterClassSnapshotSchema,
    attributes: ClassAttributesSchema,
    health: z.object({ current: NonNegativeIntSchema, maximum: z.number().int().positive().max(1000) }).strict(),
  }).strict(),
}).strict();
export const CharacterAbilityResourceSpentEventSchema = DomainEventBaseSchema.extend({
  type: z.literal('character.ability_resource_spent'),
  version: z.literal(1),
  payload: z.object({
    characterId: IdSchema,
    encounterId: IdSchema,
    actionId: IdSchema,
    abilityId: IdSchema,
    abilityRevision: z.number().int().positive(),
    cost: ClassResourceCostSchema,
    remaining: NonNegativeIntSchema.max(1000),
  }).strict(),
}).strict();
export type CharacterClassCatalog = z.infer<typeof CharacterClassCatalogSchema>;
export type CharacterClassDefinition = z.infer<typeof CharacterClassDefinitionSchema>;
export type CharacterClassSnapshot = z.infer<typeof CharacterClassSnapshotSchema>;
export type AvailableClassAction = z.infer<typeof AvailableClassActionSchema>;
