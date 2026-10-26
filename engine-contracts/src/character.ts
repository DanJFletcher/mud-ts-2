/** PROPOSED minimal character intent/view, independent of race/class rulesets. */
import { z } from 'zod';
import { ClientCommandBaseSchema, ClientQueryBaseSchema, DomainEventBaseSchema } from './protocol.js';
import {
  IdSchema, NonEmptyNameSchema, NonNegativeIntSchema, PositiveIntSchema, ContractVersionSchema,
  IsoDateTimeSchema,
} from './ids.js';
import { CombatEncounterProjectionSchema } from './combat.js';
import { CharacterHealthSchema } from './health.js';
import { CharacterClassSnapshotSchema, AvailableClassActionSchema } from './classes.js';
import { DailyJobStateSchema, SupplyCollectionStateSchema } from './daily-jobs.js';
import { FishCatchMetadataSchema, FishingCastStateSchema, FishingRodDefinitionSchema } from './fishing.js';
import { WoodcuttingAxeDefinitionSchema, WoodcuttingActionStateSchema, WoodcuttingSkillSchema } from './woodcutting.js';

export const ConsumableItemSchema = z.object({
  effect: z.literal('heal'),
  amount: PositiveIntSchema.max(1000),
}).strict();

export const InventoryEquipmentSchema = z.object({
  slot: z.enum(['weapon', 'armor']),
  attackBonus: NonNegativeIntSchema.max(10).default(0),
  defenseBonus: NonNegativeIntSchema.max(10).default(0),
}).strict().superRefine((equipment, context) => {
  if (equipment.slot === 'weapon' && equipment.defenseBonus > 0) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['defenseBonus'], message: 'Weapons cannot provide armor.' });
  }
  if (equipment.slot === 'armor' && equipment.attackBonus > 0) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['attackBonus'], message: 'Armor cannot provide weapon damage.' });
  }
});

export const InventoryItemProjectionSchema = z.object({
  id: IdSchema,
  typeId: IdSchema.optional(),
  /** Present only while this physical item is owned by the shared world-item aggregate. */
  sharedItemId: IdSchema.optional(),
  label: z.string().min(1).max(120),
  description: z.string().min(1).max(1000),
  questBound: z.boolean().optional(),
  consumable: ConsumableItemSchema.optional(),
  equipment: InventoryEquipmentSchema.optional(),
  fishingRod: FishingRodDefinitionSchema.optional(),
  fishCatch: FishCatchMetadataSchema.optional(),
  woodcuttingAxe: WoodcuttingAxeDefinitionSchema.optional(),
  stackable: z.boolean().optional(),
  quantity: PositiveIntSchema.max(2_147_483_647).optional(),
}).strict().superRefine((item, context) => {
  if (item.sharedItemId && item.sharedItemId !== item.id) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['sharedItemId'],
      message: 'A shared item ID must match its inventory item ID.',
    });
  }
  if (item.consumable && item.equipment) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['consumable'],
      message: 'Consumable items cannot also be equipped.',
    });
  }
  if (item.quantity && item.stackable !== true) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['quantity'],
      message: 'Only stackable items can have a quantity greater than one.',
    });
  }
  if (item.stackable && item.quantity === undefined) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['quantity'],
      message: 'Stackable items must specify their quantity.',
    });
  }
});

export const EquipmentSlotSchema = z.enum(['weapon', 'armor']);
export const CharacterEquipmentSchema = z.object({
  weaponItemId: IdSchema.nullable(),
  armorItemId: IdSchema.nullable(),
}).strict();

export const CharacterWalletSchema = z.object({
  currencyId: IdSchema,
  balance: NonNegativeIntSchema.max(2_147_483_647),
}).strict();

export const DEFAULT_CHARACTER_ATTRIBUTES = Object.freeze({
  strength: 10,
  intelligence: 10,
  constitution: 10,
  dexterity: 10,
});

export const DEFAULT_CHARACTER_HONORS = Object.freeze({
  glory: 0,
  medals: 0,
});

export const CharacterAttributesSchema = z.object({
  strength: PositiveIntSchema.max(100),
  intelligence: PositiveIntSchema.max(100),
  constitution: PositiveIntSchema.max(100),
  dexterity: PositiveIntSchema.max(100),
}).strict();

export const CharacterHonorsSchema = z.object({
  glory: NonNegativeIntSchema.max(2_147_483_647),
  medals: NonNegativeIntSchema.max(2_147_483_647),
}).strict();

export const CharacterResourcePoolSchema = z.object({
  current: NonNegativeIntSchema.max(1000),
  maximum: PositiveIntSchema.max(1000),
}).strict().superRefine((resource, context) => {
  if (resource.current > resource.maximum) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['current'],
      message: 'Current resource exceeds its maximum.',
    });
  }
});
export type CharacterResourcePool = z.infer<typeof CharacterResourcePoolSchema>;

export const CharacterResourcesSchema = z.object({
  stamina: CharacterResourcePoolSchema,
  mana: CharacterResourcePoolSchema,
}).strict();

export const StaminaPostureSchema = z.enum(['standing', 'resting']);
export const CharacterStaminaRecoverySchema = z.object({
  posture: StaminaPostureSchema.default('standing'),
  /** Null is used only by legacy streams until their first online settlement. */
  lastSettledAt: IsoDateTimeSchema.nullable().default(null),
  /** Hundred-thousandths of a stamina point, carried between settlements. */
  fractionalCarry: NonNegativeIntSchema.max(99_999).default(0),
  /** Independent hundred-thousandths of a health point. */
  healthFractionalCarry: NonNegativeIntSchema.max(99_999).default(0),
  /** Independent hundred-thousandths of a mana point. */
  manaFractionalCarry: NonNegativeIntSchema.max(99_999).default(0),
}).strict();
export type CharacterStaminaRecovery = z.infer<typeof CharacterStaminaRecoverySchema>;

export const DEFAULT_CHARACTER_RESOURCES = Object.freeze({
  stamina: Object.freeze({ current: 100, maximum: 100 }),
  mana: Object.freeze({ current: 100, maximum: 100 }),
});

export const CharacterStatsQuerySchema = ClientQueryBaseSchema.extend({
  type: z.literal('character.stats'),
  characterId: IdSchema,
  payload: z.object({}).strict(),
}).strict();

export const CharacterStatsProjectionSchema = z.object({
  attributes: CharacterAttributesSchema,
  attackPower: NonNegativeIntSchema.max(100_000),
  spellPower: NonNegativeIntSchema.max(100_000),
  damage: NonNegativeIntSchema.max(100_000),
  critChancePercent: z.number().min(0).max(100),
  healthRegen: NonNegativeIntSchema.max(100_000),
  manaRegen: NonNegativeIntSchema.max(100_000),
  staminaRegen: NonNegativeIntSchema.max(100_000),
  armorPercent: z.number().min(0).max(100),
  resiliencePercent: z.number().min(0).max(100),
  dodgePercent: z.number().min(0).max(100),
}).strict();

export const CharacterAdvancementProjectionSchema = z.object({
  experience: NonNegativeIntSchema.max(2_147_483_647),
  level: PositiveIntSchema,
  lastRewardedEncounterId: IdSchema.optional(),
}).strict();

const CharacterAdvancementAwardPayloadV1Schema = z.object({
  characterId: IdSchema,
  encounterId: IdSchema,
  experienceAwarded: PositiveIntSchema,
  totalExperience: NonNegativeIntSchema.max(2_147_483_647),
  level: PositiveIntSchema,
}).strict();

export const CharacterAdvancementAwardedEventV1Schema = DomainEventBaseSchema.extend({
  type: z.literal('character.advancement_awarded'),
  version: z.literal(1),
  payload: CharacterAdvancementAwardPayloadV1Schema,
}).strict();

export const CharacterAdvancementAwardedEventV2Schema = DomainEventBaseSchema.extend({
  type: z.literal('character.advancement_awarded'),
  version: z.literal(2),
  payload: CharacterAdvancementAwardPayloadV1Schema.extend({
    maximumHealth: PositiveIntSchema.max(1000),
    source: z.enum(['pve', 'team-pve']).optional(),
  }).strict(),
}).strict();

export const CharacterAdvancementAwardedEventSchema = z.discriminatedUnion('version', [
  CharacterAdvancementAwardedEventV1Schema,
  CharacterAdvancementAwardedEventV2Schema,
]);

export const CreateCharacterCommandSchema = z.object({
  type: z.literal('character.create'),
  version: ContractVersionSchema,
  commandId: IdSchema,
  worldInstanceId: IdSchema,
  payload: z.object({ name: NonEmptyNameSchema, classId: IdSchema.optional() }).strict(),
}).strict();

const CharacterCreatedPayloadSchema = z.object({
  characterId: IdSchema,
  playerId: IdSchema,
  name: NonEmptyNameSchema,
  startingLocationId: IdSchema,
  startingStateId: IdSchema.optional(),
  wallet: CharacterWalletSchema.optional(),
  attributes: CharacterAttributesSchema.optional(),
  honors: CharacterHonorsSchema.optional(),
}).strict();

export const CharacterCreatedEventSchema = DomainEventBaseSchema.extend({
  type: z.literal('character.created'),
  version: z.literal(1),
  payload: CharacterCreatedPayloadSchema,
}).strict();

export const CharacterCreatedEventV2Schema = DomainEventBaseSchema.extend({
  type: z.literal('character.created'),
  version: z.literal(2),
  payload: CharacterCreatedPayloadSchema.extend({
    resources: CharacterResourcesSchema,
  }).strict(),
}).strict();

export const CharacterCreatedEventV3Schema = DomainEventBaseSchema.extend({
  type: z.literal('character.created'),
  version: z.literal(3),
  payload: CharacterCreatedPayloadSchema.extend({
    resources: CharacterResourcesSchema,
    characterClass: CharacterClassSnapshotSchema,
    health: CharacterHealthSchema,
  }).strict(),
}).strict();

export const CharacterStaminaSpentEventSchema = DomainEventBaseSchema.extend({
  type: z.literal('character.stamina_spent'),
  version: z.literal(1),
  payload: z.object({
    characterId: IdSchema,
    cause: z.enum(['solo-flee', 'team-flee']),
    causeId: IdSchema,
    staminaSpent: PositiveIntSchema.max(1000),
    resources: CharacterResourcesSchema,
  }).strict(),
}).strict();

export const CharacterStaminaRecoverySettledEventSchema = DomainEventBaseSchema.extend({
  type: z.literal('character.stamina_recovery_settled'),
  version: z.literal(1),
  payload: z.object({
    characterId: IdSchema,
    resources: CharacterResourcesSchema,
    recovery: CharacterStaminaRecoverySchema,
    resetAnchor: z.boolean().default(false),
  }).strict(),
}).strict();

export const CharacterVitalRecoverySettledEventSchema = DomainEventBaseSchema.extend({
  type: z.literal('character.vital_recovery_settled'),
  version: z.literal(1),
  payload: z.object({
    characterId: IdSchema,
    health: CharacterHealthSchema,
    resources: CharacterResourcesSchema,
    recovery: CharacterStaminaRecoverySchema,
    resetAnchor: z.boolean().default(false),
  }).strict(),
}).strict();

export const CharacterPostureChangedEventSchema = DomainEventBaseSchema.extend({
  type: z.literal('character.posture_changed'),
  version: z.literal(1),
  payload: z.object({
    characterId: IdSchema,
    posture: StaminaPostureSchema,
    locationId: IdSchema,
  }).strict(),
}).strict();

export const CharacterRestCommandSchema = ClientCommandBaseSchema.extend({
  type: z.literal('character.rest'),
  expectedVersion: NonNegativeIntSchema,
  payload: z.object({}).strict(),
}).strict();

export const CharacterStandCommandSchema = ClientCommandBaseSchema.extend({
  type: z.literal('character.stand'),
  expectedVersion: NonNegativeIntSchema,
  payload: z.object({}).strict(),
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

export const CharacterCorpseGoldReceivedEventSchema = DomainEventBaseSchema.extend({
  type: z.literal('character.corpse_gold_received'),
  version: z.literal(1),
  payload: z.object({
    characterId: IdSchema,
    corpseId: IdSchema,
    currencyId: IdSchema,
    amount: PositiveIntSchema.max(2_147_483_647),
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
    containerId: IdSchema.optional(),
    item: InventoryItemProjectionSchema,
  }).strict(),
}).strict();

export const CharacterItemGrantedEventSchema = DomainEventBaseSchema.extend({
  type: z.literal('character.item_granted'),
  version: z.literal(1),
  payload: z.object({
    characterId: IdSchema,
    item: InventoryItemProjectionSchema,
    sourceId: IdSchema,
  }).strict(),
}).strict();

export const DropCharacterItemCommandSchema = ClientCommandBaseSchema.extend({
  type: z.literal('character.drop'),
  expectedVersion: NonNegativeIntSchema,
  payload: z.object({ itemId: IdSchema }).strict(),
}).strict();

export const PutCharacterItemCommandSchema = ClientCommandBaseSchema.extend({
  type: z.literal('character.put'),
  expectedVersion: NonNegativeIntSchema,
  payload: z.object({ itemId: IdSchema, containerId: IdSchema }).strict(),
}).strict();

export const CharacterItemStoredEventSchema = DomainEventBaseSchema.extend({
  type: z.literal('character.item_stored'),
  payload: z.object({
    characterId: IdSchema,
    locationId: IdSchema,
    containerId: IdSchema,
    item: InventoryItemProjectionSchema,
  }).strict(),
}).strict();

export const EquipCharacterItemCommandSchema = ClientCommandBaseSchema.extend({
  type: z.literal('character.equip'),
  expectedVersion: NonNegativeIntSchema,
  payload: z.object({ itemId: IdSchema }).strict(),
}).strict();

export const UnequipCharacterItemCommandSchema = ClientCommandBaseSchema.extend({
  type: z.literal('character.unequip'),
  expectedVersion: NonNegativeIntSchema,
  payload: z.object({ slot: EquipmentSlotSchema }).strict(),
}).strict();

export const CharacterEquipmentChangedEventSchema = DomainEventBaseSchema.extend({
  type: z.literal('character.equipment_changed'),
  payload: z.object({
    characterId: IdSchema,
    slot: EquipmentSlotSchema,
    itemId: IdSchema.nullable(),
  }).strict(),
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
  locationStateId: IdSchema.optional(),
  visitedLocationIds: z.array(IdSchema).default([]),
  revision: NonNegativeIntSchema,
  inventory: z.array(InventoryItemProjectionSchema).default([]),
  equipment: CharacterEquipmentSchema.default({ weaponItemId: null, armorItemId: null }),
  attributes: CharacterAttributesSchema.default(DEFAULT_CHARACTER_ATTRIBUTES),
  characterClass: CharacterClassSnapshotSchema.optional(),
  availableClassActions: z.array(AvailableClassActionSchema).default([]),
  honors: CharacterHonorsSchema.default(DEFAULT_CHARACTER_HONORS),
  resources: CharacterResourcesSchema.default(DEFAULT_CHARACTER_RESOURCES),
  staminaRecovery: CharacterStaminaRecoverySchema.default({
    posture: 'standing',
    lastSettledAt: null,
    fractionalCarry: 0,
  }),
  wallet: CharacterWalletSchema.optional(),
  advancement: CharacterAdvancementProjectionSchema.optional(),
  woodcutting: WoodcuttingSkillSchema.optional(),
  activeWoodcutting: WoodcuttingActionStateSchema.optional(),
  health: CharacterHealthSchema.optional(),
  combat: CombatEncounterProjectionSchema.optional(),
  purchasedMerchantListingIds: z.array(IdSchema).default([]),
  itemLocations: z.array(z.object({
    item: InventoryItemProjectionSchema,
    locationId: IdSchema.nullable(),
    containerId: IdSchema.optional(),
  }).strict()).default([]),
  claimedContainerItemIds: z.array(IdSchema).default([]),
  claimedCorpseGoldIds: z.array(IdSchema).default([]),
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
  questRewardedIds: z.array(IdSchema).default([]),
  dailyJobs: z.array(DailyJobStateSchema).default([]),
  supplyCollections: z.array(SupplyCollectionStateSchema).default([]),
  activeFishing: FishingCastStateSchema.optional(),
  archived: z.boolean().default(false),
}).strict();

export const CharacterPvpOutcomeAppliedEventSchema = DomainEventBaseSchema.extend({
  type: z.literal('character.pvp_outcome_applied'),
  payload: z.object({
    characterId: IdSchema,
    encounterId: IdSchema,
    health: CharacterHealthSchema,
    consumedItemIds: z.array(IdSchema),
  }).strict(),
}).strict();

export const CharacterSharedItemReceivedEventSchema = DomainEventBaseSchema.extend({
  type: z.literal('character.shared_item_received'),
  version: z.literal(1),
  payload: z.object({
    characterId: IdSchema,
    worldItemId: IdSchema,
    sourceLocationId: IdSchema,
    item: InventoryItemProjectionSchema,
  }).strict(),
}).strict();

export const CharacterSharedItemRelinquishedEventSchema = DomainEventBaseSchema.extend({
  type: z.literal('character.shared_item_relinquished'),
  version: z.literal(1),
  payload: z.object({
    characterId: IdSchema,
    worldItemId: IdSchema,
    locationId: IdSchema,
  }).strict(),
}).strict();

export const CharacterRespawnedEventSchema = DomainEventBaseSchema.extend({
  type: z.literal('character.respawned'),
  version: z.literal(1),
  payload: z.object({
    characterId: IdSchema,
    cause: z.enum(['pve', 'pvp', 'team-pve']),
    encounterId: IdSchema,
    deathLocationId: IdSchema,
    respawnLocationId: IdSchema,
    health: CharacterHealthSchema,
    droppedItem: z.object({
      sourceItemId: IdSchema,
      item: InventoryItemProjectionSchema,
    }).strict().optional(),
  }).strict(),
}).strict();

export type CreateCharacterCommand = z.infer<typeof CreateCharacterCommandSchema>;
export type CharacterCreatedEvent = z.infer<typeof CharacterCreatedEventSchema>
  | z.infer<typeof CharacterCreatedEventV2Schema>
  | z.infer<typeof CharacterCreatedEventV3Schema>;
export type TakeCharacterItemCommand = z.infer<typeof TakeCharacterItemCommandSchema>;
export type CharacterItemTakenEvent = z.infer<typeof CharacterItemTakenEventSchema>;
export type DropCharacterItemCommand = z.infer<typeof DropCharacterItemCommandSchema>;
export type PutCharacterItemCommand = z.infer<typeof PutCharacterItemCommandSchema>;
export type CharacterItemStoredEvent = z.infer<typeof CharacterItemStoredEventSchema>;
export type EquipCharacterItemCommand = z.infer<typeof EquipCharacterItemCommandSchema>;
export type UnequipCharacterItemCommand = z.infer<typeof UnequipCharacterItemCommandSchema>;
export type CharacterEquipmentChangedEvent = z.infer<typeof CharacterEquipmentChangedEventSchema>;
export type EquipmentSlot = z.infer<typeof EquipmentSlotSchema>;
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
export type CharacterAdvancementProjection = z.infer<typeof CharacterAdvancementProjectionSchema>;
export type CharacterAdvancementAwardedEvent = z.infer<typeof CharacterAdvancementAwardedEventSchema>;
export type RenameCharacterCommand = z.infer<typeof RenameCharacterCommandSchema>;
export type ArchiveCharacterCommand = z.infer<typeof ArchiveCharacterCommandSchema>;
export type RestoreCharacterCommand = z.infer<typeof RestoreCharacterCommandSchema>;
export type CharacterProjection = z.infer<typeof CharacterProjectionSchema>;
