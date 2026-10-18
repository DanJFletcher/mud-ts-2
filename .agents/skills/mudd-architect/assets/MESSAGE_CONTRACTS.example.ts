/**
 * Illustrative public movement messages. The transport obtains player identity
 * from a trusted authenticated session; actorId is deliberately NOT submitted
 * as an authoritative field in this client command.
 */
import { z } from "zod";

const Id = z.string().min(1).max(128);

export const MoveCharacterCommand = z.object({
  type: z.literal("character.move"),
  version: z.literal(1),
  commandId: Id,
  worldInstanceId: Id,
  characterId: Id,
  expectedVersion: z.number().int().nonnegative(),
  payload: z.object({ exitId: Id }).strict(),
}).strict();

export type MoveCharacterCommand = z.infer<typeof MoveCharacterCommand>;

export const CharacterMovedEvent = z.object({
  type: z.literal("character.moved"),
  version: z.literal(1),
  eventId: Id,
  worldInstanceId: Id,
  aggregateId: Id,
  aggregateVersion: z.number().int().positive(),
  causationCommandId: Id,
  actorId: Id,
  occurredAt: z.string().datetime(),
  tick: z.number().int().nonnegative(),
  payload: z.object({
    characterId: Id,
    fromLocationId: Id,
    toLocationId: Id,
    exitId: Id,
    movementCost: z.number().nonnegative().optional(),
  }).strict(),
}).strict();

export type CharacterMovedEvent = z.infer<typeof CharacterMovedEvent>;

export const CommandReceipt = z.discriminatedUnion("ok", [
  z.object({
    ok: z.literal(true),
    commandId: Id,
    eventIds: z.array(Id),
    newAggregateVersion: z.number().int().nonnegative(),
  }),
  z.object({
    ok: z.literal(false),
    commandId: Id,
    code: z.enum([
      "UNAUTHENTICATED", "FORBIDDEN", "INVALID_COMMAND", "NOT_FOUND",
      "VERSION_CONFLICT", "RULE_VIOLATION", "RATE_LIMITED", "INTERNAL_ERROR",
    ]),
    message: z.string(),
    retryable: z.boolean(),
  }),
]);

export type CommandReceipt = z.infer<typeof CommandReceipt>;

// On the server: verify identity, character ownership, presence in the current
// location, exit visibility, turn constraints, and expected aggregate version.
// Append CharacterMoved exactly once per accepted commandId and commit receipt
// in the same transaction. Publish scoped projections after commit.
