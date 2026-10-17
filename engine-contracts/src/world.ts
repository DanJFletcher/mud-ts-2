/** PROPOSED v0.1: portable definitions vs runtime, read-only player projections. */
import { z } from 'zod';
import { ClientQueryBaseSchema } from './protocol.js';
import { ContractVersionSchema, IdSchema, NonNegativeIntSchema } from './ids.js';

export const ExitDefinitionSchema = z.object({
  id: IdSchema,
  fromLocationId: IdSchema,
  toLocationId: IdSchema,
  label: z.string().min(1).max(120),
  direction: z.string().max(40).optional(),
}).strict();

export const ReadableObjectDefinitionSchema = z.object({
  id: IdSchema,
  label: z.string().min(1).max(120),
  description: z.string().min(1).max(1000),
  text: z.string().min(1).max(4000),
}).strict();

export const TakeableObjectDefinitionSchema = z.object({
  id: IdSchema,
  label: z.string().min(1).max(120),
  description: z.string().min(1).max(1000),
  roomDescription: z.string().min(1).max(1000).optional(),
}).strict();

export const LocationDefinitionSchema = z.object({
  id: IdSchema,
  name: z.string().min(1).max(160),
  description: z.string().min(1),
  regionId: IdSchema.optional(),
  exits: z.array(ExitDefinitionSchema),
  readables: z.array(ReadableObjectDefinitionSchema).optional(),
  takeables: z.array(TakeableObjectDefinitionSchema).optional(),
}).strict();

export const WorldPackDraftSchema = z.object({
  formatVersion: ContractVersionSchema,
  packId: IdSchema,
  packVersion: z.string().min(1),
  displayName: z.string().min(1),
  locations: z.array(LocationDefinitionSchema),
}).strict();

export const LocationDescribeQuerySchema = ClientQueryBaseSchema.extend({
  type: z.literal('location.describe'),
  payload: z.object({ locationId: IdSchema.optional() }).strict(),
}).strict();

export const ObjectReadQuerySchema = ClientQueryBaseSchema.extend({
  type: z.literal('object.read'),
  payload: z.object({ objectId: IdSchema }).strict(),
}).strict();

export const ObjectInspectQuerySchema = ClientQueryBaseSchema.extend({
  type: z.literal('object.inspect'),
  payload: z.object({ objectId: IdSchema }).strict(),
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

export const ExitProjectionSchema = z.object({
  id: IdSchema,
  label: z.string(),
  direction: z.string().optional(),
  available: z.boolean(),
}).strict();

/** Projection is already filtered for the authenticated viewer. */
export const LocationProjectionSchema = z.object({
  worldInstanceId: IdSchema,
  locationId: IdSchema,
  revision: NonNegativeIntSchema,
  cursor: z.string().optional(),
  title: z.string(),
  description: z.string(),
  exits: z.array(ExitProjectionSchema),
  objects: z.array(z.object({
    id: IdSchema,
    label: z.string().min(1).max(120),
    description: z.string().min(1).max(1000),
    readable: z.boolean(),
    takeable: z.boolean(),
  }).strict()),
  occupants: z.array(z.object({ id: IdSchema, displayName: z.string() }).strict()),
}).strict();

export type ExitDefinition = z.infer<typeof ExitDefinitionSchema>;
export type LocationDefinition = z.infer<typeof LocationDefinitionSchema>;
export type WorldPackDraft = z.infer<typeof WorldPackDraftSchema>;
export type LocationDescribeQuery = z.infer<typeof LocationDescribeQuerySchema>;
export type ObjectReadQuery = z.infer<typeof ObjectReadQuerySchema>;
export type ObjectInspectQuery = z.infer<typeof ObjectInspectQuerySchema>;
export type ReadableObjectDefinition = z.infer<typeof ReadableObjectDefinitionSchema>;
export type TakeableObjectDefinition = z.infer<typeof TakeableObjectDefinitionSchema>;
export type ReadableObjectProjection = z.infer<typeof ReadableObjectProjectionSchema>;
export type ObjectInspectionProjection = z.infer<typeof ObjectInspectionProjectionSchema>;
export type LocationProjection = z.infer<typeof LocationProjectionSchema>;

export function validateDraftWorldGraph(pack: WorldPackDraft): string[] {
  const errors: string[] = [];
  const ids = new Set(pack.locations.map((room) => room.id));
  if (ids.size !== pack.locations.length) errors.push('Duplicate location ID');
  const exits = new Set<string>();
  for (const room of pack.locations) {
    for (const exit of room.exits) {
      if (exit.fromLocationId !== room.id) errors.push(`Exit ${exit.id} does not originate from its containing location`);
      if (!ids.has(exit.toLocationId)) errors.push(`Exit ${exit.id} points to missing location ${exit.toLocationId}`);
      if (exits.has(exit.id)) errors.push(`Duplicate exit ID ${exit.id}`);
      exits.add(exit.id);
    }
  }
  return errors;
}
