import { z } from 'zod';
import { IdSchema, NonNegativeIntSchema, PositiveIntSchema } from './ids.js';
import { ClientCommandBaseSchema, DomainEventBaseSchema } from './protocol.js';

export const FishingRodDefinitionSchema = z.object({
  qualityId: IdSchema,
  biteChancePercent: z.number().int().min(1).max(100).default(10),
  waitSeconds: PositiveIntSchema.max(600).default(10),
  /** Optional species-weight adjustments. Weights are normalized with the spot's other species. */
  speciesWeightOverrides: z.record(IdSchema, z.number().int().min(0).max(1000)).optional(),
}).strict();

export const FishingRaritySchema = z.enum(['common', 'uncommon', 'rare', 'trophy']);
export const FishingSizeBandDefinitionSchema = z.object({
  rarity: FishingRaritySchema,
  weightPercent: PositiveIntSchema.max(100),
  minLengthCm: PositiveIntSchema.max(300),
  maxLengthCm: PositiveIntSchema.max(300),
  minWeightGrams: PositiveIntSchema.max(200_000),
  maxWeightGrams: PositiveIntSchema.max(200_000),
}).strict().superRefine((band, context) => {
  if (band.maxLengthCm < band.minLengthCm) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['maxLengthCm'], message: 'Maximum length must not be below minimum length.' });
  }
  if (band.maxWeightGrams < band.minWeightGrams) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['maxWeightGrams'], message: 'Maximum weight must not be below minimum weight.' });
  }
});

export const FishingSpeciesDefinitionSchema = z.object({
  id: IdSchema,
  name: z.string().trim().min(1).max(80),
  itemTypeId: IdSchema,
  /** Relative chance among species when a bite is successful. */
  weightPercent: PositiveIntSchema.max(1000),
  sizeBands: z.array(FishingSizeBandDefinitionSchema).min(1).max(8),
}).strict().superRefine((species, context) => {
  const total = species.sizeBands.reduce((sum, band) => sum + band.weightPercent, 0);
  if (total !== 100) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['sizeBands'], message: 'Fish size rarity weights must total 100.' });
  }
  if (new Set(species.sizeBands.map((band) => band.rarity)).size !== species.sizeBands.length) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['sizeBands'], message: 'Fish size rarity bands must be unique.' });
  }
});

export const FishingSpotDefinitionSchema = z.object({
  id: IdSchema,
  locationId: IdSchema,
  stateId: IdSchema.optional(),
  label: z.string().trim().min(1).max(120),
  tickSeconds: PositiveIntSchema.max(60).default(1),
  species: z.array(FishingSpeciesDefinitionSchema).min(1).max(24),
}).strict().superRefine((spot, context) => {
  if (new Set(spot.species.map((species) => species.id)).size !== spot.species.length) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['species'], message: 'Fishing spot species IDs must be unique.' });
  }
});

export const FishCatchMetadataSchema = z.object({
  speciesId: IdSchema,
  rarity: FishingRaritySchema,
  lengthCm: PositiveIntSchema.max(300),
  weightGrams: PositiveIntSchema.max(200_000),
}).strict();

export const FishingCastStateSchema = z.object({
  castId: IdSchema,
  spotId: IdSchema,
  locationId: IdSchema,
  rodItemId: IdSchema,
  rodQualityId: IdSchema,
  startedAt: z.string().datetime(),
  tickIntervalSeconds: PositiveIntSchema.max(60),
  ticksRequired: PositiveIntSchema.max(600),
  ticksCompleted: NonNegativeIntSchema.max(600),
}).strict().superRefine((cast, context) => {
  if (cast.ticksCompleted > cast.ticksRequired) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['ticksCompleted'], message: 'Fishing progress exceeds the cast duration.' });
  }
});

export const FishingCastCommandSchema = ClientCommandBaseSchema.extend({
  type: z.literal('fishing.cast'),
  version: z.literal(1),
  expectedVersion: NonNegativeIntSchema,
  payload: z.object({ rodItemId: IdSchema }).strict(),
}).strict();

export const FishingAdvanceCommandSchema = ClientCommandBaseSchema.extend({
  type: z.literal('fishing.advance'),
  version: z.literal(1),
  expectedVersion: NonNegativeIntSchema,
  payload: z.object({ castId: IdSchema }).strict(),
}).strict();

export const FishingCastStartedEventSchema = DomainEventBaseSchema.extend({
  type: z.literal('character.fishing_cast_started'),
  version: z.literal(1),
  payload: z.object({
    characterId: IdSchema,
    cast: FishingCastStateSchema,
  }).strict(),
}).strict();

export const FishingCastAdvancedEventSchema = DomainEventBaseSchema.extend({
  type: z.literal('character.fishing_cast_advanced'),
  version: z.literal(1),
  payload: z.object({
    characterId: IdSchema,
    castId: IdSchema,
    ticksCompleted: NonNegativeIntSchema.max(600),
    status: z.enum(['waiting', 'caught', 'no-bite', 'interrupted']),
    tickRolls: z.array(z.object({
      tick: PositiveIntSchema.max(600),
      roll: PositiveIntSchema.max(100),
      caught: z.boolean(),
    }).strict()).max(600),
    item: z.object({
      id: IdSchema,
      typeId: IdSchema,
      label: z.string().min(1).max(120),
      description: z.string().min(1).max(1000),
      fishCatch: FishCatchMetadataSchema,
    }).strict().optional(),
  }).strict().superRefine((event, context) => {
    if ((event.status === 'caught') !== Boolean(event.item)) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ['item'], message: 'Only a successful catch includes a fish item.' });
    }
    if (event.status === 'interrupted' && event.tickRolls.length > 0) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ['tickRolls'], message: 'Interrupted casts cannot include new bite rolls.' });
    }
    if (event.status !== 'interrupted' && event.tickRolls.length === 0) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ['tickRolls'], message: 'A fishing progress event must record its bite rolls.' });
    }
    if (event.status === 'caught' && !event.tickRolls.at(-1)?.caught) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ['tickRolls'], message: 'A catch must be recorded on the final roll.' });
    }
    if (event.status !== 'caught' && event.tickRolls.some(({ caught }) => caught)) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ['tickRolls'], message: 'Only a catch event can include a successful bite roll.' });
    }
  }),
}).strict();

export type FishingRodDefinition = z.infer<typeof FishingRodDefinitionSchema>;
export type FishingSpotDefinition = z.infer<typeof FishingSpotDefinitionSchema>;
export type FishingSpeciesDefinition = z.infer<typeof FishingSpeciesDefinitionSchema>;
export type FishingCastState = z.infer<typeof FishingCastStateSchema>;
