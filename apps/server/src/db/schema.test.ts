import { describe, expect, it } from 'vitest';
import { getTableConfig } from 'drizzle-orm/pg-core';
import {
  characters,
  commandReceipts,
  gameEvents,
  players,
  roomCharacterStates,
  roomChatMessages,
  sessions,
  worldSessions,
} from './schema.js';

describe('PostgreSQL schema definitions', () => {
  it('declares durable identity, character, event and idempotency tables', () => {
    expect(players).toBeDefined();
    expect(sessions).toBeDefined();
    expect(characters).toBeDefined();
    expect(gameEvents).toBeDefined();
    expect(commandReceipts).toBeDefined();
    expect(worldSessions).toBeDefined();
    expect(roomChatMessages).toBeDefined();
    expect(players.clerkUserId).toBeDefined();
    expect(characters.archivedAt).toBeDefined();
  });

  it('materializes the foreign-key references for session, character, and room state', () => {
    const tables = [sessions, characters, worldSessions, roomCharacterStates, roomChatMessages];
    const foreignKeys = tables.flatMap((table) => getTableConfig(table).foreignKeys);

    expect(foreignKeys).toHaveLength(6);
    for (const foreignKey of foreignKeys) {
      expect(foreignKey.reference().foreignColumns.length).toBeGreaterThan(0);
    }
  });
});
