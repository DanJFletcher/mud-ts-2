import { z } from 'zod';
import { ClientCommandBaseSchema, ClientQueryBaseSchema, DomainEventBaseSchema } from './protocol.js';
import { IdSchema } from './ids.js';

export const TeamCombatActionSchema = z.enum(['attack', 'defend', 'flee', 'use-item', 'ability']);

export const TeamCombatantSchema = z.object({
  participantId: IdSchema,
  teamId: IdSchema,
  kind: z.enum(['player', 'npc']),
  characterId: IdSchema.optional(),
  playerId: IdSchema.optional(),
  npcId: IdSchema.optional(),
  displayName: z.string().trim().min(1).max(80),
  health: z.number().int().nonnegative(),
  maximumHealth: z.number().int().positive(),
  characterHealthAnchor: z.number().int().nonnegative().optional(),
  defending: z.boolean(),
  status: z.enum(['active', 'defeated', 'escaped']),
}).strict().superRefine((participant, context) => {
  if (participant.kind === 'player' && (!participant.characterId || !participant.playerId || participant.npcId)) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'Player combatants require player and character IDs.' });
  }
  if (participant.kind === 'npc' && (!participant.npcId || participant.characterId || participant.playerId)) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'NPC combatants require only an NPC ID.' });
  }
});

export const TeamCombatEncounterSchema = z.object({
  encounterId: IdSchema,
  locationId: IdSchema,
  sourceGroupId: IdSchema.optional(),
  participants: z.array(TeamCombatantSchema).min(2).max(16),
  contributingPlayerIds: z.array(IdSchema),
  currentParticipantId: IdSchema.nullable(),
  round: z.number().int().nonnegative(),
  status: z.enum(['active', 'victory', 'defeat', 'fled']),
  lastNarration: z.string().min(1).max(2000),
  consumedItemIdsByCharacter: z.record(z.array(IdSchema)),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
}).strict();
export type TeamCombatEncounter = z.infer<typeof TeamCombatEncounterSchema>;

export const TeamRoadTravelSnapshotSchema = z.object({
  roadId: IdSchema,
  exitId: IdSchema,
  fromLocationId: IdSchema,
  toLocationId: IdSchema,
  segmentIndex: z.number().int().positive(),
  encounterRoll: z.number().int().min(1).max(100),
}).strict();
export type TeamRoadTravelSnapshot = z.infer<typeof TeamRoadTravelSnapshotSchema>;

export const TeamCombatStartedEventSchema = z.object({
  type: z.literal('team.combat_started'),
  version: z.literal(1),
  payload: z.object({ encounter: TeamCombatEncounterSchema }).strict(),
}).strict();

export const TeamRoadEncounterStartedEventSchema = z.object({
  type: z.literal('team.road_encounter_started'),
  version: z.literal(1),
  payload: z.object({
    encounter: TeamCombatEncounterSchema,
    roadTravel: TeamRoadTravelSnapshotSchema,
  }).strict(),
}).strict();

export const TeamCombatActionResolvedEventSchema = z.object({
  type: z.literal('team.combat_action_resolved'),
  version: z.literal(1),
  payload: z.object({
    encounter: TeamCombatEncounterSchema,
    actingCharacterId: IdSchema,
    action: TeamCombatActionSchema,
    damageDealt: z.number().int().nonnegative(),
    damageTaken: z.number().int().nonnegative(),
    healingDone: z.number().int().nonnegative(),
    narration: z.string().min(1).max(2000),
  }).strict(),
}).strict();

export const TeamCombatEndedEventSchema = z.object({
  type: z.literal('team.combat_ended'),
  version: z.literal(1),
  payload: z.object({
    encounterId: IdSchema,
    sourceGroupId: IdSchema.optional(),
    locationId: IdSchema,
    npcId: IdSchema,
    result: z.enum(['victory', 'defeat', 'fled']),
    contributingPlayerIds: z.array(IdSchema),
  }).strict(),
}).strict();

export const TeamCombatStartCommandSchema = ClientCommandBaseSchema.extend({
  type: z.literal('team.combat.start'),
  payload: z.object({ targetNpcId: IdSchema }).strict(),
}).strict();

export const TeamCombatActionCommandSchema = ClientCommandBaseSchema.extend({
  type: z.literal('team.combat.action'),
  payload: z.object({
    encounterId: IdSchema,
    action: TeamCombatActionSchema,
    targetParticipantId: IdSchema.optional(),
    itemId: IdSchema.optional(),
    abilityId: IdSchema.optional(),
  }).strict().superRefine((payload, context) => {
    if ((payload.action === 'ability') !== Boolean(payload.abilityId)) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ['abilityId'], message: 'Only an ability action requires an ability ID.' });
    }
    if ((payload.action === 'use-item') !== Boolean(payload.itemId)) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ['itemId'], message: 'Only item use requires an item ID.' });
    }
    if (payload.action !== 'attack' && payload.action !== 'ability' && payload.targetParticipantId) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ['targetParticipantId'], message: 'This action does not accept a target.' });
    }
  }),
}).strict();

export const TeamCombatInfoQuerySchema = ClientQueryBaseSchema.extend({
  type: z.literal('team.combat.info'),
  version: z.literal(1),
  payload: z.object({}).strict(),
}).strict();

export const TeamCombatInfoProjectionSchema = z.object({
  encounter: TeamCombatEncounterSchema.nullable(),
  roadTravel: TeamRoadTravelSnapshotSchema.optional(),
}).strict();
export type TeamCombatInfoProjection = z.infer<typeof TeamCombatInfoProjectionSchema>;

export const CharacterTeamCombatOutcomeAppliedEventSchema = DomainEventBaseSchema.extend({
  type: z.literal('character.team_combat_outcome_applied'),
  payload: z.object({
    characterId: IdSchema,
    encounterId: IdSchema,
    result: z.enum(['victory', 'defeat', 'fled']),
    health: z.object({
      current: z.number().int().nonnegative(),
      maximum: z.number().int().positive(),
    }).strict(),
    consumedItemIds: z.array(IdSchema),
  }).strict(),
}).strict();

export const TeamCombatOutcomeEffectSchema = z.object({
  encounterId: IdSchema,
  locationId: IdSchema,
  result: z.enum(['victory', 'defeat', 'fled']),
  roadTravel: TeamRoadTravelSnapshotSchema.optional(),
  players: z.array(z.object({
    characterId: IdSchema,
    health: z.number().int().nonnegative(),
    maximumHealth: z.number().int().positive(),
    healthDelta: z.number().int().optional(),
    consumedItemIds: z.array(IdSchema),
  }).strict()).max(8),
}).strict();
