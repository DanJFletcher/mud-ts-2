import { z } from 'zod';
import { IdSchema, IsoDateTimeSchema } from './ids.js';

export const AutonomousNpcTickCommandSchema = z.object({
  type: z.literal('world.npc.tick'),
  version: z.literal(1),
  commandId: IdSchema,
  worldInstanceId: IdSchema,
  npcId: IdSchema,
}).strict();

export const WorldNpcMovedEventSchema = z.object({
  type: z.literal('world.npc.moved'),
  version: z.literal(1),
  payload: z.object({
    npcId: IdSchema,
    fromLocationId: IdSchema,
    toLocationId: IdSchema,
    exitId: IdSchema,
    direction: z.string().max(40).optional(),
    attemptedAt: IsoDateTimeSchema,
    routeIndex: z.number().int().nonnegative().optional(),
  }).strict(),
}).strict();

export const WorldNpcMovementWaitedEventSchema = z.object({
  type: z.literal('world.npc.movement_waited'),
  version: z.literal(1),
  payload: z.object({
    npcId: IdSchema,
    locationId: IdSchema,
    attemptedAt: IsoDateTimeSchema,
    routeIndex: z.number().int().nonnegative().optional(),
  }).strict(),
}).strict();

export type AutonomousNpcTickCommand = z.infer<typeof AutonomousNpcTickCommandSchema>;
export type WorldNpcMovedEvent = z.infer<typeof WorldNpcMovedEventSchema>;
export type WorldNpcMovementWaitedEvent = z.infer<typeof WorldNpcMovementWaitedEventSchema>;
