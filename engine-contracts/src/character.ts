/** PROPOSED minimal character intent/view, independent of race/class rulesets. */
import { z } from 'zod';
import { ClientCommandBaseSchema, DomainEventBaseSchema } from './protocol.js';
import { IdSchema, NonEmptyNameSchema, NonNegativeIntSchema, ContractVersionSchema } from './ids.js';

export const InventoryItemProjectionSchema = z.object({
  id: IdSchema,
  label: z.string().min(1).max(120),
  description: z.string().min(1).max(1000),
}).strict();

export const CreateCharacterCommandSchema = z.object({
  type: z.literal('character.create'),
  version: ContractVersionSchema,
  commandId: IdSchema,
  worldInstanceId: IdSchema,
  payload: z.object({ name: NonEmptyNameSchema }).strict(),
}).strict();

export const CharacterCreatedEventSchema = DomainEventBaseSchema.extend({
  type: z.literal('character.created'),
  payload: z.object({ characterId: IdSchema, playerId: IdSchema, name: NonEmptyNameSchema, startingLocationId: IdSchema }).strict(),
}).strict();

export const TakeCharacterItemCommandSchema = ClientCommandBaseSchema.extend({
  type: z.literal('character.take'),
  expectedVersion: NonNegativeIntSchema,
  payload: z.object({ itemId: IdSchema }).strict(),
}).strict();

export const CharacterItemTakenEventSchema = DomainEventBaseSchema.extend({
  type: z.literal('character.item_taken'),
  payload: z.object({
    characterId: IdSchema,
    locationId: IdSchema,
    item: InventoryItemProjectionSchema,
  }).strict(),
}).strict();

export const RenameCharacterCommandSchema = z.object({
  type: z.literal('character.rename'),
  version: ContractVersionSchema,
  commandId: IdSchema,
  worldInstanceId: IdSchema,
  characterId: IdSchema,
  expectedVersion: NonNegativeIntSchema,
  payload: z.object({ name: NonEmptyNameSchema }).strict(),
}).strict();

export const CharacterRenamedEventSchema = DomainEventBaseSchema.extend({
  type: z.literal('character.renamed'),
  payload: z.object({ characterId: IdSchema, name: NonEmptyNameSchema }).strict(),
}).strict();

export const ArchiveCharacterCommandSchema = z.object({
  type: z.literal('character.archive'),
  version: ContractVersionSchema,
  commandId: IdSchema,
  worldInstanceId: IdSchema,
  characterId: IdSchema,
  expectedVersion: NonNegativeIntSchema,
  payload: z.object({}).strict(),
}).strict();

export const CharacterArchivedEventSchema = DomainEventBaseSchema.extend({
  type: z.literal('character.archived'),
  payload: z.object({ characterId: IdSchema }).strict(),
}).strict();

export const RestoreCharacterCommandSchema = z.object({
  type: z.literal('character.restore'),
  version: ContractVersionSchema,
  commandId: IdSchema,
  worldInstanceId: IdSchema,
  characterId: IdSchema,
  expectedVersion: NonNegativeIntSchema,
  payload: z.object({}).strict(),
}).strict();

export const CharacterRestoredEventSchema = DomainEventBaseSchema.extend({
  type: z.literal('character.restored'),
  payload: z.object({ characterId: IdSchema }).strict(),
}).strict();

export const CharacterProjectionSchema = z.object({
  worldInstanceId: IdSchema,
  characterId: IdSchema,
  name: NonEmptyNameSchema,
  locationId: IdSchema,
  revision: NonNegativeIntSchema,
  inventory: z.array(InventoryItemProjectionSchema).default([]),
  archived: z.boolean().default(false),
}).strict();

export type CreateCharacterCommand = z.infer<typeof CreateCharacterCommandSchema>;
export type CharacterCreatedEvent = z.infer<typeof CharacterCreatedEventSchema>;
export type TakeCharacterItemCommand = z.infer<typeof TakeCharacterItemCommandSchema>;
export type CharacterItemTakenEvent = z.infer<typeof CharacterItemTakenEventSchema>;
export type InventoryItemProjection = z.infer<typeof InventoryItemProjectionSchema>;
export type RenameCharacterCommand = z.infer<typeof RenameCharacterCommandSchema>;
export type ArchiveCharacterCommand = z.infer<typeof ArchiveCharacterCommandSchema>;
export type RestoreCharacterCommand = z.infer<typeof RestoreCharacterCommandSchema>;
export type CharacterProjection = z.infer<typeof CharacterProjectionSchema>;
