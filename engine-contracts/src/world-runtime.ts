import { z } from 'zod';
import { ClientCommandBaseSchema, ClientQueryBaseSchema } from './protocol.js';
import { IdSchema, NonNegativeIntSchema } from './ids.js';
import { InnProjectionSchema } from './commerce.js';
import { LocationGroupMembershipProjectionSchema } from './location-groups.js';
import {
  ContainerKindSchema,
  MapColorSchema,
  MapTerrainSchema,
  NpcCombatDispositionSchema,
  ReadActionSchema,
} from './world-shared.js';

export const NpcPresenceProjectionSchema = z.object({
  id: IdSchema,
  name: z.string().min(1).max(120),
  activityDescription: z.string().min(1).max(240).optional(),
  description: z.string().min(1).max(1000).optional(),
  canChallenge: z.boolean().default(false),
  combatDisposition: NpcCombatDispositionSchema.default('passive'),
  canShop: z.boolean().default(false),
}).strict();

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

export const NpcDialogueRestartCommandSchema = ClientCommandBaseSchema.extend({
  type: z.literal('npc.dialogue.restart'),
  expectedVersion: NonNegativeIntSchema,
  payload: z.object({
    npcId: IdSchema,
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
    readAction: ReadActionSchema.optional(),
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

export type LocationTravelPreview = z.infer<typeof LocationTravelPreviewSchema>;
export type LocationDescribeQuery = z.infer<typeof LocationDescribeQuerySchema>;
export type ObjectReadQuery = z.infer<typeof ObjectReadQuerySchema>;
export type ObjectInspectQuery = z.infer<typeof ObjectInspectQuerySchema>;
export type NpcPresenceProjection = z.infer<typeof NpcPresenceProjectionSchema>;
export type NpcTalkQuery = z.infer<typeof NpcTalkQuerySchema>;
export type NpcDialogueChoiceCommand = z.infer<typeof NpcDialogueChoiceCommandSchema>;
export type NpcDialogueProjection = z.infer<typeof NpcDialogueProjectionSchema>;
export type ReadableObjectProjection = z.infer<typeof ReadableObjectProjectionSchema>;
export type ObjectInspectionProjection = z.infer<typeof ObjectInspectionProjectionSchema>;
export type LocationProjection = z.infer<typeof LocationProjectionSchema>;
export type RoomOccupantProjection = z.infer<typeof RoomOccupantProjectionSchema>;
export type RoomPresenceProjection = z.infer<typeof RoomPresenceProjectionSchema>;
export type WorldMapProjection = z.infer<typeof WorldMapProjectionSchema>;
