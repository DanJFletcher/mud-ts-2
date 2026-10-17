/**
 * PROPOSED v0.1: stable identifiers. The source examples use scoped strings;
 * this proposal preserves wire compatibility instead of imposing UUIDs.
 */
import { z } from 'zod';

export const IdSchema = z.string().min(1).max(128);
export const NonEmptyNameSchema = z.string().trim().min(1).max(120);
export const ContractVersionSchema = z.literal(1);
export const NonNegativeIntSchema = z.number().int().nonnegative();
export const PositiveIntSchema = z.number().int().positive();
export const IsoDateTimeSchema = z.string().datetime();

export type Id = z.infer<typeof IdSchema>;
export type PlayerId = Id;
export type CharacterId = Id;
export type SessionId = Id;
export type WorldId = Id;
export type WorldInstanceId = Id;
export type LocationId = Id;
export type ExitId = Id;
export type EntityId = Id;
export type CommandId = Id;
export type EventId = Id;

/** Use these separate names at boundaries even though their wire shape is string. */
export interface ScopedIdentity {
  readonly worldInstanceId: WorldInstanceId;
  readonly characterId?: CharacterId;
}
