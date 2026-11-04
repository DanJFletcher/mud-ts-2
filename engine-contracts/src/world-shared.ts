import { z } from 'zod';
import { IdSchema } from './ids.js';

export const MapTerrainSchema = z.string()
  .trim()
  .min(1)
  .max(48)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);

export const MapColorSchema = z.string().regex(/^#[0-9a-fA-F]{6}$/);

/** Semantic resource affordances; presentation remains client-owned. */
export const ReadActionSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('daily-board'), boardId: IdSchema }).strict(),
]);

export type ReadAction = z.infer<typeof ReadActionSchema>;

export const READABLE_ACTIONS_HEADER = 'x-mudd-readable-actions';
export const READABLE_ACTIONS_VERSION = '1';

export const ContainerKindSchema = z.enum(['sack', 'chest', 'corpse', 'other']);
export type ContainerKind = z.infer<typeof ContainerKindSchema>;

export const NpcCombatDispositionSchema = z.enum(['passive', 'hostile']);
export type NpcCombatDisposition = z.infer<typeof NpcCombatDispositionSchema>;
