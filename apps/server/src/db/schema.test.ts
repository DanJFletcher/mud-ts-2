import { describe, expect, it } from 'vitest';
import {
  characters,
  commandReceipts,
  gameEvents,
  players,
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
});
