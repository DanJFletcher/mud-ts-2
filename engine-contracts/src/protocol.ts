/** PROPOSED v0.1 protocol. actorId is NEVER client-authoritative. */
import { z } from 'zod';
import { ContractVersionSchema, IdSchema, IsoDateTimeSchema, NonNegativeIntSchema, PositiveIntSchema } from './ids.js';

export const ClientCommandBaseSchema = z.object({
  type: z.string().min(1),
  version: ContractVersionSchema,
  commandId: IdSchema,
  worldInstanceId: IdSchema,
  characterId: IdSchema,
  expectedVersion: NonNegativeIntSchema.optional(),
});

export const ClientQueryBaseSchema = z.object({
  type: z.string().min(1),
  version: ContractVersionSchema,
  queryId: IdSchema,
  worldInstanceId: IdSchema,
  characterId: IdSchema,
});

export const DomainEventBaseSchema = z.object({
  type: z.string().min(1),
  version: ContractVersionSchema,
  eventId: IdSchema,
  worldInstanceId: IdSchema,
  aggregateId: IdSchema,
  aggregateVersion: PositiveIntSchema,
  causationCommandId: IdSchema,
  actorId: IdSchema,
  occurredAt: IsoDateTimeSchema,
  tick: NonNegativeIntSchema,
});

export const CommandErrorCodeSchema = z.enum([
  'UNAUTHENTICATED', 'FORBIDDEN', 'INVALID_COMMAND', 'UNKNOWN_COMMAND',
  'NOT_FOUND', 'VERSION_CONFLICT', 'RULE_VIOLATION', 'RATE_LIMITED',
  'PROJECTION_NOT_READY', 'INTERNAL_ERROR',
]);

export const CommandReceiptSchema = z.discriminatedUnion('ok', [
  z.object({
    ok: z.literal(true),
    commandId: IdSchema,
    eventIds: z.array(IdSchema),
    newAggregateVersion: NonNegativeIntSchema,
  }).strict(),
  z.object({
    ok: z.literal(false),
    commandId: IdSchema,
    code: CommandErrorCodeSchema,
    message: z.string().min(1),
    retryable: z.boolean(),
  }).strict(),
]);

export type ClientCommandBase = z.infer<typeof ClientCommandBaseSchema>;
export type ClientQueryBase = z.infer<typeof ClientQueryBaseSchema>;
export type DomainEventBase = z.infer<typeof DomainEventBaseSchema>;
export type CommandReceipt = z.infer<typeof CommandReceiptSchema>;
export type CommandErrorCode = z.infer<typeof CommandErrorCodeSchema>;
