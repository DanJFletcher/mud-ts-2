import { z } from 'zod';
import { DomainEventBaseSchema } from './protocol.js';
import { IdSchema, IsoDateTimeSchema, NonNegativeIntSchema, PositiveIntSchema } from './ids.js';

export const WoodcuttingAxeDefinitionSchema = z.object({
  requiredLevel: PositiveIntSchema.max(99),
  /** Relative tier: each tier improves the server-calculated chance to cut a log. */
  power: PositiveIntSchema.max(20),
}).strict();

export const WoodcuttingTreeDefinitionSchema = z.object({
  id: IdSchema,
  locationId: IdSchema,
  label: z.string().min(1).max(120),
  logTypeId: IdSchema,
  logLabel: z.string().min(1).max(120),
  logDescription: z.string().min(1).max(1000),
  maximumLogs: PositiveIntSchema.max(1000),
  respawnSeconds: PositiveIntSchema.max(86_400),
  experiencePerLog: PositiveIntSchema.max(100_000),
  baseChancePercent: z.number().int().min(1).max(90).default(10),
}).strict();

export const WoodcuttingSkillSchema = z.object({
  experience: NonNegativeIntSchema.max(2_147_483_647),
  level: PositiveIntSchema.max(99),
}).strict();

export const WoodcuttingActionStateSchema = z.object({
  actionId: IdSchema,
  treeId: IdSchema,
  treeLabel: z.string().min(1).max(120),
  axeItemId: IdSchema,
  locationId: IdSchema,
  startedAt: IsoDateTimeSchema,
  ticksCompleted: NonNegativeIntSchema.max(10),
  ticksRequired: z.literal(10),
}).strict();

export const WoodcuttingTickRollSchema = z.object({
  tick: PositiveIntSchema.max(10),
  roll: z.number().min(0).max(1),
  success: z.boolean(),
}).strict();

export const WorldTreeHarvestedEventSchema = DomainEventBaseSchema.extend({
  type: z.literal('world.tree_harvested'),
  payload: z.object({
    treeId: IdSchema,
    characterId: IdSchema,
    remainingLogs: NonNegativeIntSchema.max(1000),
    respawnsAt: IsoDateTimeSchema.nullable(),
  }).strict(),
}).strict();

export const WoodcuttingActionStartedEventSchema = DomainEventBaseSchema.extend({
  type: z.literal('character.woodcutting_action_started'),
  payload: z.object({
    characterId: IdSchema,
    action: WoodcuttingActionStateSchema,
  }).strict(),
}).strict();

export const WoodcuttingActionAdvancedEventSchema = DomainEventBaseSchema.extend({
  type: z.literal('character.woodcutting_action_advanced'),
  payload: z.object({
    characterId: IdSchema,
    actionId: IdSchema,
    ticksCompleted: NonNegativeIntSchema.max(10),
    status: z.enum(['waiting', 'logged', 'no-log', 'tree-depleted', 'interrupted']),
    tickRolls: z.array(WoodcuttingTickRollSchema).max(10),
    skillExperienceAwarded: NonNegativeIntSchema.max(2_147_483_647),
    totalExperience: NonNegativeIntSchema.max(2_147_483_647),
    level: PositiveIntSchema.max(99),
    logLabel: z.string().min(1).max(120).optional(),
    logTypeId: IdSchema.optional(),
    item: z.object({
      id: IdSchema,
      typeId: IdSchema,
      label: z.string().min(1).max(120),
      description: z.string().min(1).max(1000),
      stackable: z.literal(true),
      quantity: PositiveIntSchema.max(2_147_483_647),
    }).strict().optional(),
    stackItemId: IdSchema.optional(),
    stackQuantity: PositiveIntSchema.max(2_147_483_647).optional(),
    treeDepleted: z.boolean().optional(),
  }).strict(),
}).strict();

export const StartWoodcuttingCommandSchema = z.object({
  type: z.literal('woodcutting.start'),
  version: z.number().int().positive(),
  commandId: IdSchema,
  worldInstanceId: IdSchema,
  characterId: IdSchema,
  expectedVersion: NonNegativeIntSchema,
  payload: z.object({
    axeItemId: IdSchema,
    treeId: IdSchema,
  }).strict(),
}).strict();

export const AdvanceWoodcuttingCommandSchema = z.object({
  type: z.literal('woodcutting.advance'),
  version: z.number().int().positive(),
  commandId: IdSchema,
  worldInstanceId: IdSchema,
  characterId: IdSchema,
  expectedVersion: NonNegativeIntSchema,
  payload: z.object({ actionId: IdSchema }).strict(),
}).strict();

export const CancelWoodcuttingCommandSchema = z.object({
  type: z.literal('woodcutting.cancel'),
  version: z.number().int().positive(),
  commandId: IdSchema,
  worldInstanceId: IdSchema,
  characterId: IdSchema,
  expectedVersion: NonNegativeIntSchema,
  payload: z.object({ actionId: IdSchema }).strict(),
}).strict();

export type WoodcuttingAxeDefinition = z.infer<typeof WoodcuttingAxeDefinitionSchema>;
export type WoodcuttingTreeDefinition = z.infer<typeof WoodcuttingTreeDefinitionSchema>;
export type WoodcuttingSkill = z.infer<typeof WoodcuttingSkillSchema>;
export type WoodcuttingActionState = z.infer<typeof WoodcuttingActionStateSchema>;
export type WoodcuttingTickRoll = z.infer<typeof WoodcuttingTickRollSchema>;
export type WorldTreeHarvestedEvent = z.infer<typeof WorldTreeHarvestedEventSchema>;
export type WoodcuttingActionStartedEvent = z.infer<typeof WoodcuttingActionStartedEventSchema>;
export type WoodcuttingActionAdvancedEvent = z.infer<typeof WoodcuttingActionAdvancedEventSchema>;
