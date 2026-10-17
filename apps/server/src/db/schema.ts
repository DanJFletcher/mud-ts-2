import {
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

export const players = pgTable('players', {
  id: uuid('id').primaryKey(),
  displayName: text('display_name').notNull(),
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
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex('characters_owner_instance_idx').on(table.playerId, table.worldInstanceId),
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
