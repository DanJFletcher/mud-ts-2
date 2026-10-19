import { z } from 'zod';
import { ClientCommandBaseSchema } from './protocol.js';
import { IdSchema, NonNegativeIntSchema } from './ids.js';

export const GroupMemberSchema = z.object({
  playerId: IdSchema,
  characterId: IdSchema,
  displayName: z.string().trim().min(1).max(48),
}).strict();
export type GroupMember = z.infer<typeof GroupMemberSchema>;

export const GroupProjectionSchema = z.object({
  groupId: IdSchema,
  groupType: z.string().trim().min(1).max(64),
  ownerPlayerId: IdSchema,
  maxMembers: z.number().int().min(2).max(100),
  isPublic: z.boolean(),
  status: z.enum(['active', 'closed']),
  members: z.array(GroupMemberSchema),
  createdAt: z.string().datetime(),
  closedAt: z.string().datetime().optional(),
}).strict();
export type GroupProjection = z.infer<typeof GroupProjectionSchema>;

export const GroupAggregateProjectionSchema = z.object({
  revision: NonNegativeIntSchema,
  groups: z.array(GroupProjectionSchema),
}).strict();
export type GroupAggregateProjection = z.infer<typeof GroupAggregateProjectionSchema>;

export const GroupCreatedEventSchema = z.object({
  type: z.literal('group.created'),
  version: z.literal(1),
  payload: z.object({
    groupId: IdSchema,
    groupType: z.string().trim().min(1).max(64),
    ownerPlayerId: IdSchema,
    maxMembers: z.number().int().min(2).max(100),
    isPublic: z.boolean(),
    member: GroupMemberSchema,
    createdAt: z.string().datetime(),
  }).strict(),
}).strict();

export const GroupMemberJoinedEventSchema = z.object({
  type: z.literal('group.member_joined'),
  version: z.literal(1),
  payload: z.object({
    groupId: IdSchema,
    member: GroupMemberSchema,
    joinedAt: z.string().datetime(),
  }).strict(),
}).strict();

export const GroupMemberLeftEventSchema = z.object({
  type: z.literal('group.member_left'),
  version: z.literal(1),
  payload: z.object({
    groupId: IdSchema,
    playerId: IdSchema,
    leftAt: z.string().datetime(),
  }).strict(),
}).strict();

export const GroupClosedEventSchema = z.object({
  type: z.literal('group.closed'),
  version: z.literal(1),
  payload: z.object({
    groupId: IdSchema,
    closedByPlayerId: IdSchema,
    closedAt: z.string().datetime(),
  }).strict(),
}).strict();

const PartyCommandBase = ClientCommandBaseSchema.omit({ type: true }).extend({
  version: z.literal(1),
  payload: z.object({}).strict(),
}).strict();

export const PartyCreateCommandSchema = PartyCommandBase.extend({
  type: z.literal('party.create'),
});

export const PartyJoinCommandSchema = PartyCommandBase.extend({
  type: z.literal('party.join'),
  payload: z.object({ groupId: IdSchema }).strict(),
});

export const PartyLeaveCommandSchema = PartyCommandBase.extend({
  type: z.literal('party.leave'),
});

export const PartyCloseCommandSchema = PartyCommandBase.extend({
  type: z.literal('party.close'),
});

const PartyQueryBase = z.object({
  type: z.string().min(1),
  version: z.literal(1),
  queryId: IdSchema,
  worldInstanceId: IdSchema,
  characterId: IdSchema,
}).strict();

export const PartyListQuerySchema = PartyQueryBase.extend({
  type: z.literal('party.list'),
  payload: z.object({}).strict(),
});

export const PartyInfoQuerySchema = PartyQueryBase.extend({
  type: z.literal('party.info'),
  payload: z.object({ afterRevision: NonNegativeIntSchema.optional() }).strict(),
});

export const PartyListProjectionSchema = z.object({
  parties: z.array(z.object({
    groupId: IdSchema,
    leaderName: z.string(),
    members: z.array(GroupMemberSchema),
    memberCount: z.number().int().nonnegative(),
    maxMembers: z.number().int().positive(),
    joinable: z.boolean(),
  }).strict()),
}).strict();

export const PartyActivitySchema = z.object({
  revision: NonNegativeIntSchema,
  groupId: IdSchema,
  type: z.enum(['created', 'joined', 'left', 'closed']),
  playerId: IdSchema.optional(),
  displayName: z.string().optional(),
}).strict();

export const PartyInfoProjectionSchema = z.object({
  party: GroupProjectionSchema.extend({ leaderName: z.string() }).nullable(),
  revision: NonNegativeIntSchema,
  activity: z.array(PartyActivitySchema),
}).strict();

export type PartyListProjection = z.infer<typeof PartyListProjectionSchema>;
export type PartyInfoProjection = z.infer<typeof PartyInfoProjectionSchema>;
