/** PROPOSED minimal character intent/view, independent of race/class rulesets. */
import { z } from 'zod';
import { ClientCommandBaseSchema, DomainEventBaseSchema } from './protocol.js';
import { IdSchema, NonEmptyNameSchema, NonNegativeIntSchema, ContractVersionSchema } from './ids.js';

export const InventoryItemProjectionSchema = z.object({
  id: IdSchema,
  label: z.string().min(1).max(120),
  description: z.string().min(1).max(1000),
}).strict();

export const CharacterWalletSchema = z.object({
  currencyId: IdSchema,
  balance: NonNegativeIntSchema.max(2_147_483_647),
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
  payload: z.object({
    characterId: IdSchema,
    playerId: IdSchema,
    name: NonEmptyNameSchema,
    startingLocationId: IdSchema,
    wallet: CharacterWalletSchema.optional(),
  }).strict(),
}).strict();

export const InitializeCharacterWalletCommandSchema = ClientCommandBaseSchema.extend({
  type: z.literal('character.wallet.initialize'),
  expectedVersion: NonNegativeIntSchema,
  payload: z.object({}).strict(),
}).strict();

export const CharacterWalletInitializedEventSchema = DomainEventBaseSchema.extend({
  type: z.literal('character.wallet_initialized'),
  payload: z.object({
    characterId: IdSchema,
    wallet: CharacterWalletSchema,
  }).strict(),
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

export const DropCharacterItemCommandSchema = ClientCommandBaseSchema.extend({
  type: z.literal('character.drop'),
  expectedVersion: NonNegativeIntSchema,
  payload: z.object({ itemId: IdSchema }).strict(),
}).strict();

export const UseCharacterItemCommandSchema = ClientCommandBaseSchema.extend({
  type: z.literal('character.use'),
  expectedVersion: NonNegativeIntSchema,
  payload: z.object({ itemId: IdSchema, targetId: IdSchema }).strict(),
}).strict();

export const CharacterItemUsedEventSchema = DomainEventBaseSchema.extend({
  type: z.literal('character.item_used'),
  payload: z.object({
    characterId: IdSchema,
    locationId: IdSchema,
    itemId: IdSchema,
    targetId: IdSchema,
    interactionId: IdSchema,
    response: z.string().min(1).max(2000),
  }).strict(),
}).strict();

export const ReadCharacterObjectCommandSchema = ClientCommandBaseSchema.extend({
  type: z.literal('character.read'),
  expectedVersion: NonNegativeIntSchema,
  payload: z.object({ objectId: IdSchema }).strict(),
}).strict();

export const CharacterObjectReadEventSchema = DomainEventBaseSchema.extend({
  type: z.literal('character.object_read'),
  payload: z.object({
    characterId: IdSchema,
    locationId: IdSchema,
    objectId: IdSchema,
    label: NonEmptyNameSchema,
    text: z.string().min(1).max(4000),
  }).strict(),
}).strict();

export const CharacterItemDroppedEventSchema = DomainEventBaseSchema.extend({
  type: z.literal('character.item_dropped'),
  payload: z.object({
    characterId: IdSchema,
    locationId: IdSchema,
    item: InventoryItemProjectionSchema,
  }).strict(),
}).strict();

export const CharacterNpcDialogueChoiceMadeEventSchema = DomainEventBaseSchema.extend({
  type: z.literal('character.npc_dialogue_choice_made'),
  payload: z.object({
    characterId: IdSchema,
    npcId: IdSchema,
    choiceId: IdSchema,
    progressFlagId: IdSchema,
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
  visitedLocationIds: z.array(IdSchema).default([]),
  revision: NonNegativeIntSchema,
  inventory: z.array(InventoryItemProjectionSchema).default([]),
  wallet: CharacterWalletSchema.optional(),
  purchasedMerchantListingIds: z.array(IdSchema).default([]),
  itemLocations: z.array(z.object({
    item: InventoryItemProjectionSchema,
    locationId: IdSchema.nullable(),
  }).strict()).default([]),
  npcProgress: z.array(z.object({
    npcId: IdSchema,
    progressFlagIds: z.array(IdSchema).default([]),
    lastChoiceId: IdSchema.optional(),
  }).strict()).default([]),
  readableObservations: z.array(z.object({
    objectId: IdSchema,
    locationId: IdSchema,
  }).strict()).default([]),
  itemUseObservations: z.array(z.object({
    interactionId: IdSchema,
    itemId: IdSchema,
    targetId: IdSchema,
    locationId: IdSchema,
  }).strict()).default([]),
  questProgress: z.array(z.object({
    questId: IdSchema,
    definitionVersion: z.string().min(1).max(40),
    status: z.enum(['active', 'completed']),
  }).strict()).default([]),
  archived: z.boolean().default(false),
}).strict();

export type CreateCharacterCommand = z.infer<typeof CreateCharacterCommandSchema>;
export type CharacterCreatedEvent = z.infer<typeof CharacterCreatedEventSchema>;
export type TakeCharacterItemCommand = z.infer<typeof TakeCharacterItemCommandSchema>;
export type CharacterItemTakenEvent = z.infer<typeof CharacterItemTakenEventSchema>;
export type DropCharacterItemCommand = z.infer<typeof DropCharacterItemCommandSchema>;
export type UseCharacterItemCommand = z.infer<typeof UseCharacterItemCommandSchema>;
export type CharacterItemUsedEvent = z.infer<typeof CharacterItemUsedEventSchema>;
export type ReadCharacterObjectCommand = z.infer<typeof ReadCharacterObjectCommandSchema>;
export type CharacterObjectReadEvent = z.infer<typeof CharacterObjectReadEventSchema>;
export type CharacterItemDroppedEvent = z.infer<typeof CharacterItemDroppedEventSchema>;
export type CharacterNpcDialogueChoiceMadeEvent = z.infer<typeof CharacterNpcDialogueChoiceMadeEventSchema>;
export type InventoryItemProjection = z.infer<typeof InventoryItemProjectionSchema>;
export type CharacterWallet = z.infer<typeof CharacterWalletSchema>;
export type InitializeCharacterWalletCommand = z.infer<typeof InitializeCharacterWalletCommandSchema>;
export type CharacterWalletInitializedEvent = z.infer<typeof CharacterWalletInitializedEventSchema>;
export type RenameCharacterCommand = z.infer<typeof RenameCharacterCommandSchema>;
export type ArchiveCharacterCommand = z.infer<typeof ArchiveCharacterCommandSchema>;
export type RestoreCharacterCommand = z.infer<typeof RestoreCharacterCommandSchema>;
export type CharacterProjection = z.infer<typeof CharacterProjectionSchema>;
