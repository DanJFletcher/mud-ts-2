import { z } from 'zod';
import { ClientCommandBaseSchema, DomainEventBaseSchema } from './protocol.js';
import { IdSchema, NonNegativeIntSchema, PositiveIntSchema } from './ids.js';

export const CombatActionIdSchema = z.enum(['attack', 'defend', 'flee', 'use-item']);
export const CombatOutcomeSchema = z.enum(['active', 'victory', 'defeat', 'fled']);
export const CombatStyleSchema = z.enum(['steady', 'heavy', 'guardian']);

/** Mechanics supplied by the selected combat ruleset for an authored NPC. */
export const NpcCombatProfileSchema = z.object({
  maxHealth: PositiveIntSchema.max(1000),
  attackDamage: NonNegativeIntSchema.max(100),
  style: CombatStyleSchema.optional(),
  defense: NonNegativeIntSchema.max(100).optional(),
}).strict();

export const CombatEncounterProjectionSchema = z.object({
  encounterId: IdSchema,
  locationId: IdSchema,
  opponentNpcId: IdSchema,
  opponentName: z.string().min(1).max(120),
  opponentStyle: CombatStyleSchema.default('steady'),
  round: PositiveIntSchema,
  playerHealth: NonNegativeIntSchema.max(1000),
  playerMaxHealth: PositiveIntSchema.max(1000),
  opponentHealth: NonNegativeIntSchema.max(1000),
  opponentMaxHealth: PositiveIntSchema.max(1000),
  status: CombatOutcomeSchema,
  lastAction: CombatActionIdSchema,
  lastNarration: z.string().min(1).max(1000),
}).strict().superRefine((combat, context) => {
  if (combat.playerHealth > combat.playerMaxHealth) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['playerHealth'], message: 'Player health exceeds its maximum.' });
  }
  if (combat.opponentHealth > combat.opponentMaxHealth) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['opponentHealth'], message: 'Opponent health exceeds its maximum.' });
  }
  if (combat.status === 'victory' && combat.opponentHealth !== 0) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['status'], message: 'Victory requires a defeated opponent.' });
  }
  if (combat.status === 'defeat' && combat.playerHealth !== 0) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['status'], message: 'Defeat requires the player to be at zero health.' });
  }
});

export const CombatActionCommandSchema = ClientCommandBaseSchema.extend({
  type: z.literal('combat.action'),
  expectedVersion: NonNegativeIntSchema,
  payload: z.object({
    action: CombatActionIdSchema,
    encounterId: IdSchema.optional(),
    targetNpcId: IdSchema.optional(),
    itemId: IdSchema.optional(),
  }).strict().superRefine((payload, context) => {
    if (payload.action === 'attack' && !payload.encounterId && !payload.targetNpcId) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['targetNpcId'],
        message: 'An initial attack must identify its target.',
      });
    }
    if (payload.action !== 'attack' && !payload.encounterId) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['encounterId'],
        message: 'This action requires an active encounter.',
      });
    }
    if (payload.action === 'use-item' && !payload.itemId) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['itemId'],
        message: 'Using an item requires an item ID.',
      });
    }
    if (payload.action !== 'use-item' && payload.itemId) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['itemId'],
        message: 'Only the use-item action accepts an item ID.',
      });
    }
    if (payload.encounterId && payload.targetNpcId) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['targetNpcId'],
        message: 'Choose either an active encounter or a new target.',
      });
    }
  }),
}).strict();

const CombatActionResolvedPayloadSchema = z.object({
  characterId: IdSchema,
  damageDealt: NonNegativeIntSchema.max(1000),
  damageTaken: NonNegativeIntSchema.max(1000),
  encounter: CombatEncounterProjectionSchema,
}).strict();

const CombatActionResolvedPayloadV3Schema = CombatActionResolvedPayloadSchema.extend({
  consumedItemId: IdSchema.optional(),
  healingDone: NonNegativeIntSchema.max(1000).default(0),
}).strict().superRefine((payload, context) => {
  const usedItem = payload.encounter.lastAction === 'use-item';
  if (usedItem !== Boolean(payload.consumedItemId)) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['consumedItemId'],
      message: 'Combat item use must record exactly one consumed item.',
    });
  }
  if (usedItem !== (payload.healingDone > 0)) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['healingDone'],
      message: 'Combat item use must record positive healing.',
    });
  }
});

export const CombatActionResolvedEventV1Schema = DomainEventBaseSchema.extend({
  type: z.literal('character.combat_action_resolved'),
  version: z.literal(1),
  payload: CombatActionResolvedPayloadSchema,
}).strict();

export const CombatActionResolvedEventV2Schema = DomainEventBaseSchema.extend({
  type: z.literal('character.combat_action_resolved'),
  version: z.literal(2),
  payload: CombatActionResolvedPayloadSchema,
}).strict();

export const CombatActionResolvedEventV3Schema = DomainEventBaseSchema.extend({
  type: z.literal('character.combat_action_resolved'),
  version: z.literal(3),
  payload: CombatActionResolvedPayloadV3Schema,
}).strict();

export const CombatActionResolvedEventSchema = z.discriminatedUnion('version', [
  CombatActionResolvedEventV1Schema,
  CombatActionResolvedEventV2Schema,
  CombatActionResolvedEventV3Schema,
]);

export type CombatActionId = z.infer<typeof CombatActionIdSchema>;
export type CombatStyle = z.infer<typeof CombatStyleSchema>;
export type NpcCombatProfile = z.infer<typeof NpcCombatProfileSchema>;
export type CombatEncounterProjection = z.infer<typeof CombatEncounterProjectionSchema>;
export type CombatActionCommand = z.infer<typeof CombatActionCommandSchema>;
