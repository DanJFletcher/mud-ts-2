import { sql } from 'drizzle-orm';
import {
  check,
  boolean,
  integer,
  foreignKey,
  index,
  jsonb,
  pgTable,
  primaryKey,
  serial,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

export const players = pgTable('players', {
  id: uuid('id').primaryKey(),
  displayName: text('display_name').notNull(),
  clerkUserId: text('clerk_user_id').unique(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const sessions = pgTable('sessions', {
  id: uuid('id').primaryKey(),
  playerId: uuid('player_id').notNull().references(() => players.id, { onDelete: 'cascade' }),
  tokenHash: text('token_hash').notNull().unique(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const characters = pgTable('characters', {
  id: uuid('id').primaryKey(),
  playerId: uuid('player_id').notNull().references(() => players.id, { onDelete: 'cascade' }),
  worldInstanceId: text('world_instance_id').notNull(),
  name: text('name').notNull(),
  archivedAt: timestamp('archived_at', { withTimezone: true }),
  lastPlayedAt: timestamp('last_played_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index('characters_owner_instance_idx').on(table.playerId, table.worldInstanceId),
]);

export const worldSessions = pgTable('world_sessions', {
  id: uuid('id').primaryKey(),
  playerId: uuid('player_id').notNull().references(() => players.id, { onDelete: 'cascade' }),
  worldInstanceId: text('world_instance_id').notNull(),
  characterId: uuid('character_id').notNull().references(() => characters.id, { onDelete: 'cascade' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex('world_sessions_owner_instance_idx').on(table.playerId, table.worldInstanceId),
  index('world_sessions_character_idx').on(table.characterId),
  index('world_sessions_presence_idx').on(table.worldInstanceId, table.lastSeenAt),
]);

export const gameEvents = pgTable('game_events', {
  eventId: uuid('event_id').primaryKey(),
  worldInstanceId: text('world_instance_id').notNull(),
  streamId: text('stream_id').notNull(),
  streamVersion: integer('stream_version').notNull(),
  type: text('type').notNull(),
  contractVersion: integer('contract_version').notNull(),
  payload: jsonb('payload').notNull().$type<Record<string, unknown>>(),
  causationCommandId: text('causation_command_id').notNull(),
  actorId: uuid('actor_id').notNull(),
  occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull(),
  tick: integer('tick').notNull(),
}, (table) => [
  uniqueIndex('game_events_instance_stream_revision_idx')
    .on(table.worldInstanceId, table.streamId, table.streamVersion),
]);

/** Rebuildable due-work index; lifecycle events remain the source of truth. */
export const worldObjectLifecycles = pgTable('world_object_lifecycles', {
  worldInstanceId: text('world_instance_id').notNull(),
  objectId: text('object_id').notNull(),
  objectType: text('object_type').notNull(),
  locationId: text('location_id').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  state: text('state').$type<'scheduled' | 'expiring' | 'expired' | 'cancelled'>().notNull(),
  revision: integer('revision').notNull(),
  attempts: integer('attempts').notNull().default(0),
  leaseToken: uuid('lease_token'),
  leaseUntil: timestamp('lease_until', { withTimezone: true }),
}, (table) => [
  primaryKey({
    name: 'world_object_lifecycles_pk',
    columns: [table.worldInstanceId, table.objectId],
  }),
  index('world_object_lifecycles_due_idx').on(table.worldInstanceId, table.state, table.expiresAt, table.leaseUntil),
  check('world_object_lifecycles_state_check', sql`${table.state} in ('scheduled', 'expiring', 'expired', 'cancelled')`),
  check('world_object_lifecycles_revision_check', sql`${table.revision} >= 1`),
]);

/** Rebuildable room read model; updated in the event append transaction. */
export const roomCharacterStates = pgTable('room_character_states', {
  characterId: uuid('character_id').primaryKey().references(() => characters.id, { onDelete: 'cascade' }),
  worldInstanceId: text('world_instance_id').notNull(),
  locationId: text('location_id').notNull(),
  revision: integer('revision').notNull(),
  schemaVersion: integer('schema_version').notNull().default(1),
  state: jsonb('state').notNull().$type<{
    worldInstanceId: string; characterId: string; name: string; locationId: string;
    archived: boolean; health?: { current: number; maximum: number };
    combat?: { status: 'active' | 'victory' | 'defeat' | 'fled' };
  }>(),
}, (table) => [index('room_character_states_room_idx').on(table.worldInstanceId, table.locationId)]);

export const commandReceipts = pgTable('command_receipts', {
  worldInstanceId: text('world_instance_id').notNull(),
  actorId: uuid('actor_id').notNull(),
  commandId: text('command_id').notNull(),
  payloadHash: text('payload_hash').notNull(),
  streamId: text('stream_id').notNull(),
  receipt: jsonb('receipt').notNull().$type<Record<string, unknown>>(),
  events: jsonb('events').notNull().$type<unknown[]>(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  primaryKey({
    name: 'command_receipts_pk',
    columns: [table.worldInstanceId, table.actorId, table.commandId],
  }),
]);

export const worldLocationGroupCatalogs = pgTable('world_location_group_catalogs', {
  packId: text('pack_id').notNull(),
  packVersion: text('pack_version').notNull(),
  revision: integer('revision').notNull().default(0),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  primaryKey({
    name: 'world_location_group_catalogs_pk',
    columns: [table.packId, table.packVersion],
  }),
  check('world_location_group_catalogs_revision_nonnegative', sql`${table.revision} >= 0`),
]);

export const worldLocationGroups = pgTable('world_location_groups', {
  packId: text('pack_id').notNull(),
  packVersion: text('pack_version').notNull(),
  id: text('id').notNull(),
  name: text('name').notNull(),
  type: text('type').notNull(),
  description: text('description'),
  metadata: jsonb('metadata').$type<Record<string, unknown>>(),
}, (table) => [
  primaryKey({
    name: 'world_location_groups_pk',
    columns: [table.packId, table.packVersion, table.id],
  }),
  foreignKey({
    name: 'world_location_groups_catalog_fk',
    columns: [table.packId, table.packVersion],
    foreignColumns: [worldLocationGroupCatalogs.packId, worldLocationGroupCatalogs.packVersion],
  }).onDelete('cascade'),
]);

export const worldLocationGroupMemberships = pgTable('world_location_group_memberships', {
  packId: text('pack_id').notNull(),
  packVersion: text('pack_version').notNull(),
  groupId: text('group_id').notNull(),
  locationId: text('location_id').notNull(),
  isPrimary: boolean('is_primary').notNull().default(false),
}, (table) => [
  primaryKey({
    name: 'world_location_group_memberships_pk',
    columns: [table.packId, table.packVersion, table.groupId, table.locationId],
  }),
  foreignKey({
    name: 'world_location_group_memberships_group_fk',
    columns: [table.packId, table.packVersion, table.groupId],
    foreignColumns: [worldLocationGroups.packId, worldLocationGroups.packVersion, worldLocationGroups.id],
  }).onDelete('cascade'),
  index('world_location_group_memberships_location_idx')
    .on(table.packId, table.packVersion, table.locationId),
  uniqueIndex('world_location_group_one_primary_per_location_idx')
    .on(table.packId, table.packVersion, table.locationId)
    .where(sql`${table.isPrimary}`),
]);

export const roomChatMessages = pgTable('room_chat_messages', {
  id: serial('id').primaryKey(),
  worldInstanceId: text('world_instance_id').notNull(),
  playerId: uuid('player_id').references(() => players.id, { onDelete: 'cascade' }),
  submissionId: text('submission_id'),
  roomId: text('room_id').notNull(),
  speakerType: text('speaker_type').$type<'player' | 'npc'>().notNull(),
  speakerId: text('speaker_id').notNull(),
  speakerName: text('speaker_name').notNull(),
  message: text('message').notNull(),
  sourceEffectId: text('source_effect_id'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index('room_chat_messages_world_room_id_idx').on(table.worldInstanceId, table.roomId, table.id),
  uniqueIndex('room_chat_messages_player_submission_idx').on(
    table.worldInstanceId,
    table.playerId,
    table.submissionId,
  ),
  uniqueIndex('room_chat_messages_source_effect_id_idx').on(table.sourceEffectId),
]);

export const durableEffects = pgTable('durable_effects', {
  id: uuid('id').primaryKey(),
  worldInstanceId: text('world_instance_id').notNull(),
  sourceStreamId: text('source_stream_id'),
  causationCommandId: text('causation_command_id').notNull(),
  effectType: text('effect_type').notNull(),
  effectVersion: integer('effect_version').notNull(),
  payload: jsonb('payload').notNull().$type<Record<string, unknown>>(),
  dedupeKey: text('dedupe_key').notNull(),
  status: text('status').$type<'pending' | 'processing' | 'completed' | 'dead'>().notNull().default('pending'),
  attempts: integer('attempts').notNull().default(0),
  availableAt: timestamp('available_at', { withTimezone: true }).notNull().defaultNow(),
  lockedUntil: timestamp('locked_until', { withTimezone: true }),
  leaseToken: uuid('lease_token'),
  lastError: text('last_error'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  completedAt: timestamp('completed_at', { withTimezone: true }),
}, (table) => [
  uniqueIndex('durable_effects_dedupe_idx').on(table.dedupeKey),
  index('durable_effects_pending_idx').on(table.status, table.availableAt, table.createdAt),
  check('durable_effects_status_check', sql`${table.status} in ('pending', 'processing', 'completed', 'dead')`),
  check('durable_effects_attempts_check', sql`${table.attempts} >= 0`),
  check('durable_effects_version_check', sql`${table.effectVersion} > 0`),
]);

export const dataMigrations = pgTable('data_migrations', {
  id: text('id').primaryKey(),
  appliedAt: timestamp('applied_at', { withTimezone: true }).notNull().defaultNow(),
});
