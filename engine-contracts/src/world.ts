/** PROPOSED v0.1: portable definitions vs runtime, read-only player projections. */
import { z } from 'zod';
import { ClientCommandBaseSchema, ClientQueryBaseSchema } from './protocol.js';
import { ContractVersionSchema, IdSchema, NonNegativeIntSchema, PositiveIntSchema } from './ids.js';
import { ConsumableItemSchema, InventoryEquipmentSchema } from './character.js';
import { WoodcuttingAxeDefinitionSchema } from './woodcutting.js';
import { QuestDefinitionSchema, QuestDialogueActionSchema } from './quests.js';
import { DailyBoardDefinitionSchema, NpcDailyJobResponseDefinitionSchema, SupplySourceDefinitionSchema } from './daily-jobs.js';
import { FishingRodDefinitionSchema, FishingSpotDefinitionSchema } from './fishing.js';
import { WoodcuttingTreeDefinitionSchema } from './woodcutting.js';
import { CraftingRecipeDefinitionSchema } from './crafting.js';
import {
  InnDefinitionSchema,
  InnProjectionSchema,
  MerchantCatalogDefinitionSchema,
  WorldCurrencyDefinitionSchema,
} from './commerce.js';
import { NpcCombatProfileSchema } from './combat.js';
import { CharacterClassCatalogSchema } from './classes.js';
import {
  LocationGroupDefinitionSchema,
  LocationGroupMembershipProjectionSchema,
} from './location-groups.js';

export const ExitDefinitionSchema = z.object({
  id: IdSchema,
  fromLocationId: IdSchema,
  toLocationId: IdSchema,
  label: z.string().min(1).max(120),
  direction: z.string().max(40).optional(),
  /** Restrict this exit to one authored state of its source location. */
  fromStateId: IdSchema.optional(),
  /** Select a state at the destination; omitted means its default state. */
  toStateId: IdSchema.optional(),
  requiredInteractionId: IdSchema.optional(),
  roadId: IdSchema.optional(),
  /** Presentation-only: leave a visible gap at this endpoint tile to depict an underpass. */
  mapLineGapAtLocationId: IdSchema.optional(),
}).strict();

export const WorldLocationEnteredEffectSchema = z.object({
  characterId: IdSchema,
  fromLocationId: IdSchema,
  toLocationId: IdSchema,
}).strict();

export const LocationStateDefinitionSchema = z.object({
  id: IdSchema,
  name: z.string().min(1).max(160).optional(),
  description: z.string().min(1).max(1000).optional(),
}).strict();

export const MapTerrainSchema = z.string()
  .trim()
  .min(1)
  .max(48)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
export const MapColorSchema = z.string().regex(/^#[0-9a-fA-F]{6}$/);

export const MapPositionSchema = z.object({
  x: z.number().int().min(-10000).max(10000),
  y: z.number().int().min(-10000).max(10000),
  /** Omitted for legacy surface content (level zero). */
  z: z.number().int().min(-10000).max(10000).optional(),
  /** Presentation-only map tile category; movement and rules do not depend on it. */
  terrain: MapTerrainSchema.optional(),
  /** Optional developer-authored hex color for non-water, non-building map tiles. */
  mapColor: MapColorSchema.optional(),
  /** Show this map tile even before a character has visited its location. */
  visibleWhenUnvisited: z.boolean().optional(),
}).strict().superRefine((position, context) => {
  if (position.mapColor && (position.terrain === 'river' || position.terrain === 'building')) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['mapColor'],
      message: 'Water and building map tiles use their fixed labeled colors.',
    });
  }
});

export const ReadableObjectDefinitionSchema = z.object({
  id: IdSchema,
  label: z.string().min(1).max(120),
  description: z.string().min(1).max(1000),
  text: z.string().min(1).max(4000),
}).strict();

export const TakeableObjectDefinitionSchema = z.object({
  typeId: IdSchema.optional(),
  id: IdSchema,
  label: z.string().min(1).max(120),
  description: z.string().min(1).max(1000),
  roomDescription: z.string().min(1).max(1000).optional(),
  questBound: z.boolean().optional(),
  stackable: z.boolean().optional(),
  quantity: NonNegativeIntSchema.max(2_147_483_647).positive().optional(),
  consumable: ConsumableItemSchema.optional(),
  equipment: InventoryEquipmentSchema.optional(),
  fishingRod: FishingRodDefinitionSchema.optional(),
  woodcuttingAxe: WoodcuttingAxeDefinitionSchema.optional(),
  usesRemaining: PositiveIntSchema.max(1000).optional(),
}).strict().superRefine((item, context) => {
  if (item.quantity !== undefined && item.stackable !== true) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['quantity'],
      message: 'Only stackable items can have a quantity.',
    });
  }
  if (item.stackable && item.quantity === undefined) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['quantity'],
      message: 'Stackable items must specify their quantity.',
    });
  }
  if (item.usesRemaining !== undefined && item.stackable) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['usesRemaining'],
      message: 'Charge-based items cannot be stackable.',
    });
  }
  if (item.consumable && item.equipment) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['consumable'],
      message: 'Consumable items cannot also be equipped.',
    });
  }
  if (item.woodcuttingAxe && (item.consumable || item.equipment)) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['woodcuttingAxe'],
      message: 'A woodcutting axe cannot also be consumable or combat equipment.',
    });
  }
});

export const CombatLootDefinitionSchema = z.object({
  items: z.array(TakeableObjectDefinitionSchema).max(24).default([]),
  currencyAmount: NonNegativeIntSchema.max(2_147_483_647).optional(),
}).strict().superRefine((loot, context) => {
  const itemIds = new Set<string>();
  for (const [index, item] of loot.items.entries()) {
    if (itemIds.has(item.id)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['items', index, 'id'],
        message: 'Combat loot item IDs must be unique within the loot definition.',
      });
    }
    if (item.questBound) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['items', index, 'questBound'],
        message: 'Combat loot cannot contain quest-bound items.',
      });
    }
    itemIds.add(item.id);
  }
});

export const ContainerKindSchema = z.enum(['sack', 'chest', 'corpse', 'other']);

export const ContainerDefinitionSchema = z.object({
  id: IdSchema,
  kind: ContainerKindSchema,
  label: z.string().min(1).max(120),
  description: z.string().min(1).max(1000),
  roomDescription: z.string().min(1).max(1000).optional(),
  /** Maximum number of individual item units; omitted containers are unlimited. */
  capacity: NonNegativeIntSchema.max(2_147_483_647).optional(),
  contents: z.array(TakeableObjectDefinitionSchema).max(100),
}).strict().superRefine((container, context) => {
  if (container.capacity === undefined) return;
  const contentsCapacity = container.contents.reduce(
    (total, item) => total + (item.stackable ? item.quantity ?? 1 : 1),
    0,
  );
  if (contentsCapacity > container.capacity) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['contents'],
      message: 'Container contents exceed the authored capacity.',
    });
  }
});

export const RoadEncounterDefinitionSchema = z.object({
  id: IdSchema,
  name: z.string().min(1).max(120),
  combatProfile: NpcCombatProfileSchema,
  loot: CombatLootDefinitionSchema.optional(),
}).strict();

export const RoadDefinitionSchema = z.object({
  id: IdSchema,
  name: z.string().min(1).max(160),
  /** Ordered endpoints and traversable road-segment locations. */
  locationIds: z.array(IdSchema).min(3).max(100),
  encounterChancePercent: z.number().int().min(0).max(100),
  encounters: z.array(RoadEncounterDefinitionSchema).min(1).max(24),
}).strict();

export const InteractableObjectDefinitionSchema = z.object({
  id: IdSchema,
  label: z.string().min(1).max(120),
  description: z.string().min(1).max(1000),
  roomDescription: z.string().min(1).max(1000).optional(),
}).strict();

export const ItemUseInteractionDefinitionSchema = z.object({
  id: IdSchema,
  itemId: IdSchema,
  targetId: IdSchema,
  requiredVisitedLocationId: IdSchema.optional(),
  response: z.string().min(1).max(2000),
  repeatResponse: z.string().min(1).max(2000).optional(),
  requiresInteractionIds: z.array(IdSchema).max(12).optional(),
  requiresInteractionMessage: z.string().min(1).max(500).optional(),
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

export const NpcDialogueTopicDefinitionSchema = z.object({
  id: IdSchema,
  keywords: z.array(z.string().trim().min(1).max(80)).min(1).max(12),
  response: z.string().min(1).max(2000),
  questResponses: z.array(NpcQuestResponseDefinitionSchema).max(24).optional(),
  dailyJobResponses: z.array(NpcDailyJobResponseDefinitionSchema).max(24).optional(),
}).strict();

export const NpcRoomChatReactionDefinitionSchema = z.object({
  keywords: z.array(z.string().trim().min(1).max(80)).min(1).max(12),
  response: z.string().min(1).max(500),
}).strict();

const NpcMovementNarrativeSchema = z.object({
  arrival: z.string().min(1).max(500).optional(),
  departure: z.string().min(1).max(500).optional(),
}).strict();

export const NpcMovementBehaviorSchema = z.discriminatedUnion('strategy', [
  z.object({
    strategy: z.literal('wander'),
    intervalMs: z.number().int().min(5_000).max(3_600_000),
    stayChancePercent: z.number().int().min(0).max(100).default(10),
    allowedLocationIds: z.array(IdSchema).min(2).max(100),
    narrative: NpcMovementNarrativeSchema.optional(),
  }).strict(),
  z.object({
    strategy: z.literal('route'),
    intervalMs: z.number().int().min(5_000).max(3_600_000),
    /** A repeating ordered cycle; repeat intermediate waypoints to reverse direction. */
    routeLocationIds: z.array(IdSchema).min(2).max(100),
    narrative: NpcMovementNarrativeSchema.optional(),
  }).strict(),
]);

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
  itemReward: TakeableObjectDefinitionSchema.optional(),
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

export const NpcCombatDispositionSchema = z.enum(['passive', 'hostile']);

export const NpcDefinitionSchema = z.object({
  id: IdSchema,
  name: z.string().min(1).max(120),
  description: z.string().min(1).max(1000),
  activityDescription: z.string().min(1).max(240).optional(),
  greeting: z.string().min(1).max(2000),
  dailyJobResponses: z.array(NpcDailyJobResponseDefinitionSchema).max(24).optional(),
  topics: z.array(NpcDialogueTopicDefinitionSchema).max(24),
  dialogue: NpcDialogueDefinitionSchema.optional(),
  unknownTopicResponse: z.string().min(1).max(2000),
  announcements: z.array(z.string().min(1).max(500)).max(24).optional(),
  roomChatReactions: z.array(NpcRoomChatReactionDefinitionSchema).max(24).optional(),
  movement: NpcMovementBehaviorSchema.optional(),
  /** Omitted disposition is passive: the player must choose to begin combat. */
  combatDisposition: NpcCombatDispositionSchema.optional(),
  combatProfile: NpcCombatProfileSchema.optional(),
  loot: CombatLootDefinitionSchema.optional(),
  shop: MerchantCatalogDefinitionSchema.optional(),
}).strict().superRefine((npc, context) => {
  if (npc.combatDisposition === 'hostile' && !npc.combatProfile) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['combatProfile'],
      message: 'Hostile NPCs require a combat profile.',
    });
  }
});

export const NpcPresenceProjectionSchema = z.object({
  id: IdSchema,
  name: z.string().min(1).max(120),
  activityDescription: z.string().min(1).max(240).optional(),
  description: z.string().min(1).max(1000).optional(),
  canChallenge: z.boolean().default(false),
  combatDisposition: NpcCombatDispositionSchema.default('passive'),
  canShop: z.boolean().default(false),
}).strict();

export const LocationDefinitionSchema = z.object({
  id: IdSchema,
  name: z.string().min(1).max(160),
  description: z.string().min(1),
  regionId: IdSchema.optional(),
  /** Independent dungeon/overworld map namespace; omitted means overworld. */
  mapAreaId: IdSchema.optional(),
  mapPosition: MapPositionSchema.optional(),
  /** Per-character context within this map node; it never changes map coordinates. */
  defaultStateId: IdSchema.optional(),
  states: z.array(LocationStateDefinitionSchema).min(1).max(16).optional(),
  /** This location cannot be entered until the character has visited the named location. */
  requiredVisitedLocationId: IdSchema.optional(),
  /** Legacy authoring hint retained for compatibility; it does not gate free character rest. */
  safeResting: z.boolean().optional(),
  exits: z.array(ExitDefinitionSchema),
  readables: z.array(ReadableObjectDefinitionSchema).optional(),
  takeables: z.array(TakeableObjectDefinitionSchema).optional(),
  containers: z.array(ContainerDefinitionSchema).max(100).optional(),
  interactables: z.array(InteractableObjectDefinitionSchema).optional(),
  itemUses: z.array(ItemUseInteractionDefinitionSchema).max(100).optional(),
  npcs: z.array(NpcDefinitionSchema).optional(),
  inn: InnDefinitionSchema.optional(),
}).strict();

export const WorldPackDraftSchema = z.object({
  formatVersion: ContractVersionSchema,
  packId: IdSchema,
  packVersion: z.string().min(1),
  displayName: z.string().min(1),
  classCatalog: CharacterClassCatalogSchema.optional(),
  currency: WorldCurrencyDefinitionSchema.optional(),
  respawn: z.object({ locationId: IdSchema }).strict().optional(),
  locations: z.array(LocationDefinitionSchema),
  locationGroups: z.array(LocationGroupDefinitionSchema).max(500).default([]),
  roads: z.array(RoadDefinitionSchema).default([]),
  quests: z.array(QuestDefinitionSchema).default([]),
  dailyBoards: z.array(DailyBoardDefinitionSchema).default([]),
  supplySources: z.array(SupplySourceDefinitionSchema).default([]),
  fishingSpots: z.array(FishingSpotDefinitionSchema).default([]),
  woodcuttingTrees: z.array(WoodcuttingTreeDefinitionSchema).max(1000).default([]),
  craftingWorkbenchLocationIds: z.array(IdSchema).max(500).default([]),
  craftingRecipes: z.array(CraftingRecipeDefinitionSchema).max(100).default([]),
}).strict().superRefine((world, context) => {
  if (
    world.respawn &&
    !world.locations.some((location) => location.id === world.respawn!.locationId)
  ) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['respawn', 'locationId'],
      message: 'The respawn location must be included in the world pack.',
    });
  }
  const locationIds = new Set(world.locations.map(({ id }) => id));
  const fishingSpotIds = new Set<string>();
  const woodcuttingTreeIds = new Set<string>();
  const craftingWorkbenchLocationIds = new Set<string>();
  world.craftingWorkbenchLocationIds.forEach((locationId, index) => {
    if (craftingWorkbenchLocationIds.has(locationId)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['craftingWorkbenchLocationIds', index],
        message: 'Crafting workbench locations must be unique.',
      });
    }
    if (!locationIds.has(locationId)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['craftingWorkbenchLocationIds', index],
        message: 'Crafting workbench location must exist in this world.',
      });
    }
    craftingWorkbenchLocationIds.add(locationId);
  });
  const craftingRecipeIds = new Set<string>();
  world.craftingRecipes.forEach((recipe, index) => {
    if (craftingRecipeIds.has(recipe.id)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['craftingRecipes', index, 'id'],
        message: 'Crafting recipe IDs must be unique.',
      });
    }
    craftingRecipeIds.add(recipe.id);
  });
  for (const [treeIndex, tree] of world.woodcuttingTrees.entries()) {
    if (woodcuttingTreeIds.has(tree.id)) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ['woodcuttingTrees', treeIndex, 'id'], message: 'Woodcutting tree IDs must be unique.' });
    }
    if (!locationIds.has(tree.locationId)) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ['woodcuttingTrees', treeIndex, 'locationId'], message: 'Woodcutting tree location must exist in this world.' });
    }
    woodcuttingTreeIds.add(tree.id);
  }
  for (const [spotIndex, spot] of world.fishingSpots.entries()) {
    if (fishingSpotIds.has(spot.id)) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ['fishingSpots', spotIndex, 'id'], message: 'Fishing spot IDs must be unique.' });
    }
    if (!locationIds.has(spot.locationId)) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ['fishingSpots', spotIndex, 'locationId'], message: 'Fishing spot location must exist in this world.' });
    } else if (spot.stateId) {
      const location = world.locations.find(({ id }) => id === spot.locationId);
      if (!location?.states?.some(({ id }) => id === spot.stateId)) {
        context.addIssue({ code: z.ZodIssueCode.custom, path: ['fishingSpots', spotIndex, 'stateId'], message: 'Fishing spot state must exist at its location.' });
      }
    }
    fishingSpotIds.add(spot.id);
  }
  const locationGroupIds = new Set<string>();
  const primaryLocationGroups = new Map<string, string>();
  for (const [groupIndex, group] of world.locationGroups.entries()) {
    if (locationGroupIds.has(group.id)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['locationGroups', groupIndex, 'id'],
        message: `Duplicate location group ID ${group.id}.`,
      });
    }
    locationGroupIds.add(group.id);
    const memberLocationIds = new Set<string>();
    for (const [membershipIndex, membership] of group.memberships.entries()) {
      if (!locationIds.has(membership.locationId)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['locationGroups', groupIndex, 'memberships', membershipIndex, 'locationId'],
          message: `Location group ${group.id} references a location not present in the world pack.`,
        });
      }
      if (memberLocationIds.has(membership.locationId)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['locationGroups', groupIndex, 'memberships', membershipIndex, 'locationId'],
          message: `Location ${membership.locationId} is listed more than once in location group ${group.id}.`,
        });
      }
      memberLocationIds.add(membership.locationId);
      if (membership.isPrimary) {
        const previousPrimary = primaryLocationGroups.get(membership.locationId);
        if (previousPrimary) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['locationGroups', groupIndex, 'memberships', membershipIndex, 'isPrimary'],
            message: `Location ${membership.locationId} already has primary group ${previousPrimary}.`,
          });
        } else {
          primaryLocationGroups.set(membership.locationId, group.id);
        }
      }
    }
  }
  const roadIds = new Set<string>();
  const encounterIds = new Set<string>();
  const npcIds = new Set(world.locations.flatMap((location) =>
    (location.npcs ?? []).map((npc) => npc.id),
  ));
  for (const [roadIndex, road] of world.roads.entries()) {
    if (roadIds.has(road.id)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['roads', roadIndex, 'id'],
        message: `Duplicate road ID ${road.id}.`,
      });
    }
    roadIds.add(road.id);
    if (road.locationIds.some((id) => !locationIds.has(id))) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['roads', roadIndex, 'locationIds'],
        message: `Road ${road.id} references a location not present in the world pack.`,
      });
    }
    if (new Set(road.locationIds).size !== road.locationIds.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['roads', roadIndex, 'locationIds'],
        message: `Road ${road.id} cannot visit the same location more than once.`,
      });
    }
    for (const [encounterIndex, encounter] of road.encounters.entries()) {
      if (encounterIds.has(encounter.id)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['roads', roadIndex, 'encounters', encounterIndex, 'id'],
          message: `Duplicate road encounter ID ${encounter.id}.`,
        });
      }
      encounterIds.add(encounter.id);
      if (npcIds.has(encounter.id)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['roads', roadIndex, 'encounters', encounterIndex, 'id'],
          message: `Road encounter ID ${encounter.id} conflicts with an authored NPC ID.`,
        });
      }
    }
    for (let index = 0; index < road.locationIds.length - 1; index += 1) {
      const fromLocationId = road.locationIds[index]!;
      const toLocationId = road.locationIds[index + 1]!;
      const hasRoadExit = world.locations.some((location) =>
        location.exits.some((exit) =>
          exit.roadId === road.id &&
          ((exit.fromLocationId === fromLocationId && exit.toLocationId === toLocationId) ||
            (exit.fromLocationId === toLocationId && exit.toLocationId === fromLocationId)),
        ),
      );
      if (!hasRoadExit) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['roads', roadIndex, 'locationIds', index],
          message: `Road ${road.id} is missing an exit between ${fromLocationId} and ${toLocationId}.`,
        });
      }
    }
  }
  const movementNpcIds = new Set<string>();
  for (const [locationIndex, location] of world.locations.entries()) {
    for (const [npcIndex, npc] of (location.npcs ?? []).entries()) {
      if (!npc.movement) continue;
      if (movementNpcIds.has(npc.id)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['locations', locationIndex, 'npcs', npcIndex, 'movement'],
          message: `Mobile NPC ID ${npc.id} must be unique in the world.`,
        });
      }
      movementNpcIds.add(npc.id);
      if (npc.combatProfile) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['locations', locationIndex, 'npcs', npcIndex, 'movement'],
          message: `Combatant NPC ${npc.id} cannot have autonomous movement.`,
        });
      }
      const itinerary = npc.movement.strategy === 'wander'
        ? npc.movement.allowedLocationIds
        : npc.movement.routeLocationIds;
      if (!itinerary.includes(location.id)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['locations', locationIndex, 'npcs', npcIndex, 'movement'],
          message: `The movement plan for ${npc.id} must include its authored starting location.`,
        });
      }
      if (itinerary.some((id) => !locationIds.has(id))) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['locations', locationIndex, 'npcs', npcIndex, 'movement'],
          message: `The movement plan for ${npc.id} references a location not present in the world.`,
        });
      }
      if (npc.movement.strategy === 'route') {
        for (let stepIndex = 0; stepIndex < npc.movement.routeLocationIds.length; stepIndex += 1) {
          const fromLocationId = npc.movement.routeLocationIds[stepIndex]!;
          const toLocationId = npc.movement.routeLocationIds[(stepIndex + 1) % npc.movement.routeLocationIds.length]!;
          const hasTraversableExit = world.locations
            .find((candidate) => candidate.id === fromLocationId)
            ?.exits.some((exit) =>
              exit.toLocationId === toLocationId &&
              !exit.requiredInteractionId &&
              !world.locations.find((candidate) => candidate.id === toLocationId)?.requiredVisitedLocationId,
            ) ?? false;
          if (!hasTraversableExit) {
            context.addIssue({
              code: z.ZodIssueCode.custom,
              path: ['locations', locationIndex, 'npcs', npcIndex, 'movement', 'routeLocationIds', stepIndex],
              message: `The route for ${npc.id} has no ungated exit from ${fromLocationId} to ${toLocationId}.`,
            });
          }
        }
      }
    }
    const stateIds = new Set((location.states ?? []).map((state) => state.id));
    if (stateIds.size !== (location.states ?? []).length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['locations', locationIndex, 'states'],
        message: `Location ${location.id} has duplicate state IDs.`,
      });
    }
    if ((location.states?.length ?? 0) > 0 && !location.defaultStateId) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['locations', locationIndex, 'defaultStateId'],
        message: `Location ${location.id} must choose a default state.`,
      });
    }
    if (location.defaultStateId && !stateIds.has(location.defaultStateId)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['locations', locationIndex, 'defaultStateId'],
        message: `Location ${location.id} defaults to an unknown state.`,
      });
    }
    for (const [exitIndex, exit] of location.exits.entries()) {
      if (exit.fromLocationId !== location.id) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['locations', locationIndex, 'exits', exitIndex, 'fromLocationId'],
          message: `Exit ${exit.id} must start at its containing location.`,
        });
      }
      const destination = world.locations.find((candidate) => candidate.id === exit.toLocationId);
      if (!destination) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['locations', locationIndex, 'exits', exitIndex, 'toLocationId'],
          message: `Exit ${exit.id} references missing location ${exit.toLocationId}.`,
        });
      }
      if (exit.fromStateId && !stateIds.has(exit.fromStateId)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['locations', locationIndex, 'exits', exitIndex, 'fromStateId'],
          message: `Exit ${exit.id} references missing source state ${exit.fromStateId}.`,
        });
      }
      if (exit.toStateId && !destination?.states?.some((state) => state.id === exit.toStateId)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['locations', locationIndex, 'exits', exitIndex, 'toStateId'],
          message: `Exit ${exit.id} references missing destination state ${exit.toStateId}.`,
        });
      }
      if (
        exit.mapLineGapAtLocationId &&
        exit.mapLineGapAtLocationId !== exit.fromLocationId &&
        exit.mapLineGapAtLocationId !== exit.toLocationId
      ) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['locations', locationIndex, 'exits', exitIndex, 'mapLineGapAtLocationId'],
          message: `Exit ${exit.id} can only place a map line gap at one of its endpoint locations.`,
        });
      }
      if (!exit.roadId) continue;
      const road = world.roads.find(({ id }) => id === exit.roadId);
      const fromIndex = road?.locationIds.indexOf(exit.fromLocationId) ?? -1;
      const toIndex = road?.locationIds.indexOf(exit.toLocationId) ?? -1;
      if (!road) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['locations', locationIndex, 'exits', exitIndex, 'roadId'],
          message: `Exit ${exit.id} references missing road ${exit.roadId}.`,
        });
      } else if (fromIndex < 0 || Math.abs(toIndex - fromIndex) !== 1) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['locations', locationIndex, 'exits', exitIndex, 'roadId'],
          message: `Exit ${exit.id} must connect adjacent locations on road ${exit.roadId}.`,
        });
      }
    }
  }
});

export const LocationDescribeQuerySchema = ClientQueryBaseSchema.extend({
  type: z.literal('location.describe'),
  payload: z.object({
    locationId: IdSchema.optional(),
    includeNpcDescriptions: z.boolean().optional(),
  }).strict(),
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

export const LocationTravelPreviewSchema = z.object({
  locationId: IdSchema,
  locationStateId: IdSchema.optional(),
  title: z.string().min(1).max(400),
  shortName: z.string().min(1).max(160),
  qualifiedName: z.string().min(1).max(400),
  description: z.string(),
  /** Current, viewer-safe room contents; these may change before arrival. */
  roomDetails: z.string().max(20_000).optional(),
  npcs: z.array(z.object({
    id: IdSchema,
    name: z.string().min(1).max(120),
    mobile: z.boolean(),
  }).strict()).max(200).optional(),
}).strict();

export const ExitProjectionSchema = z.object({
  id: IdSchema,
  label: z.string(),
  direction: z.string().optional(),
  available: z.boolean(),
  roadId: IdSchema.optional(),
  /** Safe-to-present, non-authoritative destination projection for responsive travel UI. */
  destinationPreview: LocationTravelPreviewSchema.optional(),
}).strict();

export const RoomOccupantProjectionSchema = z.object({
  id: IdSchema,
  displayName: z.string(),
}).strict();

export const RoomPresenceProjectionSchema = z.object({
  worldInstanceId: IdSchema,
  locationId: IdSchema,
  occupants: z.array(RoomOccupantProjectionSchema),
}).strict();

/** Projection is already filtered for the authenticated viewer. */
export const LocationProjectionSchema = z.object({
  worldInstanceId: IdSchema,
  locationId: IdSchema,
  locationStateId: IdSchema.optional(),
  revision: NonNegativeIntSchema,
  cursor: z.string().optional(),
  title: z.string(),
  shortName: z.string().min(1).max(160),
  qualifiedName: z.string().min(1).max(400),
  locationGroups: z.array(LocationGroupMembershipProjectionSchema).max(500),
  description: z.string(),
  exits: z.array(ExitProjectionSchema),
  objects: z.array(z.object({
    id: IdSchema,
    label: z.string().min(1).max(120),
    description: z.string().min(1).max(1000),
    readable: z.boolean(),
    takeable: z.boolean(),
    containerId: IdSchema.optional(),
    containerKind: ContainerKindSchema.optional(),
    contents: z.array(z.object({
      id: IdSchema,
      label: z.string().min(1).max(120),
      description: z.string().min(1).max(1000),
    }).strict()).max(100).optional(),
  }).strict()),
  occupants: z.array(RoomOccupantProjectionSchema),
  npcs: z.array(NpcPresenceProjectionSchema).optional(),
  inn: InnProjectionSchema.optional(),
  safeResting: z.boolean().default(false),
}).strict();

export const WorldMapProjectionSchema = z.object({
  worldInstanceId: IdSchema,
  packId: IdSchema,
  packVersion: z.string().min(1).max(80),
  currentLocationId: IdSchema,
  locations: z.array(z.object({
    id: IdSchema,
    name: z.string().min(1).max(160),
    shortName: z.string().min(1).max(160),
    qualifiedName: z.string().min(1).max(400),
    locationGroupIds: z.array(IdSchema).max(500),
    primaryLocationGroupId: IdSchema.optional(),
    x: z.number().int().min(-10000).max(10000),
    y: z.number().int().min(-10000).max(10000),
    terrain: MapTerrainSchema.optional(),
    verticalExits: z.array(z.enum(['up', 'down'])).max(2).optional(),
    mapColor: MapColorSchema.optional(),
  }).strict().superRefine((location, context) => {
    if (location.mapColor && (location.terrain === 'river' || location.terrain === 'building')) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['mapColor'],
        message: 'Water and building map tiles use their fixed labeled colors.',
      });
    }
  })).min(1).max(500),
  locationGroups: z.array(z.object({
    id: IdSchema,
    name: z.string().min(1).max(160),
    type: z.string().trim().min(1).max(80),
    description: z.string().min(1).max(1000).optional(),
    metadata: z.record(z.unknown()).optional(),
    locationIds: z.array(IdSchema).max(5000),
    primaryLocationIds: z.array(IdSchema).max(5000),
  }).strict()).max(500),
  connections: z.array(z.object({
    fromLocationId: IdSchema,
    toLocationId: IdSchema,
    direction: z.string().max(40).optional(),
    oneWay: z.boolean().optional(),
    mapLineGapAtLocationId: IdSchema.optional(),
  }).strict()).max(2000),
  exitStubs: z.array(z.object({
    locationId: IdSchema,
    direction: z.enum(['north', 'east', 'south', 'west']),
    oneWay: z.boolean(),
  }).strict()).max(2000).optional(),
}).strict();

export type ExitDefinition = z.infer<typeof ExitDefinitionSchema>;
export type MapPosition = z.infer<typeof MapPositionSchema>;
export type LocationDefinition = z.infer<typeof LocationDefinitionSchema>;
export type LocationTravelPreview = z.infer<typeof LocationTravelPreviewSchema>;
export type WorldPackDraft = z.infer<typeof WorldPackDraftSchema>;
export type WorldPackDraftInput = z.input<typeof WorldPackDraftSchema>;
export type RoadDefinition = z.infer<typeof RoadDefinitionSchema>;
export type CombatLootDefinition = z.infer<typeof CombatLootDefinitionSchema>;
export type RoadEncounterDefinition = z.infer<typeof RoadEncounterDefinitionSchema>;
export type LocationDescribeQuery = z.infer<typeof LocationDescribeQuerySchema>;
export type ObjectReadQuery = z.infer<typeof ObjectReadQuerySchema>;
export type ObjectInspectQuery = z.infer<typeof ObjectInspectQuerySchema>;
export type ReadableObjectDefinition = z.infer<typeof ReadableObjectDefinitionSchema>;
export type TakeableObjectDefinition = z.infer<typeof TakeableObjectDefinitionSchema>;
export type InteractableObjectDefinition = z.infer<typeof InteractableObjectDefinitionSchema>;
export type ItemUseInteractionDefinition = z.infer<typeof ItemUseInteractionDefinitionSchema>;
export type NpcDefinition = z.infer<typeof NpcDefinitionSchema>;
export type NpcCombatDisposition = z.infer<typeof NpcCombatDispositionSchema>;
export type NpcDialogueDefinition = z.infer<typeof NpcDialogueDefinitionSchema>;
export type NpcQuestResponseDefinition = z.infer<typeof NpcQuestResponseDefinitionSchema>;
export type NpcRoomChatReactionDefinition = z.infer<typeof NpcRoomChatReactionDefinitionSchema>;
export type NpcDialogueChoiceDefinition = z.infer<typeof NpcDialogueChoiceDefinitionSchema>;
export type NpcQuestStateCondition = z.infer<typeof NpcQuestStateConditionSchema>;
export type NpcPresenceProjection = z.infer<typeof NpcPresenceProjectionSchema>;
export type NpcTalkQuery = z.infer<typeof NpcTalkQuerySchema>;
export type NpcDialogueChoiceCommand = z.infer<typeof NpcDialogueChoiceCommandSchema>;
export type NpcDialogueProjection = z.infer<typeof NpcDialogueProjectionSchema>;
export type ReadableObjectProjection = z.infer<typeof ReadableObjectProjectionSchema>;
export type ObjectInspectionProjection = z.infer<typeof ObjectInspectionProjectionSchema>;
export type ContainerDefinition = z.infer<typeof ContainerDefinitionSchema>;
export type ContainerKind = z.infer<typeof ContainerKindSchema>;
export type LocationProjection = z.infer<typeof LocationProjectionSchema>;
export type RoomOccupantProjection = z.infer<typeof RoomOccupantProjectionSchema>;
export type RoomPresenceProjection = z.infer<typeof RoomPresenceProjectionSchema>;
export type WorldMapProjection = z.infer<typeof WorldMapProjectionSchema>;

export function validateDraftWorldGraph(pack: WorldPackDraft): string[] {
  const errors: string[] = [];
  const ids = new Set(pack.locations.map((room) => room.id));
  const allTakeables = pack.locations.flatMap((room) => [
    ...(room.takeables ?? []),
    ...(room.containers ?? []).flatMap((container) => container.contents),
  ]);
  const itemIds = new Set(allTakeables.map((item) => item.id));
  const containerIds = new Set(pack.locations.flatMap((room) => (room.containers ?? []).map((container) => container.id)));
  if (itemIds.size !== allTakeables.length) errors.push('Duplicate takeable item ID');
  if (containerIds.size !== pack.locations.reduce((total, room) => total + (room.containers?.length ?? 0), 0)) {
    errors.push('Duplicate container ID');
  }
  for (const containerId of containerIds) {
    if (itemIds.has(containerId)) errors.push(`Container ID ${containerId} conflicts with a takeable item ID`);
  }
  const merchantListingIds = new Set<string>();
  const merchantItemIds = new Set<string>();
  const innIds = new Set<string>();
  const inns = pack.locations.flatMap((location) => location.inn ? [{ inn: location.inn, location }] : []);
  const shopNpcs = pack.locations.flatMap((location) =>
    (location.npcs ?? []).filter((npc) => npc.shop).map((npc) => ({ npc, location })),
  );
  if (shopNpcs.length > 0 && !pack.currency) errors.push('World currency is required when a merchant catalog is present');
  if (inns.length > 0 && !pack.currency) errors.push('World currency is required when an inn is present');
  for (const { inn } of inns) {
    if (innIds.has(inn.id)) errors.push(`Duplicate inn ID ${inn.id}`);
    innIds.add(inn.id);
  }
  for (const { npc, location } of shopNpcs) {
    for (const listing of npc.shop?.listings ?? []) {
      if (merchantListingIds.has(listing.id)) errors.push(`Duplicate merchant listing ID ${listing.id}`);
      merchantListingIds.add(listing.id);
      if (merchantItemIds.has(listing.item.id) || itemIds.has(listing.item.id)) {
        errors.push(`Duplicate merchant item ID ${listing.item.id}`);
      }
      merchantItemIds.add(listing.item.id);
      if (location.npcs?.filter((candidate) => candidate.id === npc.id).length !== 1) {
        errors.push(`Merchant NPC ID ${npc.id} must be unique within its location`);
      }
    }
  }
  const combatLootSources = [
    ...pack.locations.flatMap((location) =>
      (location.npcs ?? []).flatMap((npc) => npc.loot ? [{ id: npc.id, loot: npc.loot }] : []),
    ),
    ...pack.roads.flatMap((road) =>
      road.encounters.flatMap((encounter) =>
        encounter.loot ? [{ id: encounter.id, loot: encounter.loot }] : [],
      ),
    ),
  ];
  for (const { id, loot } of combatLootSources) {
    if (loot.currencyAmount && !pack.currency) {
      errors.push(`Combat loot for ${id} requires configured world currency`);
    }
  }
  const allItemUseIds = new Set(pack.locations.flatMap((room) => (room.itemUses ?? []).map((interaction) => interaction.id)));
  if (ids.size !== pack.locations.length) errors.push('Duplicate location ID');
  const exits = new Set<string>();
  const itemUseIds = new Set<string>();
  for (const room of pack.locations) {
    if (room.requiredVisitedLocationId && !ids.has(room.requiredVisitedLocationId)) {
      errors.push(`Location ${room.id} requires missing visited location ${room.requiredVisitedLocationId}`);
    }
    for (const exit of room.exits) {
      if (exit.fromLocationId !== room.id) errors.push(`Exit ${exit.id} does not originate from its containing location`);
      if (!ids.has(exit.toLocationId)) errors.push(`Exit ${exit.id} points to missing location ${exit.toLocationId}`);
      if (exits.has(exit.id)) errors.push(`Duplicate exit ID ${exit.id}`);
      if (exit.requiredInteractionId && !room.itemUses?.some((interaction) => interaction.id === exit.requiredInteractionId)) {
        errors.push(`Exit ${exit.id} requires missing interaction ${exit.requiredInteractionId} in ${room.id}`);
      }
      exits.add(exit.id);
    }
    for (const interaction of room.itemUses ?? []) {
      if (itemUseIds.has(interaction.id)) errors.push(`Duplicate item-use interaction ID ${interaction.id}`);
      itemUseIds.add(interaction.id);
      if (!itemIds.has(interaction.itemId)) {
        errors.push(`Item-use interaction ${interaction.id} references missing takeable item ${interaction.itemId}`);
      }
      if (!room.interactables?.some((target) => target.id === interaction.targetId)) {
        errors.push(`Item-use interaction ${interaction.id} references missing interactable target ${interaction.targetId} in ${room.id}`);
      }
      if (interaction.requiredVisitedLocationId && !ids.has(interaction.requiredVisitedLocationId)) {
        errors.push(`Item-use interaction ${interaction.id} requires missing visited location ${interaction.requiredVisitedLocationId}`);
      }
      for (const requiredId of interaction.requiresInteractionIds ?? []) {
        if (!allItemUseIds.has(requiredId) || !room.itemUses?.some((candidate) => candidate.id === requiredId)) {
          errors.push(`Item-use interaction ${interaction.id} requires missing earlier interaction ${requiredId} in ${room.id}`);
        }
        if (requiredId === interaction.id) {
          errors.push(`Item-use interaction ${interaction.id} cannot require itself`);
        }
      }
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
    if (quest.reward && quest.reward.currencyId !== pack.currency?.id) {
      errors.push(`Quest ${quest.id} reward currency ${quest.reward.currencyId} does not match the world currency`);
    }
    for (const itemId of quest.reward?.itemIds ?? []) {
      if (!allTakeables.some((item) => item.id === itemId)) {
        errors.push(`Quest ${quest.id} reward references missing item ${itemId}`);
      }
    }
    if (!npcs.some(({ npc }) => npc.id === quest.giverNpcId)) {
      errors.push(`Quest ${quest.id} has a missing giver NPC ${quest.giverNpcId}`);
    }
    if (!npcs.some(({ npc }) => npc.id === quest.turnInNpcId)) {
      errors.push(`Quest ${quest.id} has a missing turn-in NPC ${quest.turnInNpcId}`);
    }
    for (const objective of quest.objectives) {
      if (objective.type === 'possess-item') {
        if (!allTakeables.some((item) => item.id === objective.itemId)) {
          errors.push(`Quest ${quest.id} objective ${objective.id} points to missing item ${objective.itemId}`);
        }
        continue;
      }
      if (objective.type === 'defeat-npc') {
        if (quest.scope !== 'party') {
          errors.push(`Quest ${quest.id} uses a defeat-NPC objective outside party scope`);
        }
        if (!npcs.some(({ npc }) => npc.id === objective.npcId && npc.combatProfile)) {
          errors.push(`Quest ${quest.id} objective ${objective.id} points to missing combatant ${objective.npcId}`);
        }
        continue;
      }
      if (!ids.has(objective.locationId)) {
        errors.push(`Quest ${quest.id} objective ${objective.id} points to missing location ${objective.locationId}`);
      } else if (objective.type === 'read-object') {
        const location = pack.locations.find((candidate) => candidate.id === objective.locationId);
        if (!location?.readables?.some((readable) => readable.id === objective.objectId)) {
          errors.push(`Quest ${quest.id} objective ${objective.id} points to missing readable ${objective.objectId}`);
        }
      } else if (objective.type === 'perform-interaction') {
        const location = pack.locations.find((candidate) => candidate.id === objective.locationId);
        if (!location?.itemUses?.some((interaction) => interaction.id === objective.interactionId)) {
          errors.push(`Quest ${quest.id} objective ${objective.id} points to missing interaction ${objective.interactionId}`);
        }
      }
    }
  }
  for (const { npc } of npcs) {
    const dailyJobResponses = [
      ...(npc.dailyJobResponses ?? []),
      ...npc.topics.flatMap((topic) => topic.dailyJobResponses ?? []),
    ];
    for (const response of dailyJobResponses) {
      const board = pack.dailyBoards?.find((candidate) => candidate.id === response.boardId);
      if (!board) {
        errors.push(`NPC ${npc.id} dialogue response references missing daily board ${response.boardId}`);
      } else if (!board.slots.flat().some((job) => job.id === response.jobId)) {
        errors.push(`NPC ${npc.id} dialogue response references missing daily job ${response.jobId} on board ${board.id}`);
      }
    }
    const questResponses = [
      ...(npc.dialogue?.questResponses ?? []),
      ...npc.topics.flatMap((topic) => topic.questResponses ?? []),
    ];
    for (const questResponse of questResponses) {
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
