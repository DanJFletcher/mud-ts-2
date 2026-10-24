import { z } from 'zod';
import { IdSchema } from './ids.js';
import { ClientCommandBaseSchema, ClientQueryBaseSchema, DomainEventBaseSchema } from './protocol.js';

export const SupplyDefinitionSchema = z.object({
  typeId: IdSchema,
  label: z.string().min(1).max(120),
  description: z.string().min(1).max(1000),
}).strict();
export const DailyJobDefinitionSchema = z.object({
  id: IdSchema,
  poster: z.string().min(1).max(120),
  title: z.string().min(1).max(120),
  supplyTypeId: IdSchema,
  quantity: z.number().int().min(1).max(20),
  gold: z.number().int().min(1).max(1000),
  experience: z.number().int().min(1).max(1000),
}).strict();
export const DailyBoardDefinitionSchema = z.object({
  id: IdSchema,
  locationId: IdSchema,
  name: z.string().min(1).max(120),
  /** One variant from each slot is selected by UTC day, without random queries. */
  slots: z.array(z.array(DailyJobDefinitionSchema).min(2).max(12)).min(1).max(12),
}).strict();
export const SupplySourceDefinitionSchema = z.object({
  id: IdSchema,
  locationId: IdSchema,
  label: z.string().min(1).max(120),
  supply: SupplyDefinitionSchema,
  dailyLimit: z.number().int().min(1).max(20),
}).strict();
export const DailyJobStateSchema = z.object({
  boardId: IdSchema,
  cycle: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  jobId: IdSchema,
  title: z.string(),
  status: z.enum(['active', 'completed']),
  /** Accepted terms remain fixed even if authoring changes before delivery. */
  details: DailyJobDefinitionSchema.optional(),
}).strict();
export const SupplyCollectionStateSchema = z.object({
  sourceId: IdSchema,
  cycle: z.string(),
  count: z.number().int().nonnegative(),
}).strict();
export const DailyBoardQuerySchema = ClientQueryBaseSchema.extend({
  type: z.literal('daily.board'), version: z.literal(1),
  payload: z.object({ boardId: IdSchema }).strict(),
}).strict();
export const DailyJobCommandSchema = ClientCommandBaseSchema.extend({
  type: z.literal('daily.job'), version: z.literal(1),
  expectedVersion: z.number().int().nonnegative(),
  payload: z.object({
    boardId: IdSchema, cycle: z.string(), jobId: IdSchema,
    action: z.enum(['accept', 'deliver']),
  }).strict(),
}).strict();
export const GatherSupplyCommandSchema = ClientCommandBaseSchema.extend({
  type: z.literal('supply.gather'), version: z.literal(1),
  expectedVersion: z.number().int().nonnegative(),
  payload: z.object({ sourceId: IdSchema, cycle: z.string() }).strict(),
}).strict();
export const DailyBoardProjectionSchema = z.object({
  boardId: IdSchema, name: z.string(), cycle: z.string(),
  resetsAt: z.string().datetime(),
  jobs: z.array(DailyJobDefinitionSchema.extend({
    carried: z.number().int().nonnegative(),
    status: z.enum(['available', 'active', 'completed']),
  })),
}).strict();
export const DailyJobChangedEventSchema = DomainEventBaseSchema.extend({
  type: z.literal('character.daily_job_changed'), version: z.literal(1),
  payload: z.object({
    characterId: IdSchema,
    job: DailyJobStateSchema,
    consumedItemIds: z.array(IdSchema).max(20),
    gold: z.number().int().nonnegative().max(1000),
    experience: z.number().int().nonnegative().max(1000),
    currencyId: IdSchema,
    level: z.number().int().min(1).max(10),
    maximumHealth: z.number().int().positive(),
  }).strict(),
}).strict();
export const SupplyGatheredEventSchema = DomainEventBaseSchema.extend({
  type: z.literal('character.supply_gathered'), version: z.literal(1),
  payload: z.object({
    characterId: IdSchema, sourceId: IdSchema, cycle: z.string(),
    item: SupplyDefinitionSchema.extend({ id: IdSchema }).strict(),
  }).strict(),
}).strict();
export type DailyBoardProjection = z.infer<typeof DailyBoardProjectionSchema>;
export type DailyBoardDefinition = z.infer<typeof DailyBoardDefinitionSchema>;
export function dailyCycle(now: Date): string { return now.toISOString().slice(0, 10); }
export function dailyPostings(board: DailyBoardDefinition, cycle: string) {
  const day = Math.floor(Date.parse(`${cycle}T00:00:00.000Z`) / 86400000);
  return board.slots.map((variants, index) => variants[(day + index) % variants.length]!);
}
