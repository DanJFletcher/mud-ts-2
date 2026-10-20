/**
 * Adapted from original architect/MESSAGE_CONTRACTS.example.ts.
 * PROPOSED (not verified against a running MUDD repository).
 * A player may request a character; the server must verify ownership.
 */
import { z } from 'zod';
import { ClientCommandBaseSchema, DomainEventBaseSchema } from './protocol.js';
import { IdSchema } from './ids.js';

export const RoadStepCommandSchema = ClientCommandBaseSchema.extend({
  type: z.literal('character.road.step'),
  expectedVersion: z.number().int().nonnegative(),
  payload: z.object({ exitId: IdSchema }).strict(),
}).strict();

export const MoveCharacterCommandSchema = ClientCommandBaseSchema.extend({
  type: z.literal('character.move'),
  expectedVersion: z.number().int().nonnegative(),
  payload: z.object({ exitId: IdSchema }).strict(),
}).strict();

export const CharacterMovedEventSchema = DomainEventBaseSchema.extend({
  type: z.literal('character.moved'),
  payload: z.object({
    characterId: IdSchema,
    fromLocationId: IdSchema,
    toLocationId: IdSchema,
    exitId: IdSchema,
    movementCost: z.number().nonnegative().optional(),
    roadTravel: z.object({
      roadId: IdSchema,
      segmentIndex: z.number().int().positive(),
      encounterRoll: z.number().int().min(1).max(100),
      encounterOccurred: z.boolean(),
    }).strict().optional(),
  }).strict(),
}).strict();

export type MoveCharacterCommand = z.infer<typeof MoveCharacterCommandSchema>;
export type RoadStepCommand = z.infer<typeof RoadStepCommandSchema>;
export type CharacterMovedEvent = z.infer<typeof CharacterMovedEventSchema>;
