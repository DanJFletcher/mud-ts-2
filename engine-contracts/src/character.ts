/** PROPOSED minimal character intent/view, independent of race/class rulesets. */
import { z } from 'zod';
import { DomainEventBaseSchema } from './protocol.js';
import { IdSchema, NonEmptyNameSchema, NonNegativeIntSchema, ContractVersionSchema } from './ids.js';

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

export const CharacterProjectionSchema = z.object({
  worldInstanceId: IdSchema,
  characterId: IdSchema,
  name: NonEmptyNameSchema,
  locationId: IdSchema,
  revision: NonNegativeIntSchema,
}).strict();

export type CreateCharacterCommand = z.infer<typeof CreateCharacterCommandSchema>;
export type CharacterCreatedEvent = z.infer<typeof CharacterCreatedEventSchema>;
export type CharacterProjection = z.infer<typeof CharacterProjectionSchema>;
